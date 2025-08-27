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

// Main React component for D3 force-directed graph, wrapped in memo for performance.
// Orchestrates Redux state, user interactions, and D3 instance.
const ForceGraph = ({
  // Accept node IDs via props for direct linking (e.g., landing pages).
  nodeIds: originNodeIdsFromProps = [],
  settings: settingsFromProps,
  init_immediately,
}) => {
  // Redux dispatch for triggering state changes.
  const dispatch = useDispatch();

  // Refs for DOM elements and D3 graph instance.
  const wrapperRef = useRef();
  const svgRef = useRef();
  const graphInstanceRef = useRef(null);

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

  // Select settings state
  const { settings, lastAppliedSettings } = useSelector(
    (state) => ({
      settings: state.graph.present.settings,
      lastAppliedSettings: state.graph.present.lastAppliedSettings,
    }),
    shallowEqual,
  );

  // Calculate if settings are stale.
  const isSettingsStale = useMemo(() => {
    if (!lastAppliedSettings) {
      return false;
    }
    return JSON.stringify(settings) !== JSON.stringify(lastAppliedSettings);
  }, [settings, lastAppliedSettings]);

  // Local component state for UI and temporary flags.
  const [collections, setCollections] = useState([]);
  const [allCollections, setAllCollections] = useState([]);
  const collectionMaps = useMemo(() => new Map(collMaps.maps), []); // Memoizing to avoid refetching.
  const [isRestoring, setIsRestoring] = useState(false);
  const [optionsVisible, setOptionsVisible] = useState(false);
  const [activeTab, setActiveTab] = useState("general");
  const [popup, setPopup] = useState({
    visible: false,
    isEdge: false,
    nodeId: null,
    nodeLabel: null,
    position: { x: 0, y: 0 },
  });
  const [isLoadModalOpen, setIsLoadModalOpen] = useState(false);

  // Immediately render graph on document pages
  useEffect(() => {
    if (init_immediately) {
      dispatch(initializeGraph({ nodeIds: originNodeIds }));
    }
  }, [dispatch]);

  // Fetches list of available data collections on component mount.
  useEffect(() => {
    // Get both collections for current subgraph and full list.
    fetchCollections(settings.graphType).then((data) => {
      const parsed = parseCollections(data);
      setCollections(parsed);
      dispatch(setAvailableCollections(parsed));
    });
    fetchCollections("ontologies").then((data) => {
      const parsed = parseCollections(data);
      setAllCollections(parsed);
    });
  }, [dispatch, settings.graphType]);

  // Fetches available edge filter options when component mounts or graph type changes.
  useEffect(() => {
    dispatch(fetchEdgeFilterOptions());
  }, [dispatch, settings.graphType]);

  // Applies collection filters passed via props.
  useEffect(() => {
    const collectionsToPrune = settingsFromProps?.collectionsToPrune;
    if (collectionsToPrune === undefined || collections.length === 0) {
      return;
    }
    const newAllowedCollections = collections.filter(
      (coll) => !collectionsToPrune.includes(coll),
    );
    dispatch(
      updateSetting({
        setting: "allowedCollections",
        value: newAllowedCollections,
      }),
    );
  }, [settingsFromProps, collections, dispatch]);

  // Triggers new data fetch when graph is explicitly initialized in the slice.
  useEffect(() => {
    if (lastActionType === "initializeGraph") {
      dispatch(fetchAndProcessGraph());
    }
  }, [lastActionType]);

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

    // Handles state restoration for undo/redo actions.
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
      // Executes different logic based on last Redux action.
      switch (lastActionType) {
        case "fetch/fulfilled":
        case "expand/fulfilled": {
          if (status !== "processing" || !rawData) {
            return;
          }

          let processedData;
          if (rawData && Object.keys(rawData).length > 0) {
            // Apply set operations for multi-node graphs.
            processedData = performSetOperation(
              rawData,
              settings.setOperation,
              originNodeIds,
            );
          } else {
            // Init with an empty structure if there's no rawData.
            processedData = { nodes: [], links: [] };
          }

          // Creates D3 graph instance if it does not exist.
          if (!graphInstance) {
            // Callback to save final node positions to Redux after simulation.
            const handleSimulationEnd = (finalNodes, finalLinks) => {
              dispatch(setGraphData({ nodes: finalNodes, links: finalLinks }));
            };
            const newGraphInstance = ForceGraphConstructor(
              svgRef.current,
              { nodes: processedData.nodes, links: processedData.links },
              {
                onSimulationEnd: handleSimulationEnd,
                saveInitial: false,
                useFocusNodes: settings.useFocusNodes,
                originNodeIds: originNodeIds,
                nodeFontSize: settings.nodeFontSize,
                linkFontSize: settings.edgeFontSize,
                initialLabelStates: settings.labelStates,
                nodeGroups: collections,
                collectionMaps: collectionMaps,
                onNodeClick: handleNodeClick,
                onNodeDragEnd: handleNodeDragEnd,
                interactionCallback: handlePopupClose,
                nodeGroup: (d) => d._id.split("/")[0],
                nodeHover: (d) =>
                  d.label ? `${d._id}\n${d.label}` : `${d._id}`,
                label: getLabel,
                nodeStrength: -100,
                width: svgRef.current.clientWidth,
                height: svgRef.current.clientHeight,
              },
            );
            graphInstanceRef.current = newGraphInstance;
            // Trigger resize to place legend correctly at graph creation.
            newGraphInstance.resize(
              wrapperRef.current.clientWidth,
              wrapperRef.current.clientHeight,
            );
            // Syncs initial label visibility with D3 instance.
            for (const labelClass in settings.labelStates) {
              newGraphInstance.toggleLabels(
                settings.labelStates[labelClass],
                labelClass,
              );
            }
          } else {
            // Updates existing graph instance with new data.
            let collapseList = finalCollapseList;
            // Populates initial collapse list on first data fetch.
            if (
              lastActionType === "fetch/fulfilled" &&
              collapsed?.initial?.length === 0
            ) {
              const initialCollapseList = processedData.nodes
                .filter((node) => !originNodeIds.includes(node._id))
                .map((node) => node._id);
              dispatch(setInitialCollapseList(initialCollapseList));
              collapseList = initialCollapseList;
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
          break;
        }
        default: {
          break;
        }
      }
    }
  }, [rawData, graphData]);

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

  // Memoizes calculation of final list of nodes to collapse.
  // Combines user actions with initial collapse setting.
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

  // Memoized handler for updating any graph setting in Redux.
  const handleSettingChange = useCallback(
    (setting, value) => {
      dispatch(updateSetting({ setting, value }));
    },
    [dispatch],
  );

  // Dispatches action to save node position after drag ends.
  const handleNodeDragEnd = useCallback(
    ({ nodeId, x, y }) => {
      dispatch(updateNodePosition({ nodeId, x, y }));
    },
    [dispatch],
  );

  // Handle filtering on edges.
  const handleEdgeFilterChange = useCallback(
    (field, value) => {
      dispatch(updateEdgeFilter({ field, value }));
    },
    [dispatch],
  );

  // Triggers Redux undo action.
  // Sets restore flag to prevent re-running fetch logic.
  const handleUndo = () => {
    setIsRestoring(true);
    dispatch(ActionCreators.undo());
  };

  // Triggers Redux redo action.
  const handleRedo = () => {
    setIsRestoring(true);
    dispatch(ActionCreators.redo());
  };

  const handleSave = useCallback(() => {
    const graphName = window.prompt("Please enter a name for your graph:");
    if (graphName) {
      // Dispatch the saveGraph action with the current state.
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

  // Memoizes hotkey configuration for undo, redo, save, and load.
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

  // Hold hotkey configuration for toggleSimulation
  const handleSimulationOn = useCallback(() => {
    // Pass the current label states when turning the simulation on.
    graphInstanceRef.current?.toggleSimulation(true, settings.labelStates);
  }, [settings.labelStates]); // Dependency added to ensure current state is used.

  const handleSimulationOff = useCallback(() => {
    // No need to pass state when turning off; the D3 instance will restore it.
    graphInstanceRef.current?.toggleSimulation(false);
  }, []);

  useHotkeyHold("s", handleSimulationOn, handleSimulationOff);

  // --- Settings Panel Handlers ---
  const handleDepthChange = (e) =>
    handleSettingChange("depth", Number(e.target.value));
  const handleEdgeDirectionChange = (e) =>
    handleSettingChange("edgeDirection", e.target.value);
  const handleOperationChange = (e) =>
    handleSettingChange("setOperation", e.target.value);
  const handleNodeFontSizeChange = (e) =>
    handleSettingChange("nodeFontSize", parseInt(e.target.value, 10));
  const handleEdgeFontSizeChange = (e) =>
    handleSettingChange("edgeFontSize", parseInt(e.target.value, 10));
  const handleLeafToggle = (e) =>
    handleSettingChange("collapseOnStart", e.target.checked);
  const handleShortestPathToggle = (e) =>
    handleSettingChange("findShortestPaths", e.target.checked);
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
    handleSettingChange("allowedCollections", collections);
  const handleAllOff = () => handleSettingChange("allowedCollections", []);
  const handleLabelToggle = (labelClass) => {
    const newLabelStates = {
      ...settings.labelStates,
      [labelClass]: !settings.labelStates[labelClass],
    };
    handleSettingChange("labelStates", newLabelStates);
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
    // Get the bounding box of the graph container.
    const chartRect = wrapperRef.current.getBoundingClientRect();

    // Set leeway
    const popupWidth = 200;
    const popupHeight = 300;

    // Initial click position relative to the chart container.
    let x = e.clientX - chartRect.left;
    let y = e.clientY - chartRect.top;

    // Check for horizontal overflow (right edge).
    if (x + popupWidth > chartRect.width) {
      x = x - popupWidth;
    }

    // Check for vertical overflow (bottom edge).
    if (y + popupHeight > chartRect.height) {
      y = y - popupHeight;
    }

    // Ensure the popup does not go off the top or left of the screen.
    x = Math.max(0, x);
    y = Math.max(0, y);

    // Set the final adjusted position and show the popup.
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
    // Create string from originNodeIds, with default fallback.
    let nodeIdsString = "no-ids";
    if (Array.isArray(originNodeIds) && originNodeIds.length > 0) {
      nodeIdsString = originNodeIds
        .map((id) => id.replaceAll("/", "-"))
        .join("-");
    }
    // Create filename stem.
    const filenameStem = `cell-kn-mvp-${nodeIdsString}-graph`;

    // Handle JSON export
    if (format === "json") {
      // Error handling
      if (!graphData) {
        console.error("graphData is not available for export.");
        return;
      }

      // Convert JS object to JSON string.
      const jsonString = JSON.stringify(graphData, null, 2);

      // Create a URL for the Blob.
      const blob = new Blob([jsonString], { type: "application/json" });
      const url = URL.createObjectURL(blob);

      // Create a link element to trigger the download.
      const link = document.createElement("a");
      link.href = url;
      link.download = filenameStem + ".json";

      // Append to the document, click, and then remove.
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      // Clean up.
      URL.revokeObjectURL(url);

      return;
    }

    // Get svg element for image download.
    if (!wrapperRef.current) return;
    const svgElement = wrapperRef.current.querySelector("svg");
    if (!svgElement) return;

    // Temporarily set white background for export.
    svgElement.style.backgroundColor = "white";
    const svgData = new XMLSerializer().serializeToString(svgElement);
    const svgBlob = new Blob([svgData], {
      type: "image/svg+xml;charset=utf-8",
    });
    svgElement.style.backgroundColor = ""; // Reset style.

    const url = URL.createObjectURL(svgBlob);

    // For SVG format, download blob directly.
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

    // For raster formats (PNG/JPEG), draw SVG onto canvas.
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      const scaleFactor = 4; // Increase scale for higher resolution output.
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

        {/* Shows loading bar during data fetch. */}
        {status === "loading" && <LoadingBar />}

        <div id="chart-container-wrapper" ref={wrapperRef}>
          <svg ref={svgRef}></svg>
          {/* Displays message if no data is returned or if fetch fails. */}
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

        {/* Right-click context menu for node actions. */}
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

      {/* Main side panel for all user-configurable graph options. */}
      <div
        id="graph-options-panel"
        className="graph-options-side-panel"
        style={{ display: optionsVisible ? "flex" : "none" }}
      >
        <div className="options-tabs-nav">
          {/* Tabs for navigating different settings categories. */}
          <button
            className={`tab-button ${activeTab === "general" ? "active" : ""}`}
            onClick={() => setActiveTab("general")}
          >
            General
          </button>
          {originNodeIds && originNodeIds.length >= 2 && (
            <button
              className={`tab-button ${activeTab === "multiNode" ? "active" : ""}`}
              onClick={() => setActiveTab("multiNode")}
            >
              Multi-Node
            </button>
          )}
          <button
            className={`tab-button ${activeTab === "filters" ? "active" : ""}`}
            onClick={() => setActiveTab("filters")}
          >
            Filters
          </button>
          <button
            className={`tab-button ${activeTab === "history" ? "active" : ""}`}
            onClick={() => setActiveTab("history")}
          >
            History
          </button>
          <button
            className={`tab-button ${activeTab === "export" ? "active" : ""}`}
            onClick={() => setActiveTab("export")}
          >
            Export
          </button>
        </div>
        <div className="options-tabs-content">
          {isSettingsStale && (
            <div className="settings-apply-container">
              <p>Your settings have changed.</p>
              <button
                className="primary-action-button"
                onClick={() =>
                  dispatch(initializeGraph({ nodeIds: originNodeIds }))
                }
              >
                Apply Changes
              </button>
            </div>
          )}
          {activeTab === "general" && (
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
                <label htmlFor="depth-select">Traversal Direction:</label>
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
                  <label htmlFor="node-font-size-select">Node font size:</label>
                  <select
                    id="node-font-size-select"
                    value={settings.nodeFontSize}
                    onChange={handleNodeFontSizeChange}
                  >
                    {[
                      4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32,
                    ].map((size) => (
                      <option key={size} value={size}>
                        {size}px
                      </option>
                    ))}
                  </select>
                </div>
                <div className="edge-font-size-picker">
                  <label htmlFor="edge-font-size-select">Edge font size:</label>
                  <select
                    id="edge-font-size-select"
                    value={settings.edgeFontSize}
                    onChange={handleEdgeFontSizeChange}
                  >
                    {[2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28].map(
                      (size) => (
                        <option key={size} value={size}>
                          {size}px
                        </option>
                      ),
                    )}
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

          {activeTab === "history" && (
            <div id="tab-panel-history" /* ... */>
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

          {activeTab === "multiNode" &&
            originNodeIds &&
            originNodeIds.length >= 2 && (
              <div id="tab-panel-multiNode" className="tab-panel active">
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
          {activeTab === "filters" && (
            <div id="tab-panel-collections" className="tab-panel active">
              {/* Collection Filters */}
              <div className="collection-picker">
                <h3>Collection Filters:</h3>
                <FilterableDropdown
                  key="collection-filter"
                  label="Collections"
                  options={allCollections}
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
              {/* Edge Filters */}
              {edgeFilterStatus === "loading" && (
                <div className="option-group">Loading edge filters...</div>
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
                          selectedOptions={settings.edgeFilters[field] || []}
                          onOptionToggle={(value) =>
                            handleEdgeFilterChange(field, value)
                          }
                        />
                      ),
                    )}
                  </div>
                )}
            </div>
          )}

          {activeTab === "export" && (
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
      {/* Render the modal for loading graphs */}
      <LoadGraphModal
        isOpen={isLoadModalOpen}
        onClose={() => setIsLoadModalOpen(false)}
      />
    </div>
  );
};

export default memo(ForceGraph);
