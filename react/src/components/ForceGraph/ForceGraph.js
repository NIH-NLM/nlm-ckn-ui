import collMaps from "assets/nlm-ckn-collection-maps.json";
import DocumentPopup from "components/DocumentPopup";
import GraphCanvasActions from "components/ForceGraph/GraphCanvasActions";
import ForceGraphConstructor from "components/ForceGraphConstructor/ForceGraphConstructor";
import LoadGraphModal from "components/LoadGraphModal";
import { useGraphDataInit, useHotkeyHold, useHotkeys } from "hooks";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { shallowEqual, useDispatch, useSelector, useStore } from "react-redux";
import { ActionCreators } from "redux-undo";
import { fetchNeighborCollections } from "services";
import {
  addHistoryEntry,
  addNodesToSlice,
  addOriginNode,
  addToLassoSelection,
  clearAllPins,
  clearGraphData,
  clearLassoSelection,
  clearNodeToCenter,
  collapseNode,
  collapseNodes,
  expandNode,
  fetchAndProcessGraph,
  initializeGraph,
  pruneOrigins,
  removeNodeFromSlice,
  removeOriginNode,
  saveGraph,
  selectOriginHistory,
  setActiveHistory,
  setGraphData,
  setInitialCollapseList,
  setLassoSelection,
  setNodesSlice,
  syncActiveHistoryEntry,
  syncSettingsToLastApplied,
  uncollapseNode,
  updateNodePositions,
  updateSetting,
} from "store";
import {
  captureGraphThumbnail,
  getLabel,
  hasNodesInRawData,
  isMac,
  LoadingBar,
  performSetOperation,
} from "utils";
import { v4 as uuidv4 } from "uuid";
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
 * Ids of nodes that were in the graph before a recompose but not after — the
 * nodes a "remove as origin" made vanish. Used to drop them from the live D3
 * instance without resetting the layout of survivors.
 * @param {{ nodes: object[] } | null} beforeGraph
 * @param {{ nodes: object[] }} afterGraph
 * @returns {string[]}
 */
export function computeDroppedNodeIds(beforeGraph, afterGraph) {
  if (!beforeGraph?.nodes?.length) return [];
  const surviving = new Set((afterGraph?.nodes || []).map((n) => n._id ?? n.id));
  return beforeGraph.nodes
    .map((n) => n._id ?? n.id)
    .filter((id) => id != null && !surviving.has(id));
}

/**
 * Context-menu label for the origin toggle on a node: an existing origin can be
 * removed, any other node can be added.
 * @param {string} nodeId
 * @param {string[]} originNodeIds
 * @returns {"Add as origin" | "Remove as origin"}
 */
export function originMenuLabel(nodeId, originNodeIds) {
  return originNodeIds?.includes(nodeId) ? "Remove as origin" : "Add as origin";
}

/**
 * Main React component for D3 force-directed graph visualization.
 * Orchestrates Redux state, user interactions, and D3 instance.
 */
const ForceGraph = ({
  // Accept node IDs via props for direct linking (e.g., landing pages).
  nodeIds: _originNodeIdsFromProps = [],
  settings: settingsFromProps,
  onNodeSelect = () => {},
  title,
  // Origins panel wiring. Hosts that render an OriginsSidebar pass a toggle;
  // without one the canvas omits the origins action entirely.
  originsOpen = false,
  onToggleOrigins = null,
}) => {
  const dispatch = useDispatch();
  const store = useStore();

  // Refs for DOM elements and D3 graph instance.
  const wrapperRef = useRef();
  // The element shown full screen: the canvas plus its options panel.
  const graphWrapperRef = useRef(null);
  const svgRef = useRef();
  const graphInstanceRef = useRef(null);
  const hasInitializedGraph = useRef(false);
  // Track the node and link IDs we've rendered to prevent infinite loops when setGraphData triggers effect
  // (simulation end dispatches setGraphData with same nodes, causing re-render loop)
  const lastRenderedNodeIdsRef = useRef(null);
  const lastRenderedLinkIdsRef = useRef(null);
  // Set to true while we know an undo/loadGraph just ran. Concurrent React
  // can commit a stale "setGraphData" render *after* the restore render,
  // which would otherwise drive a case-482 reconciliation that clobbers
  // D3 with the pre-undo data. This ref makes that effect a no-op once.
  const justRestoredRef = useRef(false);
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
    lassoSelectedNodeIds,
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

  // The active history entry gets its snapshot + thumbnail kept current on every
  // settle (see handleSimulationEnd). Mirror it into a ref so the constructor's
  // onSimulationEnd closure reads the latest value, not a stale one.
  const activeHistoryId = useSelector((state) => state.savedGraphs.activeHistoryId);
  const activeHistoryIdRef = useRef(null);
  useEffect(() => {
    activeHistoryIdRef.current = activeHistoryId;
  }, [activeHistoryId]);

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

  // Badge count on the canvas origins action.
  const originCount = originNodeIds?.length ?? 0;

  // Local component state for UI
  const collectionMaps = useMemo(() => new Map(collMaps.maps), []);
  const [isRestoring, setIsRestoring] = useState(false);
  const [optionsVisible, setOptionsVisible] = useState(false);
  const [popup, setPopup] = useState({
    visible: false,
    isEdge: false,
    nodeId: null,
    nodeLabel: null,
    // Whether the right-clicked node is currently user-pinned. Drives the
    // Pin/Unpin button label inside the context menu. Sourced from the live
    // simulation node at handleNodeClick time.
    userPinned: false,
    position: { x: 0, y: 0 },
  });
  const [collectionMenu, setCollectionMenu] = useState({
    open: false,
    loading: false,
    collections: [],
    error: null,
  });
  const abortRef = useRef(null);
  const collectionMenuTriggerRef = useRef(null);
  const [isLoadModalOpen, setIsLoadModalOpen] = useState(false);
  const [lassoMode, setLassoMode] = useState(false);
  // Transient "feature disabled" popup for the (not-yet-enabled) full-screen button.
  // Focus management for the options collapse control: the panel's collapse arrow
  // unmounts when the panel closes, so restore focus to the "Show Options" button.
  const showOptionsButtonRef = useRef(null);
  const restoreFocusOnCloseRef = useRef(false);
  useEffect(() => {
    if (!optionsVisible && restoreFocusOnCloseRef.current) {
      showOptionsButtonRef.current?.focus();
      restoreFocusOnCloseRef.current = false;
    }
  }, [optionsVisible]);

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

    // Not intersected with availableCollections: an unmatched name is inert
    // (the collection is never visited, so there is nothing to prune), and
    // intersecting would silently drop the marker if a dataset lacked it.
    //
    // Absent means "no terminal collections", not "leave whatever is there".
    // Redux settings survive unmount, and only the GS entry in
    // collection-defaults.json carries this key, so treating absence as a
    // no-op leaks the gene page's terminal list onto every page navigated to
    // afterwards. Reset explicitly, the way depth and edgeDirection are always
    // specified.
    const incomingTerminal = Array.isArray(settingsFromProps.terminalCollections)
      ? settingsFromProps.terminalCollections
      : [];
    if (JSON.stringify(incomingTerminal) !== JSON.stringify(settings.terminalCollections)) {
      dispatch(updateSetting({ setting: "terminalCollections", value: incomingTerminal }));
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
    settings.terminalCollections,
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
    ({ nodeId, x, y, userPinned }) => {
      // userPinned is set by the constructor's drag-end handler so the
      // store mirrors the pin state set in-memory on the simulation node.
      dispatch({
        type: "graph/updateNodePosition",
        payload: { nodeId, x, y, userPinned },
      });
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
      // Keep the active history entry's snapshot + thumbnail current, so
      // restoring it later shows the most recent version of the graph rather
      // than its first-resolve capture. Only do the (async, best-effort)
      // thumbnail work when an entry is actually active.
      // Pin the sync to the entry that was active when this settle fired. The
      // thumbnail capture is async, and the active entry can be frozen (and a
      // different one activated) while it is in flight — without the pin, this
      // settle's graph would land in whatever card happened to be active when
      // the capture resolved.
      const targetId = activeHistoryIdRef.current;
      if (!targetId) return;
      const subgraph = { nodes: finalNodes, links: finalLinks };
      captureGraphThumbnail(svgRef.current)
        .then((thumbnail) => dispatch(syncActiveHistoryEntry(subgraph, thumbnail, targetId)))
        .catch(() => dispatch(syncActiveHistoryEntry(subgraph, null, targetId)));
    },
    [dispatch],
  );

  const handlePopupClose = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setCollectionMenu({ open: false, loading: false, collections: [], error: null });
    setPopup({ ...popup, visible: false });
  };

  // Lasso selection callback: replace the selection by default; shift-drag
  // unions with the existing selection.
  //
  // A plain drag auto-exits lasso mode so pan/zoom resumes immediately. A
  // shift-drag stays armed: shift means "keep adding", and disarming would
  // strand the user — the next shift-drag is gated out by the lasso's
  // isEnabled() check and the zoom behavior would swallow it as a pan, so the
  // gesture silently panned the graph instead of extending the selection.
  const handleLassoSelection = useCallback(
    (ids, { shift } = {}) => {
      if (shift) {
        dispatch(addToLassoSelection(ids));
      } else {
        dispatch(setLassoSelection(ids));
      }
      setLassoMode(!!shift);
    },
    [dispatch],
  );

  // Group-drag commit: dispatched once at the end of dragging a selected
  // node so all selected positions land in the store as a single update.
  const handleMultiNodeDragEnd = useCallback(
    (positions) => {
      dispatch(updateNodePositions(positions));
    },
    [dispatch],
  );

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
      // nodeData is the live D3 simulation node — userPinned is set on it by
      // drag-end and setNodePinned and survives merges (preserved by ref in
      // processGraphData).
      userPinned: !!nodeData.userPinned,
      position: { x, y },
    });
  };

  // Left-click selects the node for the inspector; right-click keeps the
  // context menu (handleNodeClick above) without swapping the inspector.
  const handleNodeLeftClick = (e, nodeData) => {
    onNodeSelect(nodeData._id);
  };

  // Double-click toggles the node's user-pin. setNodePinned mutates the live
  // simulation node (fx/fy + userPinned); mirror to Redux via updateNodePosition
  // so the pin persists across a constructor remount and into saved graphs —
  // the same path as the context-menu Pin action (handlePinToggle).
  const handleNodeDoubleClick = (e, nodeData) => {
    const nodeId = nodeData._id || nodeData.id;
    if (!nodeId) return;
    const newPinned = !nodeData.userPinned;
    graphInstanceRef.current?.setNodePinned(nodeId, newPinned);
    dispatch({
      type: "graph/updateNodePosition",
      payload: { nodeId, x: nodeData.x, y: nodeData.y, userPinned: newPinned },
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
          onNodeLeftClick: handleNodeLeftClick,
          onNodeDoubleClick: handleNodeDoubleClick,
          onNodeDragEnd: handleNodeDragEnd,
          onLassoSelection: handleLassoSelection,
          onMultiNodeDragEnd: handleMultiNodeDragEnd,
          interactionCallback: handlePopupClose,
          nodeGroup: (d) => d._id.split("/")[0],
          nodeHover: (d) => {
            const collectionKey = d._id.split("/")[0];
            const collectionName = collectionMaps.has(collectionKey)
              ? collectionMaps.get(collectionKey).display_name
              : collectionKey;
            const label = d.label || d._id;
            return `${label}\n${collectionName}`;
          },
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
        // Build collapse list for workflow-init render (mirrors fetch/fulfilled and setGraphData logic).
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
        newGraphInstance.updateGraph({
          newOriginNodeIds: originNodeIds,
          newNodes: graphData.nodes,
          newLinks: graphData.links,
          resetData: true,
          collapseNodes: collapseList,
          collapseMode: collapseMode || "standard",
          labelStates: settings.labelStates,
        });
        return; // Early return since we've handled rendering
      }
    }

    if (
      isRestoring === true ||
      lastActionType === "loadGraph" ||
      lastActionType === "restoreGraph"
    ) {
      if (graphInstance) {
        graphInstance.restoreGraph({
          nodes: graphData.nodes,
          links: graphData.links,
          labelStates: settings.labelStates,
        });
        lastRenderedNodeIdsRef.current = new Set(graphData.nodes.map((n) => n._id || n.id));
        lastRenderedLinkIdsRef.current = new Set(
          graphData.links.map((l) => l._id || `${l.source}-${l.target}`),
        );
      }
      // Suppress one round of case-482 reconciliation in case a stale
      // setGraphData render commits after this restore.
      justRestoredRef.current = true;
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
          // If a restore just happened, swallow one stale "setGraphData"
          // render that React's concurrent scheduler may have committed
          // after the restore. Re-running updateGraph here would clobber
          // the just-restored D3 state with the pre-undo data.
          if (justRestoredRef.current) {
            justRestoredRef.current = false;
            break;
          }
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
        // Add and remove reconcile the D3 view to the composed graph the same
        // way: merge in composed nodes/links (covering additions a self-heal
        // re-fetch introduced), drop nodes no longer composed, drop stale edges
        // between survivors, and redraw origin donut markers. resetData:false
        // preserves the positions of nodes that persist.
        case "recompose/add":
        case "recompose/remove": {
          const currentInstance = graphInstanceRef.current;
          if (!currentInstance) break;
          const before = currentInstance.getCurrentGraph?.();
          const dropped = computeDroppedNodeIds(before, graphData);
          currentInstance.updateGraph({
            newOriginNodeIds: originNodeIds,
            newNodes: graphData.nodes,
            newLinks: graphData.links,
            collapseNodes: dropped,
            removeNode: dropped.length > 0,
            resetData: false,
            labelStates: settings.labelStates,
          });
          // Drop edges the recompose removed whose endpoints both survived
          // (e.g. an edge contributed only by a removed origin between two
          // shared nodes). removeNode above already dropped edges of removed
          // nodes; these removeLink calls are no-ops for those.
          const composedLinkIds = new Set((graphData.links || []).map((l) => l._id));
          const staleLinks = (before?.links || []).filter(
            (l) => l._id && !composedLinkIds.has(l._id),
          );
          for (const staleLink of staleLinks) {
            currentInstance.updateGraph({
              removeLink: staleLink._id,
              resetData: false,
              labelStates: settings.labelStates,
            });
          }
          // Redraw origin donut markers for the new origin set: the merged
          // render reuses existing node elements, so a promoted node gains its
          // donut and a demoted (but surviving/shared) node loses it.
          currentInstance.setOriginNodeIds?.(originNodeIds);
          lastRenderedNodeIdsRef.current = new Set(graphData.nodes.map((n) => n._id || n.id));
          lastRenderedLinkIdsRef.current = new Set(
            graphData.links.map((l) => l._id || `${l.source}-${l.target}`),
          );
          break;
        }
        default:
          break;
      }
    }
  }, [rawData, graphData, settings.availableCollections]);

  // Origin-set transitions own history bookkeeping. Whenever the live origin
  // set changes, the active entry freezes: it must keep describing the graph it
  // was captured from, so the late simulation-end sync can never overwrite it
  // with the incoming composition. Origins added by the transition are queued
  // rather than captured immediately — a fresh search updates originNodeIds
  // before its data arrives (initializeGraph), so capturing at transition time
  // would stamp the outgoing graph's thumbnail onto the new entry. Each pending
  // origin is captured on the first graphData that actually contains it.
  //
  // Branch by branch:
  //
  // - Undo/redo (isRestoring, set only by handleUndo/handleRedo): replays an
  //   earlier state and, unlike a restore, does not re-point activeHistoryId.
  //   So it freezes on the same rule as any other transition — when the
  //   origin-id key actually changed — but queues nothing, since replaying a
  //   past composition is not a new origin event. An undo that leaves the
  //   origin set alone freezes nothing and keeps the active entry syncing.
  //
  // - Restore (lastActionType === "restoreGraph"): exempt, because the restore
  //   itself re-points activeHistoryId at the entry being restored. It also
  //   deliberately clears originNodeIds, which would otherwise read as a
  //   transition and null out the entry just activated. Adopt the key, clear
  //   the pending queue, and leave the restored entry active and syncing.
  //
  // - Saved-graph load (lastActionType === "loadGraph"): a deliberate wholesale
  //   replacement of the origin set with nothing else re-pointing
  //   activeHistoryId, so it freezes like any other transition but queues no
  //   captures — a loaded graph is not an origin-history event.
  //
  // - First run: graph and savedGraphs state both survive route changes (only
  //   nodesSlice is persistence-whitelisted), so ForceGraph can mount fresh —
  //   via GraphPage's initializeGraph from the URL — with an origin already
  //   live and an unrelated (possibly stale, possibly restored) entry still
  //   active. Freeze first, detaching that entry before any settle can reach
  //   it (on a genuine first mount nothing is active, so the freeze is a
  //   no-op), then queue only origins no existing history entry already covers,
  //   so a remount of an origin that already has a card doesn't duplicate it.
  //   Deliberate tradeoff: on such a remount the freeze detaches and nothing is
  //   re-queued, so the recomposed graph runs with no active card until the
  //   origin set next changes — re-adopting the existing card would re-attach a
  //   card whose snapshot may describe a different composition, reintroducing
  //   the very bug this code prevents.
  //
  // - Origin-set change: freeze, then queue the ids that are new relative to
  //   the previous set. A pure removal queues nothing, so nothing becomes
  //   active.
  const prevOriginIdsRef = useRef(null);
  const pendingOriginIdsRef = useRef([]);
  useEffect(() => {
    // Freezes the active entry: writes the ref directly (handleSimulationEnd
    // reads it, and the effect that mirrors the store into it wouldn't run
    // until after the next render) as well as dispatching, but only when
    // there is actually something active — otherwise this would needlessly
    // re-fire setActiveHistory(null) on every render a freeze branch below is
    // reached (e.g. every render while lastActionType stays "loadGraph").
    const freezeActiveHistoryIfAny = () => {
      if (activeHistoryIdRef.current !== null) {
        activeHistoryIdRef.current = null;
        dispatch(setActiveHistory(null));
      }
    };
    if (isRestoring) {
      // Undo/redo. Checked before the restoreGraph branch below because an undo
      // can land on a past state whose lastActionType happens to be
      // "restoreGraph", and an undo must never take the restore exemption: a
      // restore re-points activeHistoryId, an undo does not. Freeze only when
      // the origin key actually changed — an undo that leaves origins alone is
      // not a transition and must keep the active entry syncing — and queue
      // nothing either way, since replaying a past composition is not a new
      // origin event.
      const undoKey = (originNodeIds ?? []).join("|");
      const originsChanged =
        prevOriginIdsRef.current !== null && prevOriginIdsRef.current !== undoKey;
      prevOriginIdsRef.current = undoKey;
      if (originsChanged) {
        pendingOriginIdsRef.current = [];
        freezeActiveHistoryIfAny();
      }
      return;
    }
    if (lastActionType === "restoreGraph") {
      // Adopt the current origin-id key silently rather than leaving it stale.
      // The settle that immediately follows a restore dispatches its own
      // setGraphData (without isRestore), which flips lastActionType away from
      // "restoreGraph" on the very next render; if prevOriginIdsRef still held
      // the pre-restore key at that point, the unrelated origin-id key change
      // would read as a transition and spuriously freeze the entry the restore
      // just activated, racing its own in-flight sync. Also clear any pending
      // origin so a stale queue entry can't be captured against the restored
      // graphData and hijack the entry the restore just activated.
      prevOriginIdsRef.current = (originNodeIds ?? []).join("|");
      pendingOriginIdsRef.current = [];
      return;
    }
    if (lastActionType === "loadGraph") {
      // A loaded graph replaces the origin set wholesale, but nothing re-points
      // activeHistoryId the way a restore does — so, unlike a restore, the
      // previously active entry must freeze here or the late settle-sync would
      // stamp the loaded graph into it. Adopt the key and clear any pending
      // origin (same reasoning as the restore branch above) but queue nothing:
      // a load creates no history card of its own.
      prevOriginIdsRef.current = (originNodeIds ?? []).join("|");
      pendingOriginIdsRef.current = [];
      freezeActiveHistoryIfAny();
      return;
    }
    const ids = originNodeIds ?? [];
    const key = ids.join("|");

    if (prevOriginIdsRef.current === null) {
      // First run: freeze whatever is active (see comment above the effect —
      // a remount can leave a stale/restored entry active for an origin that
      // is about to compose differently), then queue only origins not already
      // covered by a history entry. Read history non-reactively (via the
      // store, not useSelector) so this stays a one-time check that doesn't
      // change the effect's dependencies or make it re-run when history
      // changes.
      prevOriginIdsRef.current = key;
      freezeActiveHistoryIfAny();
      const coveredOriginIds = new Set(
        selectOriginHistory(store.getState()).map((entry) => entry.originId),
      );
      pendingOriginIdsRef.current = ids.filter((id) => !coveredOriginIds.has(id));
    } else if (prevOriginIdsRef.current !== key) {
      const prevIds = new Set(prevOriginIdsRef.current ? prevOriginIdsRef.current.split("|") : []);
      prevOriginIdsRef.current = key;
      freezeActiveHistoryIfAny();
      // A pure removal adds nothing, so nothing becomes active.
      pendingOriginIdsRef.current = ids.filter((id) => !prevIds.has(id));
    }

    const pending = pendingOriginIdsRef.current;
    if (!pending.length || !graphData?.nodes?.length) return;
    const renderedIds = new Set(graphData.nodes.map((n) => n._id || n.id));
    const ready = pending.filter((id) => renderedIds.has(id));
    if (!ready.length) return;
    // Clear synchronously, before the async capture, so a later graphData change
    // cannot enqueue the same origin twice.
    pendingOriginIdsRef.current = pending.filter((id) => !renderedIds.has(id));

    // Capture the thumbnail once and reuse it for every origin resolving in this
    // run (a multi-origin query shares one graph image). Best-effort: a failed
    // capture yields a null thumbnail but still records each entry, so no origin
    // is silently dropped from history.
    captureGraphThumbnail(svgRef.current)
      .catch(() => null)
      .then((thumbnail) => {
        for (const originId of ready) {
          dispatch(
            addHistoryEntry({
              id: uuidv4(),
              originId,
              label: nodeNameMap?.get(originId) ?? originId,
              subgraph: { nodes: graphData.nodes, links: graphData.links },
              thumbnail,
              timestamp: new Date().toISOString(),
            }),
          );
        }
      });
    // `store` (useStore's return) is a stable reference, so listing it changes
    // nothing at runtime — the history read above stays a one-time,
    // non-subscribed lookup.
  }, [dispatch, store, graphData, originNodeIds, lastActionType, nodeNameMap, isRestoring]);

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

  // Push lasso-mode changes into the D3 instance.
  useEffect(() => {
    graphInstanceRef.current?.setLassoMode?.(lassoMode);
  }, [lassoMode]);

  // Push lasso-selection changes into the D3 instance so the selected nodes
  // get the highlight class applied.
  useEffect(() => {
    graphInstanceRef.current?.setSelectedNodeIds?.(lassoSelectedNodeIds);
  }, [lassoSelectedNodeIds]);

  // Escape key clears the lasso selection and exits lasso mode. This is the
  // single escape hatch if the lasso state ever gets stuck (e.g., if a
  // selection callback throws).
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key !== "Escape") return;
      if (lassoMode) setLassoMode(false);
      if (lassoSelectedNodeIds.length > 0) dispatch(clearLassoSelection());
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [dispatch, lassoMode, lassoSelectedNodeIds.length]);

  // Bulk delete: remove every node currently in the lasso selection in a
  // single store update + a single graph mutation. The setGraphData snapshot
  // creates a redux-undo checkpoint so Ctrl+Z restores the deleted nodes;
  // the confirm dialog still gates the action because wiping many nodes by
  // accident is disruptive even when recoverable.
  const handleBulkDelete = useCallback(() => {
    if (lassoSelectedNodeIds.length === 0) return;
    const count = lassoSelectedNodeIds.length;
    const ok = window.confirm(
      `Remove ${count} selected node${count === 1 ? "" : "s"} from the graph?`,
    );
    if (!ok) return;
    const ids = [...lassoSelectedNodeIds];
    const currentGraph = graphInstanceRef.current?.getCurrentGraph?.();
    if (!currentGraph) return;
    const idSet = new Set(ids);
    const newNodes = currentGraph.nodes.filter((n) => !idSet.has(n._id) && !idSet.has(n.id));
    const newLinks = currentGraph.links.filter((l) => !idSet.has(l.source) && !idSet.has(l.target));
    // See handleRemove for why we need a skipUndo pre-state dispatch — without
    // it, past[] may capture an earlier (often empty) graphData if the initial
    // sim-end hasn't fired yet.
    dispatch(
      setGraphData({ nodes: currentGraph.nodes, links: currentGraph.links, skipUndo: true }),
    );
    dispatch(setGraphData({ nodes: newNodes, links: newLinks }));
    dispatch(collapseNodes(ids));
    graphInstanceRef.current?.updateGraph({
      collapseNodes: ids,
      removeNode: true,
      labelStates: settings.labelStates,
    });
    dispatch(pruneOrigins(ids));
    for (const id of ids) dispatch(removeNodeFromSlice(id));
    dispatch(clearLassoSelection());
  }, [dispatch, lassoSelectedNodeIds, settings.labelStates]);

  // --- History & Save/Load Handlers ---
  const handleUndo = useCallback(() => {
    setIsRestoring(true);
    dispatch(ActionCreators.undo());
    dispatch(syncSettingsToLastApplied());
    dispatch(setNodesSlice(store.getState().graph.present.originNodeIds));
  }, [dispatch, store]);

  const handleRedo = useCallback(() => {
    setIsRestoring(true);
    dispatch(ActionCreators.redo());
    dispatch(syncSettingsToLastApplied());
    dispatch(setNodesSlice(store.getState().graph.present.originNodeIds));
  }, [dispatch, store]);

  const handleSave = useCallback(() => {
    const graphName = window.prompt("Please enter a name for your graph:");
    if (!graphName) return;
    const persist = (thumbnail) => {
      dispatch(
        saveGraph({
          name: graphName,
          originNodeIds: originNodeIds,
          settings: settings,
          graphData: graphData,
          thumbnail,
        }),
      );
      alert(`Graph "${graphName}" saved successfully!`);
    };
    // captureGraphThumbnail is best-effort and resolves to null on failure, but
    // guard the chain so the save is never dropped if it ever rejects.
    captureGraphThumbnail(svgRef.current)
      .then(persist)
      .catch(() => persist(null));
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
    // A collection that is no longer traversed cannot be terminal.
    const currentTerminal = settings.terminalCollections || [];
    const newTerminal = currentTerminal.filter((n) => newAllowed.includes(n));
    if (newTerminal.length !== currentTerminal.length) {
      handleSettingChange("terminalCollections", newTerminal);
    }
  };
  const handleCollectionsClearAll = () => {
    handleSettingChange("allowedCollections", []);
    // Nothing is traversed any more, so nothing can be terminal. Mirrors the
    // per-collection deselect path; otherwise stale pills render against an
    // empty option list.
    if ((settings.terminalCollections || []).length > 0) {
      handleSettingChange("terminalCollections", []);
    }
  };
  const handleTerminalCollectionChange = (name) => {
    const current = settings.terminalCollections || [];
    const newTerminal = current.includes(name)
      ? current.filter((n) => n !== name)
      : [...current, name];
    handleSettingChange("terminalCollections", newTerminal);
  };
  const handleTerminalCollectionsClearAll = () => handleSettingChange("terminalCollections", []);
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

  // Reset positions: clear every user-pin (live D3 + Redux) and reheat the
  // simulation so the layout relaxes from current positions. Companion to
  // Restart Simulation. The constructor's unpinAll handles the data-sim-settled
  // sentinel + reheat lifecycle.
  const handleResetPositions = () => {
    graphInstanceRef.current?.unpinAll?.();
    dispatch(clearAllPins());
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
    dispatch(expandNode({ nodeId: popup.nodeId }));
    handlePopupClose();
  };

  const handleOpenCollectionMenu = async () => {
    if (collectionMenu.open) {
      abortRef.current?.abort();
      abortRef.current = null;
      setCollectionMenu((s) => ({ ...s, open: false }));
      return;
    }
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setCollectionMenu({ open: true, loading: true, collections: [], error: null });
    try {
      const collections = await fetchNeighborCollections(
        popup.nodeId,
        settings.graphType,
        "ANY",
        controller.signal,
      );
      if (abortRef.current !== controller) return;
      setCollectionMenu({
        open: true,
        loading: false,
        collections: [...collections].sort(),
        error: null,
      });
    } catch (err) {
      if (err.name === "AbortError") return;
      if (abortRef.current !== controller) return;
      setCollectionMenu((s) => ({ ...s, loading: false, error: "Failed to load collections" }));
    }
  };

  const handleExpandToCollection = (collectionName) => {
    if (!popup.nodeId) return;
    const currentGraph = graphInstanceRef.current?.getCurrentGraph?.();
    if (currentGraph) {
      dispatch(
        setGraphData({ nodes: currentGraph.nodes, links: currentGraph.links, skipUndo: true }),
      );
    }
    dispatch(uncollapseNode(popup.nodeId));
    dispatch(expandNode({ nodeId: popup.nodeId, collectionOverride: collectionName }));
    handlePopupClose();
  };

  const handleCollectionSubmenuKeyDown = (e) => {
    const items = e.currentTarget.querySelectorAll('[role="menuitem"]');
    const focused = document.activeElement;
    const idx = Array.from(items).indexOf(focused);
    if (e.key === "Escape") {
      setCollectionMenu((s) => ({ ...s, open: false }));
      collectionMenuTriggerRef.current?.focus();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      const next = items[(idx + 1) % items.length];
      next?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const prev = items[(idx - 1 + items.length) % items.length];
      prev?.focus();
    }
  };

  // Toggle the right-clicked node's user-pin. setNodePinned mutates the live
  // simulation node (fx/fy + userPinned). We mirror the change to Redux via
  // updateNodePosition so the store reflects pin state and survives a
  // constructor remount (saved graphs read back the field via the same merge).
  const handlePinToggle = () => {
    if (!popup.nodeId) return;
    const newPinned = !popup.userPinned;
    graphInstanceRef.current?.setNodePinned(popup.nodeId, newPinned);

    // Position comes from the live simulation first, as it does on the
    // double-click path. Resolving only against Redux graphData made this a
    // silent no-op whenever that state lagged what D3 had already rendered:
    // the handler returned before closing the popup, so Pin appeared to do
    // nothing at all.
    // popup.nodeId comes from nodeData._id (see handleNodeClick); match on
    // either field for consistency with the rest of this file (e.g.,
    // handleSimulationEnd merge, expand merge).
    const matches = (n) => (n._id || n.id) === popup.nodeId;
    const node =
      graphInstanceRef.current?.getCurrentGraph?.()?.nodes?.find(matches) ??
      graphData.nodes.find(matches);
    if (node) {
      dispatch({
        type: "graph/updateNodePosition",
        payload: { nodeId: popup.nodeId, x: node.x, y: node.y, userPinned: newPinned },
      });
    }
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
    const targetId = popup.nodeId;
    const currentGraph = graphInstanceRef.current?.getCurrentGraph?.();
    // Bail out without mutating D3 if we can't snapshot the graph for Redux —
    // otherwise the visual would diverge from store state and break undo.
    if (!currentGraph) {
      handlePopupClose();
      return;
    }
    const newNodes = currentGraph.nodes.filter((n) => (n._id || n.id) !== targetId);
    const newLinks = currentGraph.links.filter(
      (l) => l.source !== targetId && l.target !== targetId,
    );
    // First sync Redux to the pre-delete state with skipUndo. This pushes
    // _latestUnfiltered up to the current D3 graph without creating an undo
    // entry — necessary because the redux-undo "syncFilter" pattern only
    // tracks accepted/skipUndo dispatches, and the sim-end dispatch from the
    // initial graph load may not have fired yet. Without this, the next
    // accepted dispatch's past[] entry would capture an earlier (often empty)
    // graphData and undo would restore that instead of the pre-delete graph.
    // Then the post-delete dispatch (filter-accepted) creates the actual undo
    // checkpoint capturing the pre-delete state in past[].
    dispatch(
      setGraphData({ nodes: currentGraph.nodes, links: currentGraph.links, skipUndo: true }),
    );
    dispatch(setGraphData({ nodes: newNodes, links: newLinks }));
    dispatch(collapseNode(targetId));
    graphInstanceRef.current?.updateGraph({
      collapseNodes: [targetId],
      removeNode: true,
      labelStates: settings.labelStates,
    });
    dispatch(pruneOrigins([targetId]));
    dispatch(removeNodeFromSlice(targetId));
    handlePopupClose();
  };

  const handleRemoveEdge = () => {
    if (!popup.nodeId || !popup.isEdge) return;
    const linkId = popup.nodeId;
    const currentGraph = graphInstanceRef.current?.getCurrentGraph?.();
    // Bail out without mutating D3 if we can't snapshot the graph for Redux —
    // otherwise the visual would diverge from store state and break undo.
    if (!currentGraph) {
      handlePopupClose();
      return;
    }
    const newLinks = currentGraph.links.filter((l) => l._id !== linkId);
    // See handleRemove for the rationale on this two-step skipUndo+accepted
    // dispatch dance.
    dispatch(
      setGraphData({ nodes: currentGraph.nodes, links: currentGraph.links, skipUndo: true }),
    );
    dispatch(setGraphData({ nodes: currentGraph.nodes, links: newLinks }));
    graphInstanceRef.current?.updateGraph({
      removeLink: linkId,
      labelStates: settings.labelStates,
    });
    handlePopupClose();
  };

  // "Add as origin" / "Remove as origin" from the node context menu. Both keep
  // the nodesSlice staging cart coherent with the live compositional set.
  const handleOriginToggle = () => {
    if (!popup.nodeId || popup.isEdge) return;
    const nodeId = popup.nodeId;
    if (originNodeIds.includes(nodeId)) {
      dispatch(removeOriginNode(nodeId));
      dispatch(removeNodeFromSlice(nodeId));
    } else {
      dispatch(addOriginNode(nodeId));
      dispatch(addNodesToSlice(nodeId));
    }
    handlePopupClose();
  };

  const openOptions = () => {
    setOptionsVisible(true);
  };
  // Closing via the panel's collapse arrow returns focus to "Show Options".
  const closeOptions = () => {
    restoreFocusOnCloseRef.current = true;
    setOptionsVisible(false);
  };

  return (
    <div
      ref={graphWrapperRef}
      className={`graph-component-wrapper ${optionsVisible ? "options-open" : "options-closed"}`}
    >
      <div className="graph-main-area">
        <div className="graph-title-bar">
          <h2 className="graph-title">{title}</h2>
          <div className="graph-title-actions">
            {/* Collapsed: a "Show Options" button opens the panel. When the panel
                is open, the collapse control is the arrow on the panel's left edge
                (below), matching the Figma design. */}
            {!optionsVisible && (
              <button
                type="button"
                ref={showOptionsButtonRef}
                onClick={openOptions}
                className="toggle-options-button"
                aria-expanded={optionsVisible}
                aria-controls="graph-options-panel"
              >
                <svg
                  aria-hidden="true"
                  focusable="false"
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  width="14"
                  height="14"
                  fill="currentColor"
                  style={{ marginRight: "5px", verticalAlign: "middle" }}
                >
                  <path d="M15.41 7.41 14 6l-6 6 6 6 1.41-1.41L10.83 12z" />
                </svg>
                Show Options
              </button>
            )}
          </div>
        </div>

        {/* Collapse handle pinned to the panel's left edge (Figma "Close arrow" 682:3573). */}
        {optionsVisible && (
          <button
            type="button"
            className="options-collapse-arrow"
            onClick={closeOptions}
            aria-expanded={optionsVisible}
            aria-controls="graph-options-panel"
            aria-label="Hide options"
          >
            <svg
              aria-hidden="true"
              focusable="false"
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              width="14"
              height="14"
              fill="currentColor"
            >
              <path d="M8.59 16.59 13.17 12 8.59 7.41 10 6l6 6-6 6z" />
            </svg>
          </button>
        )}

        {status === "loading" && <LoadingBar />}

        <GraphCanvasActions
          onToggleOrigins={onToggleOrigins}
          originsOpen={originsOpen}
          originCount={originCount}
          lassoMode={lassoMode}
          onToggleLasso={() => setLassoMode((m) => !m)}
          onDownload={() => exportGraph("png")}
          fullscreenTargetRef={graphWrapperRef}
        />

        {/* biome-ignore lint/correctness/useUniqueElementIds: legacy id */}
        <div id="chart-container-wrapper" ref={wrapperRef}>
          {lassoSelectedNodeIds.length > 0 && (
            <div className="lasso-action-bar" role="toolbar" aria-label="Selection actions">
              <span className="lasso-action-bar-count">{lassoSelectedNodeIds.length} selected</span>
              <button type="button" onClick={handleBulkDelete} className="lasso-action-bar-button">
                Delete
              </button>
              <button
                type="button"
                onClick={() => dispatch(clearLassoSelection())}
                className="lasso-action-bar-button"
              >
                Clear
              </button>
            </div>
          )}
          <svg
            ref={svgRef}
            role="img"
            aria-label={
              graphData?.nodes?.length
                ? `Force-directed graph with ${graphData.nodes.length} node${graphData.nodes.length === 1 ? "" : "s"}`
                : "Force-directed graph visualization"
            }
          >
            <title>
              {graphData?.nodes?.length
                ? `Force-directed graph with ${graphData.nodes.length} node${graphData.nodes.length === 1 ? "" : "s"}`
                : "Force-directed graph visualization"}
            </title>
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
            ref={collectionMenuTriggerRef}
            type="button"
            className="document-popup-button"
            aria-haspopup="menu"
            aria-expanded={collectionMenu.open}
            aria-controls="expand-by-collection-submenu"
            onClick={handleOpenCollectionMenu}
            style={{ display: !popup.isEdge ? "block" : "none" }}
          >
            Expand by Collection {collectionMenu.open ? "▴" : "▾"}
          </button>
          {collectionMenu.open && (
            // biome-ignore lint/correctness/useUniqueElementIds: single popup instance; id referenced by aria-controls
            <div
              id="expand-by-collection-submenu"
              role="menu"
              className="document-popup-submenu"
              onKeyDown={handleCollectionSubmenuKeyDown}
            >
              {collectionMenu.loading && (
                <div className="document-popup-submenu-status" aria-live="polite">
                  Loading…
                </div>
              )}
              {!collectionMenu.loading && collectionMenu.error && (
                <div
                  className="document-popup-submenu-status document-popup-submenu-error"
                  role="alert"
                >
                  {collectionMenu.error}
                </div>
              )}
              {!collectionMenu.loading &&
                !collectionMenu.error &&
                collectionMenu.collections.length === 0 && (
                  <div className="document-popup-submenu-status">
                    No neighbors in other collections
                  </div>
                )}
              {!collectionMenu.loading &&
                !collectionMenu.error &&
                collectionMenu.collections.map((name) => (
                  <div role="none" key={name}>
                    <button
                      type="button"
                      role="menuitem"
                      className="document-popup-submenu-item"
                      onClick={() => handleExpandToCollection(name)}
                    >
                      {collectionMaps.get(name)?.display_name ?? name}
                    </button>
                  </div>
                ))}
            </div>
          )}
          <button
            type="button"
            className="document-popup-button"
            onClick={handlePinToggle}
            style={{ display: !popup.isEdge ? "block" : "none" }}
          >
            {popup.userPinned ? "Unpin" : "Pin"}
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
          <button
            type="button"
            className="document-popup-button"
            onClick={handleRemoveEdge}
            style={{ display: popup.isEdge ? "block" : "none" }}
          >
            Remove Edge
          </button>
          <button
            type="button"
            className="document-popup-button"
            onClick={handleOriginToggle}
            style={{ display: !popup.isEdge ? "block" : "none" }}
          >
            {originMenuLabel(popup.nodeId, originNodeIds)}
          </button>
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
                    onResetPositions={handleResetPositions}
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
                    onTerminalCollectionChange={handleTerminalCollectionChange}
                    onTerminalCollectionsClearAll={handleTerminalCollectionsClearAll}
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
