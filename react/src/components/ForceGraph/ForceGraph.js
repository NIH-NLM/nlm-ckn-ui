import collMaps from "assets/nlm-ckn-collection-maps.json";
import AddToGraphButton from "components/AddToGraphButton";
import DocumentPopup from "components/DocumentPopup";
import ForceGraphConstructor from "components/ForceGraphConstructor/ForceGraphConstructor";
import LoadGraphModal from "components/LoadGraphModal";
import { useGraphDataInit, useHotkeyHold, useHotkeys } from "hooks";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { shallowEqual, useDispatch, useSelector } from "react-redux";
import { ActionCreators } from "redux-undo";
import {
  clearGraphData,
  clearNodeToCenter,
  collapseNode,
  expandNode,
  fetchAndProcessGraph,
  initializeGraph,
  saveGraph,
  setGraphData,
  setInitialCollapseList,
  syncSettingsToLastApplied,
  uncollapseNode,
  updateSetting,
} from "store";
import { getLabel, hasNodesInRawData, isMac, LoadingBar, performSetOperation } from "utils";
// Import extracted hooks
import { useGraphExport, useNodeNames, usePerNodeSettings } from "./hooks";
// Import extracted panels
import {
  ExportPanel,
  FiltersPanel,
  GeneralSettingsPanel,
  HistoryPanel,
  MultiNodePanel,
} from "./panels";

/**
 * Main React component for D3 force-directed graph visualization.
 * Orchestrates Redux state, user interactions, and D3 instance.
 */
const ForceGraph = ({
  // Accept node IDs via props for direct linking (e.g., landing pages).
  nodeIds: _originNodeIdsFromProps = [],
  settings: settingsFromProps,
}) => {
  const dispatch = useDispatch();

  // Refs for DOM elements and D3 graph instance.
  const wrapperRef = useRef();
  const svgRef = useRef();
  const graphInstanceRef = useRef(null);
  const hasInitializedGraph = useRef(false);
  // Track the node and link IDs we've rendered to prevent infinite loops when setGraphData triggers effect
  // (simulation end dispatches setGraphData with same nodes, causing re-render loop)
  const lastRenderedNodeIdsRef = useRef(null);
  const lastRenderedLinkIdsRef = useRef(null);
  // Tracks the layoutMode the D3 instance was last told about. Used to skip the
  // first run of the layoutMode useEffect — on initial mount, the constructor
  // is created with the current layoutMode and updateGraph applies it after
  // the simulation settles. Calling setLayoutMode() during that window would
  // cancel the in-flight waitForAlpha and re-run dispersal on un-settled nodes.
  const lastAppliedLayoutModeRef = useRef(null);

  // Selects origin node IDs from nodesSlice for NodesSlice driven graphs.
  const _nodesSliceOriginNodeIds = useSelector((state) => state.nodesSlice.originNodeIds);

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
    source,
  } = useSelector((state) => state.graph.present, shallowEqual);

  // Select undo and redo state
  const { canUndo, canRedo } = useSelector(
    (state) => ({
      canUndo: state.graph.past.length > 0,
      canRedo: state.graph.future.length > 0,
    }),
    shallowEqual,
  );

  const { settings, lastAppliedSettings, lastAppliedPerNodeSettings } = useSelector(
    (state) => ({
      settings: state.graph.present.settings,
      lastAppliedSettings: state.graph.present.lastAppliedSettings,
      lastAppliedPerNodeSettings: state.graph.present.lastAppliedPerNodeSettings,
    }),
    shallowEqual,
  );

  // Use extracted hooks
  const { nodeNameMap, cachedNames } = useNodeNames(graphData, originNodeIds, settings.graphType);

  const {
    isAdvancedMode,
    perNodeSettings,
    activeOriginNodeId,
    setActiveOriginNodeId,
    isSettingsStale,
    handleSettingChange,
    handleGlobalSettingChange,
    handleAdvancedModeToggle,
  } = usePerNodeSettings(settings, originNodeIds, lastAppliedSettings, lastAppliedPerNodeSettings);

  const exportGraph = useGraphExport(wrapperRef, graphData, originNodeIds);

  // Local component state for UI
  const collectionMaps = useMemo(() => new Map(collMaps.maps), []);
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

  // Gate for prop defaults application
  const hasAppliedPropDefaultsRef = useRef(false);
  const isApplyingPropDefaultsRef = useRef(false);

  // Initialize collections and edge filter options (refetches when graphType changes)
  useGraphDataInit(settings.graphType);

  // Apply defaults from settingsFromProps exactly once on initial load.
  useEffect(() => {
    if (!settingsFromProps || hasAppliedPropDefaultsRef.current) return;
    isApplyingPropDefaultsRef.current = true;

    const incomingGraphType = settingsFromProps.graphType;
    if (incomingGraphType && settings.graphType !== incomingGraphType) {
      dispatch(updateSetting({ setting: "graphType", value: incomingGraphType }));
      return;
    }

    if (!settings.availableCollections || settings.availableCollections.length === 0) {
      return;
    }

    const explicitAllowed = settingsFromProps.allowedCollections;
    if (Array.isArray(explicitAllowed)) {
      const intersected = explicitAllowed.filter((c) => settings.availableCollections.includes(c));
      if (JSON.stringify(intersected) !== JSON.stringify(settings.allowedCollections)) {
        dispatch(updateSetting({ setting: "allowedCollections", value: intersected }));
      }
    } else if (Array.isArray(settingsFromProps.collectionsToPrune)) {
      const newAllowed = settings.availableCollections.filter(
        (coll) => !settingsFromProps.collectionsToPrune.includes(coll),
      );
      if (JSON.stringify(newAllowed) !== JSON.stringify(settings.allowedCollections)) {
        dispatch(updateSetting({ setting: "allowedCollections", value: newAllowed }));
      }
    }

    const { depth, edgeDirection, collapseOnStart, preferredPredicates } = settingsFromProps;
    if (typeof depth === "number" && depth !== settings.depth) {
      dispatch(updateSetting({ setting: "depth", value: depth }));
    }
    if (
      typeof edgeDirection === "string" &&
      edgeDirection &&
      edgeDirection !== settings.edgeDirection
    ) {
      dispatch(updateSetting({ setting: "edgeDirection", value: edgeDirection }));
    }
    if (collapseOnStart && collapseOnStart !== settings.collapseOnStart) {
      dispatch(updateSetting({ setting: "collapseOnStart", value: collapseOnStart }));
    }
    if (Array.isArray(preferredPredicates)) {
      const nextFilters = { ...settings.edgeFilters, Label: preferredPredicates };
      if (JSON.stringify(nextFilters) !== JSON.stringify(settings.edgeFilters)) {
        dispatch(updateSetting({ setting: "edgeFilters", value: nextFilters }));
      }
    }

    hasAppliedPropDefaultsRef.current = true;
    dispatch(fetchAndProcessGraph());
    hasInitializedGraph.current = true;
    isApplyingPropDefaultsRef.current = false;
  }, [
    settingsFromProps,
    settings.graphType,
    settings.availableCollections,
    settings.allowedCollections,
    settings.depth,
    settings.edgeDirection,
    settings.collapseOnStart,
    settings.edgeFilters,
    dispatch,
  ]);

  // Triggers new data fetch when graph is explicitly initialized in the slice.
  useEffect(() => {
    // If the existing data came from a workflow, clear it so the graph page
    // can perform a fresh initialization instead of showing stale data.
    if (graphData?.nodes?.length > 0 && source === "workflow") {
      dispatch(clearGraphData());
      return;
    }
    // Skip if we already have graph data (e.g., from WorkflowBuilder).
    if (graphData?.nodes?.length > 0) return;
    // Skip if a fetch is already in progress (prevents StrictMode double-fire).
    if (status === "loading") return;

    if (
      (lastActionType === "initializeGraph" && settings.allowedCollections.length > 0) ||
      (!hasInitializedGraph.current && lastActionType === "updateSetting")
    ) {
      if (isApplyingPropDefaultsRef.current) return;
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

      for (const entry of entries) {
        if (entry.target === wrapperElement) {
          const { width, height } = entry.contentRect;
          graphInstance.resize(width, height);
        }
      }
    });

    resizeObserver.observe(wrapperElement);
    return () => resizeObserver.disconnect();
  }, []);

  // Memoizes calculation of final list of nodes to collapse.
  const collapseMode = settings.collapseOnStart;
  const finalCollapseList = useMemo(() => {
    const nodesToCollapse = new Set(collapsed.userDefined);
    if (collapseMode && collapseMode !== "off") {
      for (const nodeId of collapsed.initial) {
        if (!collapsed.userIgnored.includes(nodeId)) {
          nodesToCollapse.add(nodeId);
        }
      }
    }
    return Array.from(nodesToCollapse);
  }, [collapseMode, collapsed]);

  // --- Event Handlers ---
  const handleNodeDragEnd = useCallback(
    ({ nodeId, x, y }) => {
      dispatch({ type: "graph/updateNodePosition", payload: { nodeId, x, y } });
    },
    [dispatch],
  );

  const handleSimulationEnd = useCallback(
    (finalNodes, finalLinks) => {
      // Skip if a drag is in flight — otherwise the natural-settle dispatch
      // would route through updateGraph -> runSimulation(true) -> alpha(1)
      // and clobber the drag's gentle warmup.
      if (graphInstanceRef.current?.isDragging?.()) return;
      dispatch(setGraphData({ nodes: finalNodes, links: finalLinks, skipUndo: true }));
    },
    [dispatch],
  );

  const handlePopupClose = () => setPopup({ ...popup, visible: false });

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

  // Main effect for synchronizing D3 instance with Redux state.
  // biome-ignore lint/correctness/useExhaustiveDependencies: complex effect intentionally limited deps
  useEffect(() => {
    const graphInstance = graphInstanceRef.current;
    if (!graphInstance && settings.availableCollections.length > 0) {
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
          nodeForceStrength: -1000,
          width: svgRef.current.clientWidth,
          height: svgRef.current.clientHeight,
          layoutMode: settings.layoutMode || "force",
        },
      );
      graphInstanceRef.current = newGraphInstance;
      // Record the mode the constructor was created with so the layoutMode
      // useEffect skips its initial run.
      lastAppliedLayoutModeRef.current = settings.layoutMode || "force";
      newGraphInstance.resize(wrapperRef.current.clientWidth, wrapperRef.current.clientHeight);
      for (const labelClass in settings.labelStates) {
        newGraphInstance.toggleLabels(settings.labelStates[labelClass], labelClass);
      }

      // If graphData already exists when instance is created (e.g., from WorkflowBuilder),
      // render it immediately since we won't get another action to trigger rendering.
      // Use updateGraph (not restoreGraph) to run the simulation for fresh data.
      if (graphData?.nodes?.length > 0) {
        // Track rendered node and link IDs to prevent duplicate renders (StrictMode, simulation end)
        lastRenderedNodeIdsRef.current = new Set(graphData.nodes.map((n) => n._id || n.id));
        lastRenderedLinkIdsRef.current = new Set(
          graphData.links.map((l) => l._id || `${l.source}-${l.target}`),
        );
        // Mark as initialized to prevent the initialization effect from triggering
        // fetchAndProcessGraph — we already have the data we need.
        hasInitializedGraph.current = true;
        newGraphInstance.updateGraph({
          newOriginNodeIds: originNodeIds,
          newNodes: graphData.nodes,
          newLinks: graphData.links,
          resetData: true,
          labelStates: settings.labelStates,
        });
        return; // Early return since we've handled rendering
      }
    }

    if (isRestoring === true || lastActionType === "loadGraph") {
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
          if (!rawData) return;

          let processedData;
          if (lastActionType === "expand/fulfilled") {
            processedData = graphData;
          } else if (settings.findShortestPaths) {
            processedData = rawData;
          } else {
            const graphsToProcess = originNodeIds.map((nodeId) => rawData[nodeId]).filter(Boolean);
            try {
              processedData = performSetOperation(graphsToProcess, settings.setOperation);
            } catch (err) {
              console.error("Set operation failed; falling back to Union:", err);
              try {
                processedData = performSetOperation(graphsToProcess, "Union");
              } catch (fallbackErr) {
                console.error("Union fallback failed; using empty graph:", fallbackErr);
                processedData = { nodes: [], links: [] };
              }
            }
          }
          let collapseList = finalCollapseList;
          if (lastActionType === "fetch/fulfilled" && collapsed?.initial?.length === 0) {
            const initialCollapseList = processedData.nodes
              .filter((node) => !originNodeIds.includes(node._id))
              .map((node) => node._id);
            dispatch(setInitialCollapseList(initialCollapseList));
            if (collapseMode && collapseMode !== "off") {
              collapseList = initialCollapseList;
            }
          }

          graphInstance.updateGraph({
            newOriginNodeIds: originNodeIds,
            newNodes: processedData.nodes,
            newLinks: processedData.links,
            resetData: lastActionType === "fetch/fulfilled",
            collapseNodes: collapseList,
            collapseMode: collapseMode || "standard",
            centerNodeId: nodeToCenter,
            labelStates: settings.labelStates,
          });

          // Track rendered node and link IDs so the subsequent setGraphData from
          // onSimulationEnd doesn't trigger a redundant updateGraph call.
          lastRenderedNodeIdsRef.current = new Set(processedData.nodes.map((n) => n._id || n.id));
          lastRenderedLinkIdsRef.current = new Set(
            processedData.links.map((l) => l._id || `${l.source}-${l.target}`),
          );

          if (nodeToCenter) {
            dispatch(clearNodeToCenter());
          }
          break;
        }
        case "setGraphData": {
          // Handle direct graph data setting (e.g., from WorkflowBuilder).
          // Use graphInstanceRef.current since graphInstance may be stale if
          // the instance was just created in this same effect run.
          const currentInstance = graphInstanceRef.current;
          if (currentInstance && graphData?.nodes?.length > 0) {
            // Skip if we already rendered this exact set of nodes and links.
            // Prevents duplicate renders from: StrictMode double-mount,
            // simulation end callback, and redundant effect triggers.
            const currentNodeIds = new Set(graphData.nodes.map((n) => n._id || n.id));
            const currentLinkIds = new Set(
              graphData.links.map((l) => l._id || `${l.source}-${l.target}`),
            );
            const lastRenderedNodes = lastRenderedNodeIdsRef.current;
            const lastRenderedLinks = lastRenderedLinkIdsRef.current;

            const nodesMatch =
              lastRenderedNodes &&
              currentNodeIds.size === lastRenderedNodes.size &&
              [...currentNodeIds].every((id) => lastRenderedNodes.has(id));
            const linksMatch =
              lastRenderedLinks &&
              currentLinkIds.size === lastRenderedLinks.size &&
              [...currentLinkIds].every((id) => lastRenderedLinks.has(id));

            if (nodesMatch && linksMatch) {
              break;
            }

            // Build collapse list for workflow results (mirrors fetch/fulfilled logic).
            let collapseList = finalCollapseList;
            if (collapsed?.initial?.length === 0) {
              const initialCollapseList = graphData.nodes
                .filter((node) => !originNodeIds.includes(node._id))
                .map((node) => node._id);
              dispatch(setInitialCollapseList(initialCollapseList));
              if (collapseMode && collapseMode !== "off") {
                collapseList = initialCollapseList;
              }
            }

            // Track this render and update the graph
            lastRenderedNodeIdsRef.current = currentNodeIds;
            lastRenderedLinkIdsRef.current = currentLinkIds;
            currentInstance.updateGraph({
              newOriginNodeIds: originNodeIds,
              newNodes: graphData.nodes,
              newLinks: graphData.links,
              resetData: true,
              collapseNodes: collapseList,
              collapseMode: collapseMode || "standard",
              labelStates: settings.labelStates,
            });
          }
          break;
        }
        default:
          break;
      }
    }
  }, [rawData, graphData, settings.availableCollections]);

  // Updates D3 node font size when setting changes.
  useEffect(() => {
    if (graphInstanceRef.current?.updateNodeFontSize) {
      graphInstanceRef.current.updateNodeFontSize(settings.nodeFontSize);
    }
  }, [settings.nodeFontSize]);

  // Applies layout mode changes to the D3 simulation.
  // Skip the initial-mount call: the constructor is created with the current
  // layoutMode and updateGraph's post-settle branch applies it once data lands.
  // Calling setLayoutMode here would bump simulationGeneration and cancel that
  // in-flight waitForAlpha, then re-run Phase 1 dispersal on un-settled nodes.
  // Only fire when the mode actually changes from what was last applied.
  useEffect(() => {
    try {
      const desired = settings.layoutMode || "force";
      if (lastAppliedLayoutModeRef.current === desired) return;
      if (graphInstanceRef.current?.setLayoutMode) {
        lastAppliedLayoutModeRef.current = desired;
        graphInstanceRef.current.setLayoutMode(desired, settings.labelStates);
      }
    } catch (err) {
      console.error("setLayoutMode error:", err);
    }
  }, [settings.layoutMode]);

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

  // Toggles donut rendering on origin nodes when setting changes.
  useEffect(() => {
    if (graphInstanceRef.current?.toggleFocusNodes) {
      graphInstanceRef.current.toggleFocusNodes(settings.useFocusNodes);
    }
  }, [settings.useFocusNodes]);

  // --- History & Save/Load Handlers ---
  const handleUndo = useCallback(() => {
    setIsRestoring(true);
    dispatch(ActionCreators.undo());
    dispatch(syncSettingsToLastApplied());
  }, [dispatch]);

  const handleRedo = useCallback(() => {
    setIsRestoring(true);
    dispatch(ActionCreators.redo());
    dispatch(syncSettingsToLastApplied());
  }, [dispatch]);

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
    try {
      const current = graphInstanceRef.current?.getCurrentGraph?.();
      if (current) {
        handleSimulationEnd(current.nodes, current.links);
      }
    } catch (err) {
      console.error("Failed to capture graph on simulation off:", err);
    }
  }, [handleSimulationEnd]);

  useHotkeyHold("s", handleSimulationOn, handleSimulationOff);

  // --- Settings Panel Handlers ---
  const handleDepthChange = (e) => handleSettingChange("depth", Number(e.target.value));
  const handleEdgeDirectionChange = (e) => handleSettingChange("edgeDirection", e.target.value);
  const handleNodeFontSizeChange = (e) =>
    handleSettingChange("nodeFontSize", Number.parseInt(e.target.value, 10));
  const handleEdgeFontSizeChange = (e) =>
    handleSettingChange("edgeFontSize", Number.parseInt(e.target.value, 10));
  const handleLeafModeChange = (e) => handleSettingChange("collapseOnStart", e.target.value);
  const handleFocusNodesToggle = (e) => handleSettingChange("useFocusNodes", e.target.checked);
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
  const handleCollectionsClearAll = () => handleSettingChange("allowedCollections", []);
  const handleLabelToggle = (labelClass) => {
    const newLabelStates = {
      ...settings.labelStates,
      [labelClass]: !settings.labelStates[labelClass],
    };
    handleSettingChange("labelStates", newLabelStates);
  };
  const handleOperationChange = (e) => handleGlobalSettingChange("setOperation", e.target.value);
  const handleShortestPathToggle = (e) =>
    handleGlobalSettingChange("findShortestPaths", e.target.checked);

  const handleSimulationRestart = () => {
    graphInstanceRef.current?.setLayoutMode(settings.layoutMode || "force", settings.labelStates);
  };

  // --- Popup Handlers ---
  const handleExpand = () => {
    if (!popup.nodeId) return;
    // Capture the current D3 graph state into Redux before expanding.
    // This ensures redux-undo's _latestUnfiltered has the correct pre-expand
    // graph data, even if onSimulationEnd hasn't fired yet.
    const currentGraph = graphInstanceRef.current?.getCurrentGraph?.();
    if (currentGraph) {
      dispatch(
        setGraphData({ nodes: currentGraph.nodes, links: currentGraph.links, skipUndo: true }),
      );
    }
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

  const toggleOptionsVisibility = () => setOptionsVisible(!optionsVisible);

  return (
    <div
      className={`graph-component-wrapper ${optionsVisible ? "options-open" : "options-closed"}`}
    >
      <div className="graph-main-area">
        <button
          type="button"
          onClick={toggleOptionsVisibility}
          className="toggle-options-button"
          aria-expanded={optionsVisible}
          aria-controls="graph-options-panel"
        >
          {optionsVisible ? "> Hide Options" : "< Show Options"}
        </button>

        {status === "loading" && <LoadingBar />}

        {/* biome-ignore lint/correctness/useUniqueElementIds: legacy id */}
        <div id="chart-container-wrapper" ref={wrapperRef}>
          <svg ref={svgRef} role="img" aria-label="Graph visualization">
            <title>Graph visualization</title>
          </svg>
          {(status === "processing" || status === "succeeded") &&
            !hasNodesInRawData(rawData) &&
            !graphData?.nodes?.length && (
              <output className="no-data-message" aria-live="polite">
                No data found.
              </output>
            )}
          {status === "failed" && (
            <div className="no-data-message error-message" role="alert">
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
            type="button"
            className="document-popup-button"
            onClick={handleExpand}
            style={{ display: !popup.isEdge ? "block" : "none" }}
          >
            Expand
          </button>
          <button
            type="button"
            className="document-popup-button"
            onClick={handleCollapse}
            style={{ display: !popup.isEdge ? "block" : "none" }}
          >
            Collapse Leaves
          </button>
          <button
            type="button"
            className="document-popup-button"
            onClick={handleRemove}
            style={{ display: !popup.isEdge ? "block" : "none" }}
          >
            Remove Node
          </button>
          <AddToGraphButton nodeId={popup.nodeId} text="Add to Graph" />
        </DocumentPopup>
      </div>

      {/* biome-ignore lint/correctness/useUniqueElementIds: legacy id */}
      <div
        id="graph-options-panel"
        className="graph-options-side-panel"
        style={{ display: optionsVisible ? "flex" : "none" }}
        data-testid="graph-options"
      >
        <div className="options-tabs-nav primary-tabs">
          {isSettingsStale && (
            <div className="settings-apply-container">
              <p>Your settings have changed.</p>
              <button
                type="button"
                className="primary-action-button"
                onClick={() => {
                  // Capture the current D3 graph state into Redux so
                  // redux-undo records the pre-regeneration graph for undo.
                  const currentGraph = graphInstanceRef.current?.getCurrentGraph?.();
                  if (currentGraph?.nodes?.length > 0) {
                    dispatch(
                      setGraphData({
                        nodes: currentGraph.nodes,
                        links: currentGraph.links,
                        skipUndo: true,
                      }),
                    );
                  }
                  dispatch(
                    initializeGraph({
                      nodeIds: originNodeIds,
                      isAdvancedMode: isAdvancedMode,
                      perNodeSettings: perNodeSettings,
                    }),
                  );
                }}
              >
                Apply Changes
              </button>
            </div>
          )}
          <button
            type="button"
            className={`tab-button ${activePrimaryTab === "settings" ? "active" : ""}`}
            onClick={() => setActivePrimaryTab("settings")}
          >
            Settings
          </button>
          {originNodeIds && originNodeIds.length >= 2 && (
            <button
              type="button"
              className={`tab-button ${activePrimaryTab === "multiNode" ? "active" : ""}`}
              onClick={() => setActivePrimaryTab("multiNode")}
            >
              Multi-Node
            </button>
          )}
          <button
            type="button"
            className={`tab-button ${activePrimaryTab === "history" ? "active" : ""}`}
            onClick={() => setActivePrimaryTab("history")}
          >
            History
          </button>
          <button
            type="button"
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
                      type="button"
                      key={nodeId}
                      className={`tab-button ${activeOriginNodeId === nodeId ? "active" : ""}`}
                      onClick={() => setActiveOriginNodeId(nodeId)}
                    >
                      {nodeNameMap.get(nodeId) || cachedNames[nodeId] || nodeId}
                    </button>
                  ))}
                </div>
              )}
              <div className="options-tabs-nav secondary-tabs">
                <button
                  type="button"
                  className={`tab-button ${activeSecondaryTab === "general" ? "active" : ""}`}
                  onClick={() => setActiveSecondaryTab("general")}
                >
                  General
                </button>
                <button
                  type="button"
                  className={`tab-button ${activeSecondaryTab === "filters" ? "active" : ""}`}
                  onClick={() => setActiveSecondaryTab("filters")}
                >
                  Filters
                </button>
              </div>
              <div className="tab-panel-content">
                {activeSecondaryTab === "general" && (
                  <GeneralSettingsPanel
                    settings={settings}
                    onDepthChange={handleDepthChange}
                    onEdgeDirectionChange={handleEdgeDirectionChange}
                    onNodeFontSizeChange={handleNodeFontSizeChange}
                    onEdgeFontSizeChange={handleEdgeFontSizeChange}
                    onLabelToggle={handleLabelToggle}
                    onLeafModeChange={handleLeafModeChange}
                    onFocusNodesToggle={handleFocusNodesToggle}
                    onGraphToggle={handleGraphToggle}
                    onLayoutModeChange={(e) =>
                      dispatch(updateSetting({ setting: "layoutMode", value: e.target.value }))
                    }
                    onSimulationRestart={handleSimulationRestart}
                  />
                )}
                {activeSecondaryTab === "filters" && (
                  <FiltersPanel
                    settings={settings}
                    collectionMaps={collectionMaps}
                    availableEdgeFilters={availableEdgeFilters}
                    edgeFilterStatus={edgeFilterStatus}
                    onCollectionChange={handleCollectionChange}
                    onCollectionsClearAll={handleCollectionsClearAll}
                    graphLinks={graphData.links}
                  />
                )}
              </div>
            </>
          )}

          {activePrimaryTab === "multiNode" && originNodeIds && originNodeIds.length >= 2 && (
            <MultiNodePanel
              settings={settings}
              isAdvancedMode={isAdvancedMode}
              onAdvancedModeToggle={handleAdvancedModeToggle}
              onOperationChange={handleOperationChange}
              onShortestPathToggle={handleShortestPathToggle}
            />
          )}

          {activePrimaryTab === "history" && (
            <HistoryPanel
              canUndo={canUndo}
              canRedo={canRedo}
              onUndo={handleUndo}
              onRedo={handleRedo}
              onSave={handleSave}
              onLoad={handleLoad}
            />
          )}

          {activePrimaryTab === "export" && <ExportPanel onExport={exportGraph} />}
        </div>
      </div>

      <LoadGraphModal isOpen={isLoadModalOpen} onClose={() => setIsLoadModalOpen(false)} />
    </div>
  );
};

export default memo(ForceGraph);
