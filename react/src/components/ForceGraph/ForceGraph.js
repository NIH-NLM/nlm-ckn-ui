import React, {
  useEffect,
  useState,
  useRef,
  memo,
  useCallback,
  useMemo,
} from "react";
import { useSelector, useDispatch, shallowEqual } from "react-redux";
import { ActionCreators } from "redux-undo";
import ForceGraphConstructor from "../ForceGraphConstructor/ForceGraphConstructor";
import collMaps from "../../assets/cell-kn-mvp-collection-maps.json";
import {
  LoadingBar,
  getLabel,
  parseCollections,
  fetchCollections,
  hasNodesInRawData,
  isMac,
} from "../Utils/Utils";
import {
  fetchAndProcessGraph,
  updateSetting,
  setGraphData,
  initializeGraph,
  setAvailableCollections,
  setAllCollections,
  expandNode,
  setInitialCollapseList,
  uncollapseNode,
  collapseNode,
  clearNodeToCenter,
  updateNodePosition,
  fetchEdgeFilterOptions,
  updateEdgeFilter,
} from "../../store/graphSlice";
import { performSetOperation } from "./performSetOperation";
import { useHotkeys } from "../../hooks/useHotkeys";
import { useHotkeyHold } from "../../hooks/useHotkeyHold";
import FilterableDropdown from "../FilterableDropdown/FilterableDropdown";
import { saveGraph } from "../../store/savedGraphsSlice";
import LoadGraphModal from "../LoadGraphModal/LoadGraphModal";
import AddToGraphButton from "../AddToGraphButton/AddToGraphButton";
import DocumentPopup from "../DocumentPopup/DocumentPopup";

// Whitelist of settings that can be configured on a per-node basis.
const PER_NODE_SETTINGS = [
  "depth",
  "edgeDirection",
  "allowedCollections",
  "nodeFontSize",
  "edgeFontSize",
  "labelStates",
  "collapseOnStart",
  "edgeFilters",
];

// Main React component for D3 force-directed graph, wrapped in memo for performance.
// Orchestrates Redux state, user interactions, and D3 instance.
const ForceGraph = ({
  // Accept node IDs via props for direct linking (e.g., landing pages).
  nodeIds: originNodeIdsFromProps = [],
  settings: settingsFromProps,
}) => {
  // Redux dispatch for triggering state changes.
  const dispatch = useDispatch();

  // Refs for DOM elements and D3 graph instance.
  const wrapperRef = useRef();
  const svgRef = useRef();
  const graphInstanceRef = useRef(null);
  const hasInitializedGraph = useRef(false);

  // Selects origin node IDs from nodesSlice for NodesSlice driven graphs.
  const nodesSliceOriginNodeIds = useSelector(
    (state) => state.nodesSlice.originNodeIds,
  );

  // Selects state from Redux store, including graph data and history.
  const {
    graphData,
    rawData,
    status,
    originNodeIds,
    lastActionType,
    nodeToCenter,
    collapsed,
    availableEdgeFilters,
    edgeFilterStatus,
  } = useSelector((state) => state.graph.present, shallowEqual);

  // Select undo and redo state
  const { canUndo, canRedo } = useSelector(
    (state) => ({
      canUndo: state.graph.past.length > 0,
      canRedo: state.graph.future.length > 0,
    }),
    shallowEqual,
  );

  const { settings, lastAppliedSettings, lastAppliedPerNodeSettings } =
    useSelector(
      (state) => ({
        settings: state.graph.present.settings,
        lastAppliedSettings: state.graph.present.lastAppliedSettings,
        lastAppliedPerNodeSettings:
          state.graph.present.lastAppliedPerNodeSettings,
      }),
      shallowEqual,
    );

  // Local component state for UI and temporary flags.
  const collectionMaps = useMemo(() => new Map(collMaps.maps), []); // Memoizing to avoid refetching.
  const [isRestoring, setIsRestoring] = useState(false);
  const [optionsVisible, setOptionsVisible] = useState(false);
  const [popup, setPopup] = useState({
    visible: false,
    isEdge: false,
    nodeId: null,
    nodeLabel: null,
    position: { x: 0, y: 0 },
  });
  const [isLoadModalOpen, setIsLoadModalOpen] = useState(false);

  // State for two-tiered tab navigation.
  const [activePrimaryTab, setActivePrimaryTab] = useState("settings");
  const [activeSecondaryTab, setActiveSecondaryTab] = useState("general");

  // State for advanced per-node settings.
  const [isAdvancedMode, setIsAdvancedMode] = useState(false);
  const [perNodeSettings, setPerNodeSettings] = useState({});
  const [activeOriginNodeId, setActiveOriginNodeId] = useState(null);
  const settingsRef = useRef(settings);
  const perNodeSettingsRef = useRef(perNodeSettings);

  // Keep the refs updated with the latest state on every render.
  useEffect(() => {
    settingsRef.current = settings;
  });
  useEffect(() => {
    perNodeSettingsRef.current = perNodeSettings;
  });

  // Fetches list of available data collections on component mount.
  useEffect(() => {
    fetchCollections(settings.graphType).then((data) => {
      const parsed = parseCollections(data);
      dispatch(setAvailableCollections(parsed));
    });
    fetchCollections("ontologies").then((data) => {
      const parsed = parseCollections(data);
      dispatch(setAllCollections(parsed));
    });
  }, [dispatch, settings.graphType]);

  // Fetches available edge filter options when component mounts or graph type changes.
  useEffect(() => {
    dispatch(fetchEdgeFilterOptions());
  }, [dispatch, settings.graphType]);

  // Applies collection filters passed via props.
  useEffect(() => {
    const collectionsToPrune = settingsFromProps?.collectionsToPrune;
    if (
      collectionsToPrune === undefined ||
      settings.availableCollections.length === 0
    ) {
      return;
    }
    const newAllowedCollections = settings.availableCollections.filter(
      (coll) => !collectionsToPrune.includes(coll),
    );
    dispatch(
      updateSetting({
        setting: "allowedCollections",
        value: newAllowedCollections,
      }),
    );
  }, [settingsFromProps, settings.availableCollections, dispatch]);

  // Triggers new data fetch when graph is explicitly initialized in the slice.
  useEffect(() => {
    if (
      (lastActionType === "initializeGraph" &&
        settings.allowedCollections.length > 0) ||
      (!hasInitializedGraph.current && lastActionType === "updateSetting")
    ) {
      dispatch(fetchAndProcessGraph());
      hasInitializedGraph.current = true;
    }
  }, [dispatch, settings.allowedCollections, lastActionType]);

  // Observes container size changes and resizes D3 graph accordingly.
  useEffect(() => {
    const wrapperElement = wrapperRef.current;
    if (!wrapperElement) return;

    const resizeObserver = new ResizeObserver((entries) => {
      const graphInstance = graphInstanceRef.current;
      if (!graphInstance) return;

      for (let entry of entries) {
        if (entry.target === wrapperElement) {
          const { width, height } = entry.contentRect;
          graphInstance.resize(width, height);
        }
      }
    });

    resizeObserver.observe(wrapperElement);
    return () => resizeObserver.disconnect();
  }, []);

  // Main effect for synchronizing D3 instance with Redux state.
  useEffect(() => {
    const graphInstance = graphInstanceRef.current;
    if (!graphInstance && settings.availableCollections.length > 0) {
      const handleSimulationEnd = (finalNodes, finalLinks) => {
        dispatch(setGraphData({ nodes: finalNodes, links: finalLinks }));
      };
      const newGraphInstance = ForceGraphConstructor(
        svgRef.current,
        { nodes: [], links: [] },
        {
          onSimulationEnd: handleSimulationEnd,
          saveInitial: false,
          useFocusNodes: settings.useFocusNodes,
          originNodeIds: originNodeIds,
          nodeFontSize: settings.nodeFontSize,
          linkFontSize: settings.edgeFontSize,
          initialLabelStates: settings.labelStates,
          nodeGroups: settings.availableCollections,
          collectionMaps: collectionMaps,
          onNodeClick: handleNodeClick,
          onNodeDragEnd: handleNodeDragEnd,
          interactionCallback: handlePopupClose,
          nodeGroup: (d) => d._id.split("/")[0],
          nodeHover: (d) => (d.label ? `${d._id}\n${d.label}` : `${d._id}`),
          label: getLabel,
          nodeStrength: -100,
          width: svgRef.current.clientWidth,
          height: svgRef.current.clientHeight,
        },
      );
      graphInstanceRef.current = newGraphInstance;
      newGraphInstance.resize(
        wrapperRef.current.clientWidth,
        wrapperRef.current.clientHeight,
      );
      for (const labelClass in settings.labelStates) {
        newGraphInstance.toggleLabels(
          settings.labelStates[labelClass],
          labelClass,
        );
      }
    }

    if (isRestoring === true || lastActionType == "loadGraph") {
      if (graphInstance) {
        graphInstance.restoreGraph({
          nodes: graphData.nodes,
          links: graphData.links,
          labelStates: settings.labelStates,
        });
      }
      setIsRestoring(false);
    } else {
      switch (lastActionType) {
        case "fetch/fulfilled":
        case "expand/fulfilled": {
          if (!rawData) {
            return;
          }

          let processedData;
          if (lastActionType === "expand/fulfilled") {
            processedData = graphData;
          } else if (settings.findShortestPaths) {
            processedData = rawData;
          } else {
            const graphsToProcess = originNodeIds.map(
              (nodeId) => rawData[nodeId],
            );
            processedData = performSetOperation(
              graphsToProcess,
              settings.setOperation,
            );
          }
          let collapseList = finalCollapseList;
          if (
            lastActionType === "fetch/fulfilled" &&
            collapsed?.initial?.length === 0
          ) {
            const initialCollapseList = processedData.nodes
              .filter((node) => !originNodeIds.includes(node._id))
              .map((node) => node._id);
            dispatch(setInitialCollapseList(initialCollapseList));
            if (settings.collapseOnStart) {
              collapseList = initialCollapseList;
            }
          }

          graphInstance.updateGraph({
            newOriginNodeIds: originNodeIds,
            newNodes: processedData.nodes,
            newLinks: processedData.links,
            resetData: lastActionType === "fetch/fulfilled",
            collapseNodes: collapseList,
            centerNodeId: nodeToCenter,
            labelStates: settings.labelStates,
          });

          if (nodeToCenter) {
            dispatch(clearNodeToCenter());
          }
        }
        default: {
          break;
        }
      }
    }
  }, [rawData, graphData, settings.availableCollections]);

  // Updates D3 node font size when setting changes.
  useEffect(() => {
    if (graphInstanceRef.current?.updateNodeFontSize) {
      graphInstanceRef.current.updateNodeFontSize(settings.nodeFontSize);
    }
  }, [settings.nodeFontSize]);

  // Updates D3 link font size when setting changes.
  useEffect(() => {
    if (graphInstanceRef.current?.updateLinkFontSize) {
      graphInstanceRef.current.updateLinkFontSize(settings.edgeFontSize);
    }
  }, [settings.edgeFontSize]);

  // Toggles label visibility in D3 when settings change.
  useEffect(() => {
    if (graphInstanceRef.current?.toggleLabels) {
      for (const labelClass in settings.labelStates) {
        const shouldShow = settings.labelStates[labelClass];
        graphInstanceRef.current.toggleLabels(shouldShow, labelClass);
      }
    }
  }, [settings.labelStates]);

  // Effect to synchronize Redux state with local per-node settings.
  useEffect(() => {
    if (isAdvancedMode && activeOriginNodeId) {
      // Use the refs to get the most up-to-date state without adding them as dependencies.
      const currentSettings = settingsRef.current;
      const currentPerNodeSettings = perNodeSettingsRef.current;

      const newActiveSettings = currentPerNodeSettings[activeOriginNodeId];
      if (!newActiveSettings) return; // Guard against race conditions

      Object.entries(newActiveSettings).forEach(([settingKey, value]) => {
        if (PER_NODE_SETTINGS.includes(settingKey)) {
          if (
            JSON.stringify(currentSettings[settingKey]) !==
            JSON.stringify(value)
          ) {
            dispatch(updateSetting({ setting: settingKey, value: value }));
          }
        }
      });
    }
  }, [isAdvancedMode, activeOriginNodeId, dispatch]);

  // Effect to sync filter changes back to local per-node state.
  useEffect(() => {
    // Only run this logic if advanced mode is active and a node is selected.
    if (isAdvancedMode && activeOriginNodeId) {
      // Check if the edgeFilters in Redux are different from what's stored locally.
      if (
        JSON.stringify(settings.edgeFilters) !==
        JSON.stringify(perNodeSettings[activeOriginNodeId]?.edgeFilters)
      ) {
        // If they are different, it means a filter was just changed.
        // Update the local perNodeSettings to reflect this change.
        setPerNodeSettings((prevSettings) => ({
          ...prevSettings,
          [activeOriginNodeId]: {
            ...prevSettings[activeOriginNodeId],
            edgeFilters: settings.edgeFilters,
          },
        }));
      }
    }
  }, [
    settings.edgeFilters,
    isAdvancedMode,
    activeOriginNodeId,
    perNodeSettings,
  ]);

  // Calculate if settings are stale.
  const isSettingsStale = useMemo(() => {
    // On the very first run, lastAppliedSettings is null, so nothing is stale.
    if (!lastAppliedSettings) {
      return false;
    }

    // Compare based on mode.
    if (isAdvancedMode) {
      // Compare perNodeSettings against snapshot in Redux.
      return (
        JSON.stringify(perNodeSettings) !==
        JSON.stringify(lastAppliedPerNodeSettings)
      );
    } else {
      // Compare standard settings.
      return JSON.stringify(settings) !== JSON.stringify(lastAppliedSettings);
    }
  }, [
    isAdvancedMode,
    settings,
    perNodeSettings,
    lastAppliedSettings,
    lastAppliedPerNodeSettings,
  ]);

  // Memoizes calculation of final list of nodes to collapse.
  const finalCollapseList = useMemo(() => {
    const nodesToCollapse = new Set(collapsed.userDefined);
    if (settings.collapseOnStart) {
      collapsed.initial.forEach((nodeId) => {
        if (!collapsed.userIgnored.includes(nodeId)) {
          nodesToCollapse.add(nodeId);
        }
      });
    }
    return Array.from(nodesToCollapse);
  }, [settings.collapseOnStart, collapsed]);

  // --- Redux and Event Handlers ---

  // Memoized handler for updating per-node or global settings.
  const handleSettingChange = useCallback(
    (setting, value) => {
      // If in advanced mode, update the local state for the active node.
      if (isAdvancedMode && activeOriginNodeId) {
        setPerNodeSettings((prevSettings) => ({
          ...prevSettings,
          [activeOriginNodeId]: {
            ...prevSettings[activeOriginNodeId],
            [setting]: value,
          },
        }));
      }
      // Always dispatch to sync the UI.
      dispatch(updateSetting({ setting, value }));
    },
    [dispatch, isAdvancedMode, activeOriginNodeId],
  );

  // Memoized handler for updating global Redux settings.
  const handleGlobalSettingChange = useCallback(
    (setting, value) => {
      dispatch(updateSetting({ setting, value }));
    },
    [dispatch],
  );

  const handleNodeDragEnd = useCallback(
    ({ nodeId, x, y }) => {
      dispatch(updateNodePosition({ nodeId, x, y }));
    },
    [dispatch],
  );

  const handleUndo = () => {
    setIsRestoring(true);
    dispatch(ActionCreators.undo());
  };

  const handleRedo = () => {
    setIsRestoring(true);
    dispatch(ActionCreators.redo());
  };

  const handleSave = useCallback(() => {
    const graphName = window.prompt("Please enter a name for your graph:");
    if (graphName) {
      dispatch(
        saveGraph({
          name: graphName,
          originNodeIds: originNodeIds,
          settings: settings,
          graphData: graphData,
        }),
      );
      alert(`Graph "${graphName}" saved successfully!`);
    }
  }, [dispatch, originNodeIds, settings, graphData]);

  const handleLoad = useCallback(() => {
    setIsLoadModalOpen(true);
  }, []);

  // Memoizes hotkey configuration.
  const hotkeyConfigs = useMemo(
    () => [
      { key: "z", ctrlKey: true, metaKey: true, handler: handleUndo },
      ...(isMac
        ? [{ key: "z", metaKey: true, shiftKey: true, handler: handleRedo }]
        : [{ key: "y", ctrlKey: true, handler: handleRedo }]),
      { key: "s", ctrlKey: true, metaKey: true, handler: handleSave },
      { key: "o", ctrlKey: true, metaKey: true, handler: handleLoad },
    ],
    [handleUndo, handleRedo, handleSave, handleLoad],
  );
  useHotkeys(hotkeyConfigs, [hotkeyConfigs]);

  const handleSimulationOn = useCallback(() => {
    graphInstanceRef.current?.toggleSimulation(true, settings.labelStates);
  }, [settings.labelStates]);

  const handleSimulationOff = useCallback(() => {
    graphInstanceRef.current?.toggleSimulation(false);
  }, []);

  useHotkeyHold("s", handleSimulationOn, handleSimulationOff);

  // --- Settings Panel Handlers ---
  const handleDepthChange = (e) =>
    handleSettingChange("depth", Number(e.target.value));
  const handleEdgeDirectionChange = (e) =>
    handleSettingChange("edgeDirection", e.target.value);
  const handleNodeFontSizeChange = (e) =>
    handleSettingChange("nodeFontSize", parseInt(e.target.value, 10));
  const handleEdgeFontSizeChange = (e) =>
    handleSettingChange("edgeFontSize", parseInt(e.target.value, 10));
  const handleLeafToggle = (e) =>
    handleSettingChange("collapseOnStart", e.target.checked);
  const handleGraphToggle = () =>
    handleSettingChange(
      "graphType",
      settings.graphType === "phenotypes" ? "ontologies" : "phenotypes",
    );
  const handleCollectionChange = (name) => {
    const newAllowed = settings.allowedCollections.includes(name)
      ? settings.allowedCollections.filter((n) => n !== name)
      : [...settings.allowedCollections, name];
    handleSettingChange("allowedCollections", newAllowed);
  };
  const handleAllOn = () =>
    handleSettingChange("allowedCollections", settings.availableCollections);
  const handleAllOff = () => handleSettingChange("allowedCollections", []);
  const handleLabelToggle = (labelClass) => {
    const newLabelStates = {
      ...settings.labelStates,
      [labelClass]: !settings.labelStates[labelClass],
    };
    handleSettingChange("labelStates", newLabelStates);
  };

  // Global setting handlers use the global-only updater.
  const handleOperationChange = (e) =>
    handleGlobalSettingChange("setOperation", e.target.value);
  const handleShortestPathToggle = (e) =>
    handleGlobalSettingChange("findShortestPaths", e.target.checked);

  const handleAdvancedModeToggle = () => {
    const newMode = !isAdvancedMode;
    setIsAdvancedMode(newMode);

    if (newMode) {
      const initialPerNodeSettings = {};
      originNodeIds.forEach((nodeId) => {
        initialPerNodeSettings[nodeId] = { ...settings };
      });
      setPerNodeSettings(initialPerNodeSettings);
      setActiveOriginNodeId(originNodeIds[0]);
      setActivePrimaryTab("settings");
    } else {
      const firstNodeId = originNodeIds[0];
      if (perNodeSettings[firstNodeId]) {
        const firstNodeSettings = perNodeSettings[firstNodeId];
        // Only restore the per-node settings, leaving global settings intact.
        Object.entries(firstNodeSettings).forEach(([settingKey, value]) => {
          if (PER_NODE_SETTINGS.includes(settingKey)) {
            dispatch(updateSetting({ setting: settingKey, value }));
          }
        });
      }
    }
  };

  // --- D3 Interaction Handlers ---
  const handleSimulationRestart = () => {
    graphInstanceRef.current?.updateGraph({
      simulate: true,
      labelStates: settings.labelStates,
    });
  };

  const handleExpand = () => {
    if (!popup.nodeId) return;
    dispatch(uncollapseNode(popup.nodeId));
    dispatch(expandNode(popup.nodeId));
    handlePopupClose();
  };

  const handleCollapse = () => {
    if (!popup.nodeId) return;
    dispatch(collapseNode(popup.nodeId));
    graphInstanceRef.current?.updateGraph({
      collapseNodes: [popup.nodeId],
      labelStates: settings.labelStates,
    });
    handlePopupClose();
  };

  const handleRemove = () => {
    if (!popup.nodeId) return;
    dispatch(collapseNode(popup.nodeId));
    graphInstanceRef.current?.updateGraph({
      collapseNodes: [popup.nodeId],
      removeNode: true,
      labelStates: settings.labelStates,
    });
    handlePopupClose();
  };

  // --- Local UI Handlers ---
  const handleNodeClick = (e, nodeData) => {
    const chartRect = wrapperRef.current.getBoundingClientRect();
    const popupWidth = 200;
    const popupHeight = 300;
    let x = e.clientX - chartRect.left;
    let y = e.clientY - chartRect.top;

    if (x + popupWidth > chartRect.width) x = x - popupWidth;
    if (y + popupHeight > chartRect.height) y = y - popupHeight;
    x = Math.max(0, x);
    y = Math.max(0, y);

    setPopup({
      visible: true,
      nodeId: nodeData._id,
      nodeLabel: getLabel(nodeData),
      isEdge: nodeData._id.split("/")[0].includes("-"),
      position: { x, y },
    });
  };

  const handlePopupClose = () => setPopup({ ...popup, visible: false });
  const toggleOptionsVisibility = () => setOptionsVisible(!optionsVisible);

  // Exports the current view as an image file (SVG, PNG) or data file (JSON).
  const exportGraph = (format) => {
    let nodeIdsString = "no-ids";
    if (Array.isArray(originNodeIds) && originNodeIds.length > 0) {
      nodeIdsString = originNodeIds
        .map((id) => id.replaceAll("/", "-"))
        .join("-");
    }
    const filenameStem = `cell-kn-mvp-${nodeIdsString}-graph`;

    if (format === "json") {
      if (!graphData) {
        console.error("graphData is not available for export.");
        return;
      }
      const jsonString = JSON.stringify(graphData, null, 2);
      const blob = new Blob([jsonString], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filenameStem + ".json";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      return;
    }

    if (!wrapperRef.current) return;
    const svgElement = wrapperRef.current.querySelector("svg");
    if (!svgElement) return;

    svgElement.style.backgroundColor = "white";
    const svgData = new XMLSerializer().serializeToString(svgElement);
    const svgBlob = new Blob([svgData], {
      type: "image/svg+xml;charset=utf-8",
    });
    svgElement.style.backgroundColor = "";

    const url = URL.createObjectURL(svgBlob);

    if (format === "svg") {
      const link = document.createElement("a");
      link.href = url;
      link.download = filenameStem + ".svg";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      return;
    }

    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      const scaleFactor = 4;
      const viewBox = svgElement.viewBox.baseVal;
      const svgWidth = viewBox?.width || svgElement.width.baseVal.value;
      const svgHeight = viewBox?.height || svgElement.height.baseVal.value;

      canvas.width = svgWidth * scaleFactor;
      canvas.height = svgHeight * scaleFactor;

      ctx.fillStyle = "white";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      let downloadUrl = canvas.toDataURL(`image/${format}`);
      let filename = `${filenameStem}.${format}`;

      const link = document.createElement("a");
      link.href = downloadUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    };
    img.onerror = () => URL.revokeObjectURL(url);
    img.src = url;
  };

  return (
    <div
      className={`graph-component-wrapper ${optionsVisible ? "options-open" : "options-closed"}`}
    >
      <div className="graph-main-area">
        <button
          onClick={toggleOptionsVisibility}
          className="toggle-options-button"
        >
          {optionsVisible ? "> Hide Options" : "< Show Options"}
        </button>

        {status === "loading" && <LoadingBar />}

        <div id="chart-container-wrapper" ref={wrapperRef}>
          <svg ref={svgRef}></svg>
          {(status === "processing" || status === "succeeded") &&
            !hasNodesInRawData(rawData) && (
              <div className="no-data-message">No data found.</div>
            )}
          {status === "failed" && (
            <div className="no-data-message error-message">
              Failed to fetch data.
            </div>
          )}
        </div>

        <DocumentPopup
          isVisible={popup.visible}
          position={popup.position}
          onClose={handlePopupClose}
        >
          <a
            href={`/#/collections/${popup.nodeId}`}
            rel="noopener noreferrer"
            className="document-popup-button"
          >
            Go To "{popup.nodeLabel}"
          </a>
          <button
            className="document-popup-button"
            onClick={handleExpand}
            style={{ display: !popup.isEdge ? "block" : "none" }}
          >
            Expand
          </button>
          <button
            className="document-popup-button"
            onClick={handleCollapse}
            style={{ display: !popup.isEdge ? "block" : "none" }}
          >
            Collapse Leaves
          </button>
          <button
            className="document-popup-button"
            onClick={handleRemove}
            style={{ display: !popup.isEdge ? "block" : "none" }}
          >
            Remove Node
          </button>
          <AddToGraphButton nodeId={popup.nodeId} text="Add to Graph" />
        </DocumentPopup>
      </div>

      <div
        id="graph-options-panel"
        className="graph-options-side-panel"
        style={{ display: optionsVisible ? "flex" : "none" }}
      >
        <div className="options-tabs-nav primary-tabs">
          {isSettingsStale && (
            <div className="settings-apply-container">
              <p>Your settings have changed.</p>
              <button
                className="primary-action-button"
                onClick={() =>
                  dispatch(
                    initializeGraph({
                      nodeIds: originNodeIds,
                      isAdvancedMode: isAdvancedMode,
                      perNodeSettings: perNodeSettings,
                    }),
                  )
                }
              >
                Apply Changes
              </button>
            </div>
          )}
          <button
            className={`tab-button ${activePrimaryTab === "settings" ? "active" : ""}`}
            onClick={() => setActivePrimaryTab("settings")}
          >
            Settings
          </button>
          {originNodeIds && originNodeIds.length >= 2 && (
            <button
              className={`tab-button ${activePrimaryTab === "multiNode" ? "active" : ""}`}
              onClick={() => setActivePrimaryTab("multiNode")}
            >
              Multi-Node
            </button>
          )}
          <button
            className={`tab-button ${activePrimaryTab === "history" ? "active" : ""}`}
            onClick={() => setActivePrimaryTab("history")}
          >
            History
          </button>
          <button
            className={`tab-button ${activePrimaryTab === "export" ? "active" : ""}`}
            onClick={() => setActivePrimaryTab("export")}
          >
            Export
          </button>
        </div>

        <div className="options-tabs-content">
          {activePrimaryTab === "settings" && (
            <>
              {isAdvancedMode && (
                <div className="options-tabs-nav super-tabs">
                  {originNodeIds.map((nodeId) => (
                    <button
                      key={nodeId}
                      className={`tab-button ${activeOriginNodeId === nodeId ? "active" : ""}`}
                      onClick={() => setActiveOriginNodeId(nodeId)}
                    >
                      {getLabel({ _id: nodeId, label: nodeId })}
                    </button>
                  ))}
                </div>
              )}
              <div className="options-tabs-nav secondary-tabs">
                <button
                  className={`tab-button ${activeSecondaryTab === "general" ? "active" : ""}`}
                  onClick={() => setActiveSecondaryTab("general")}
                >
                  General
                </button>
                <button
                  className={`tab-button ${activeSecondaryTab === "filters" ? "active" : ""}`}
                  onClick={() => setActiveSecondaryTab("filters")}
                >
                  Filters
                </button>
              </div>
              <div className="tab-panel-content">
                {activeSecondaryTab === "general" && (
                  <div id="tab-panel-general" className="tab-panel active">
                    <div className="option-group">
                      <label htmlFor="depth-select">Depth:</label>
                      <select
                        id="depth-select"
                        value={settings.depth}
                        onChange={handleDepthChange}
                      >
                        {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((value) => (
                          <option key={value} value={value}>
                            {value}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="option-group">
                      <label htmlFor="edge-direction-select">
                        Traversal Direction:
                      </label>
                      <select
                        id="edge-direction-select"
                        value={settings.edgeDirection}
                        onChange={handleEdgeDirectionChange}
                      >
                        {["ANY", "INBOUND", "OUTBOUND"].map((value) => (
                          <option key={value} value={value}>
                            {value}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="option-group font-size-picker">
                      <div className="node-font-size-picker">
                        <label htmlFor="node-font-size-select">
                          Node font size:
                        </label>
                        <select
                          id="node-font-size-select"
                          value={settings.nodeFontSize}
                          onChange={handleNodeFontSizeChange}
                        >
                          {[
                            4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30,
                            32,
                          ].map((size) => (
                            <option key={size} value={size}>
                              {size}px
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="edge-font-size-picker">
                        <label htmlFor="edge-font-size-select">
                          Edge font size:
                        </label>
                        <select
                          id="edge-font-size-select"
                          value={settings.edgeFontSize}
                          onChange={handleEdgeFontSizeChange}
                        >
                          {[
                            2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28,
                          ].map((size) => (
                            <option key={size} value={size}>
                              {size}px
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <div className="option-group labels-toggle-container">
                      <label>Toggle Labels:</label>
                      <div className="labels-toggle">
                        {Object.entries(settings.labelStates).map(
                          ([labelKey, isChecked]) => (
                            <div className="label-toggle-item" key={labelKey}>
                              {labelKey
                                .replace(/-/g, " ")
                                .replace("label", "")
                                .trim()
                                .replace(/^\w/, (c) => c.toUpperCase())}
                              <label className="switch">
                                <input
                                  type="checkbox"
                                  checked={isChecked}
                                  onChange={() => handleLabelToggle(labelKey)}
                                />
                                <span className="slider round"></span>
                              </label>
                            </div>
                          ),
                        )}
                      </div>
                    </div>
                    <div className="option-group labels-toggle-container">
                      <label>Collapse Leaf Nodes:</label>
                      <div className="labels-toggle graph-source-toggle">
                        <label className="switch">
                          <input
                            type="checkbox"
                            checked={settings.collapseOnStart}
                            onChange={handleLeafToggle}
                          />
                          <span className="slider round"></span>
                        </label>
                      </div>
                    </div>
                    <div className="option-group labels-toggle-container">
                      <label>Graph Source:</label>
                      <div className="labels-toggle graph-source-toggle">
                        Evidence
                        <label className="switch">
                          <input
                            type="checkbox"
                            checked={settings.graphType === "ontologies"}
                            onChange={handleGraphToggle}
                          />
                          <span className="slider round"></span>
                        </label>
                        Knowledge
                      </div>
                    </div>
                    <div className="option-group">
                      <button
                        className="simulation-toggle background-color-bg"
                        onClick={handleSimulationRestart}
                      >
                        Restart Simulation
                      </button>
                      <p className="hotkey-hint">
                        Hold<kbd>S</kbd> to run live
                      </p>
                    </div>
                  </div>
                )}
                {activeSecondaryTab === "filters" && (
                  <div id="tab-panel-collections" className="tab-panel active">
                    <div className="collection-picker">
                      <h3>Collection Filters:</h3>
                      <FilterableDropdown
                        key="collection-filter"
                        label="Collections"
                        options={settings.allCollections}
                        selectedOptions={settings.allowedCollections}
                        onOptionToggle={handleCollectionChange}
                        getOptionLabel={(collectionId) =>
                          collectionMaps.has(collectionId)
                            ? collectionMaps.get(collectionId)["display_name"]
                            : collectionId
                        }
                        getColorForOption={(collectionId) =>
                          collectionMaps.has(collectionId)
                            ? collectionMaps.get(collectionId)["color"]
                            : null
                        }
                      />
                    </div>
                    {edgeFilterStatus === "loading" && (
                      <div className="option-group">
                        Loading edge filters...
                      </div>
                    )}
                    {edgeFilterStatus === "failed" && (
                      <div className="option-group error-message">
                        Failed to load edge filters.
                      </div>
                    )}
                    {edgeFilterStatus === "succeeded" &&
                      Object.keys(availableEdgeFilters).length > 0 && (
                        <div className="edge-filter-section">
                          <h3>Edge Filters:</h3>
                          {Object.entries(availableEdgeFilters).map(
                            ([field, values]) => (
                              <FilterableDropdown
                                key={field}
                                label={field}
                                options={values}
                                selectedOptions={
                                  settings.edgeFilters[field] || []
                                }
                                onOptionToggle={(value) =>
                                  dispatch(updateEdgeFilter({ field, value }))
                                }
                              />
                            ),
                          )}
                        </div>
                      )}
                  </div>
                )}
              </div>
            </>
          )}

          {activePrimaryTab === "multiNode" &&
            originNodeIds &&
            originNodeIds.length >= 2 && (
              <div id="tab-panel-multiNode" className="tab-panel active">
                <div className="option-group labels-toggle-container">
                  <label>Advanced Per-Node Settings:</label>
                  <div className="labels-toggle graph-source-toggle">
                    <label className="switch">
                      <input
                        type="checkbox"
                        checked={isAdvancedMode}
                        onChange={handleAdvancedModeToggle}
                      />
                      <span className="slider round"></span>
                    </label>
                  </div>
                </div>
                <div className="option-group multi-node">
                  <label htmlFor="set-operation-select">Graph operation:</label>
                  <select
                    id="set-operation-select"
                    value={settings.setOperation}
                    onChange={handleOperationChange}
                  >
                    {["Intersection", "Union", "Symmetric Difference"].map(
                      (value) => (
                        <option key={value} value={value}>
                          {value}
                        </option>
                      ),
                    )}
                  </select>
                </div>
                <div className="option-group multi-node">
                  Shortest Path
                  <label className="switch">
                    <input
                      type="checkbox"
                      checked={settings.findShortestPaths}
                      onChange={handleShortestPathToggle}
                    />
                    <span className="slider round"></span>
                  </label>
                </div>
              </div>
            )}

          {activePrimaryTab === "history" && (
            <div id="tab-panel-history" className="tab-panel active">
              <div className="option-group">
                <label>Graph History</label>
                <div className="history-controls">
                  <button onClick={handleUndo} disabled={!canUndo}>
                    <span className="history-icon">↶</span> Undo{" "}
                    <kbd>{isMac ? "⌘Z" : "Ctrl+Z"}</kbd>
                  </button>
                  <button onClick={handleRedo} disabled={!canRedo}>
                    Redo <kbd>{isMac ? "⇧⌘Z" : "Ctrl+Y"}</kbd>
                  </button>
                </div>
              </div>
              <div className="option-group">
                <label>Saved Graphs</label>
                <div className="save-load-controls">
                  <button onClick={handleSave}>
                    Save Current Graph <kbd>{isMac ? "⌘S" : "Ctrl+S"}</kbd>
                  </button>
                  <button onClick={handleLoad}>
                    Load a Saved Graph <kbd>{isMac ? "⌘O" : "Ctrl+O"}</kbd>
                  </button>
                </div>
              </div>
            </div>
          )}

          {activePrimaryTab === "export" && (
            <div id="tab-panel-export" className="tab-panel active">
              <div className="option-group export-buttons">
                <label>Export Graph:</label>
                <button onClick={() => exportGraph("svg")}>
                  Download as SVG
                </button>
                <button onClick={() => exportGraph("png")}>
                  Download as PNG
                </button>
                <button onClick={() => exportGraph("json")}>
                  Download as JSON
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <LoadGraphModal
        isOpen={isLoadModalOpen}
        onClose={() => setIsLoadModalOpen(false)}
      />
    </div>
  );
};

export default memo(ForceGraph);
