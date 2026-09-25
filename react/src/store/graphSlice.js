import { createAsyncThunk, createSlice, current } from "@reduxjs/toolkit";
import undoable from "redux-undo";
import {
  DEFAULT_COLLAPSE_ON_START,
  DEFAULT_DEPTH,
  DEFAULT_EDGE_DIRECTION,
  DEFAULT_EDGE_FONT_SIZE,
  DEFAULT_FIND_SHORTEST_PATHS,
  DEFAULT_GRAPH_TYPE,
  DEFAULT_INCLUDE_INTER_NODE_EDGES,
  DEFAULT_LABEL_STATES,
  DEFAULT_NODE_FONT_SIZE,
  DEFAULT_SET_OPERATION,
  DEFAULT_USE_FOCUS_NODES,
  GRAPH_STATUS,
} from "../constants";
import {
  fetchEdgeFilterOptions as fetchEdgeFilterOptionsAPI,
  fetchEdgesBetween,
  fetchGraphData,
  fetchNodeExpansion,
} from "../services";
import { composeGraph, getFilterableEdgeFields, performSetOperation } from "../utils";
import { splitEdgeFiltersByMode } from "../utils/edgeFilters";

/**
 * Compose the union of the current origins' subgraphs and fill in cross-origin
 * connecting edges via the edges-between scan. Deduped by id. Pure of Redux —
 * takes the pieces it needs so both thunks share one path.
 *
 * @param {string[]} originNodeIds
 * @param {{ [id]: { nodes, links } }} originSubgraphs
 * @param {{ graphType: string, edgeFilters: object, excludeEdgeFilters: object }} query
 * @returns {Promise<{ nodes: object[], links: object[] }>}
 */
async function composeWithCrossOriginEdges(originNodeIds, originSubgraphs, query) {
  const composed = composeGraph(originNodeIds, originSubgraphs);
  const nodeIds = composed.nodes.map((n) => n._id ?? n.id);
  const crossEdges = await fetchEdgesBetween(
    nodeIds,
    query.graphType,
    query.edgeFilters,
    query.excludeEdgeFilters,
  );

  const linkById = new Map(composed.links.map((l) => [l._id ?? `${l._from}-${l._to}`, l]));
  for (const edge of crossEdges || []) {
    const id = edge._id ?? `${edge._from}-${edge._to}`;
    if (id != null && !linkById.has(id)) {
      linkById.set(id, edge);
    }
  }
  return { nodes: composed.nodes, links: Array.from(linkById.values()) };
}

/**
 * Ensure every id in `originIds` has a captured subgraph, fetching the
 * neighborhood for any that are missing (e.g. after a history restore/load
 * cleared originSubgraphs). Returns a new subgraphs map covering all ids so
 * composeGraph never recomposes over stale/partial data.
 *
 * When a fetched neighborhood omits its own seed node, fall back to the live
 * rendered node from `existingNodes` (which carries the full document —
 * collection, label, position) before resorting to a bare `{ _id }` stub, so
 * a healed origin never contributes a display-less node to the composed graph.
 */
async function ensureOriginSubgraphs(originIds, subgraphs, settings, existingNodes = []) {
  const { include, exclude } = splitEdgeFiltersByMode(
    settings.edgeFilters,
    settings.edgeFilterModes,
  );
  const result = { ...subgraphs };
  for (const id of originIds) {
    if (result[id]) continue;
    const expansion = await fetchNodeExpansion(
      id,
      settings.graphType,
      settings.allowedCollections,
      settings.includeInterNodeEdges ?? true,
      include,
      exclude,
      settings.terminalCollections || [],
    );
    const fetched = expansion?.[id] ?? { nodes: [], links: [] };
    const nodes = [...(fetched.nodes || [])];
    if (!nodes.some((n) => (n._id ?? n.id) === id)) {
      const existing = existingNodes.find((n) => (n._id ?? n.id) === id);
      nodes.push(existing ?? { _id: id });
    }
    result[id] = { nodes, links: fetched.links || [] };
  }
  return result;
}

// Async thunk for fetching graph data.
export const fetchAndProcessGraph = createAsyncThunk(
  "graph/fetchAndProcess",
  async (_, { getState }) => {
    // Retrieve current settings and advanced mode state from Redux.
    const { settings, originNodeIds, isAdvancedMode, perNodeSettings } = getState().graph.present;
    let params;

    if (isAdvancedMode) {
      // If in advanced mode, construct parameters with the per-node settings
      // object. Each node's edgeFilters must be split by the global
      // edgeFilterModes so fields set to "exclude" are sent as
      // excludeEdgeFilters rather than silently treated as include filters.
      const advancedSettings = Object.fromEntries(
        Object.entries(perNodeSettings || {}).map(([nodeId, nodeSettings]) => {
          const { include, exclude } = splitEdgeFiltersByMode(nodeSettings.edgeFilters, {
            ...settings.edgeFilterModes,
            ...(nodeSettings.edgeFilterModes || {}),
          });
          return [nodeId, { ...nodeSettings, edgeFilters: include, excludeEdgeFilters: exclude }];
        }),
      );
      params = {
        nodeIds: originNodeIds,
        advancedSettings,
        graphType: settings.graphType,
        includeInterNodeEdges: settings.includeInterNodeEdges,
      };
    } else {
      // Otherwise, construct parameters using the global settings.
      const { include, exclude } = splitEdgeFiltersByMode(
        settings.edgeFilters,
        settings.edgeFilterModes,
      );
      params = {
        nodeIds: originNodeIds,
        shortestPaths: settings.findShortestPaths,
        depth: settings.depth,
        edgeDirection: settings.edgeDirection,
        allowedCollections: settings.allowedCollections,
        terminalCollections: settings.terminalCollections || [],
        graphType: settings.graphType,
        edgeFilters: include,
        excludeEdgeFilters: exclude,
        includeInterNodeEdges: settings.includeInterNodeEdges,
      };
    }

    try {
      const rawData = await fetchGraphData(params);
      return rawData;
    } catch (error) {
      console.error("Thunk fetch error:", error);
      throw error;
    }
  },
);

/**
 * Async thunk for fetching available edge filter options from backend.
 * Queries configured edge fields for unique values.
 */
export const fetchEdgeFilterOptions = createAsyncThunk(
  "graph/fetchEdgeFilterOptions",
  async (_, { getState }) => {
    // Get graphType from state for API request.
    const { graphType } = getState().graph.present.settings;

    // Get fields to query from util function.
    const fieldsToQuery = getFilterableEdgeFields();
    if (fieldsToQuery.length === 0) {
      return {}; // No fields to fetch.
    }

    return await fetchEdgeFilterOptionsAPI(fieldsToQuery, graphType);
  },
);

/** @typedef {{ nodeId: string, collectionOverride?: string|null }} ExpandNodeArg */

// Async thunk for expanding a single node.
// Fetches neighbors at depth 1 and returns new nodes/links.
// @param {ExpandNodeArg} arg
export const expandNode = createAsyncThunk(
  "graph/expandNode",
  async ({ nodeId, collectionOverride = null }, { getState }) => {
    const { settings } = getState().graph.present;
    const allowedCollections = collectionOverride
      ? [collectionOverride]
      : settings.allowedCollections;
    const terminalCollections = settings.terminalCollections || [];
    const { include, exclude } = splitEdgeFiltersByMode(
      settings.edgeFilters,
      settings.edgeFilterModes,
    );
    const expansionData = await fetchNodeExpansion(
      nodeId,
      settings.graphType,
      allowedCollections,
      settings.includeInterNodeEdges ?? true,
      include,
      exclude,
      terminalCollections,
    );
    return {
      newNodes: expansionData?.[nodeId]?.nodes || [],
      newLinks: expansionData?.[nodeId]?.links || [],
      centerNodeId: nodeId,
    };
  },
);

// Adds a node as a live origin: fetches its neighborhood, stores it as that
// origin's subgraph, recomposes the union, fills cross-origin edges, and
// returns the composed graph for the fulfilled reducer to apply. No full
// re-query of the other origins.
export const addOriginNode = createAsyncThunk(
  "graph/addOriginNode",
  async (nodeId, { getState }) => {
    const { settings, originNodeIds, originSubgraphs, graphData } = getState().graph.present;
    const { include, exclude } = splitEdgeFiltersByMode(
      settings.edgeFilters,
      settings.edgeFilterModes,
    );

    const expansion = await fetchNodeExpansion(
      nodeId,
      settings.graphType,
      settings.allowedCollections,
      settings.includeInterNodeEdges ?? true,
      include,
      exclude,
      settings.terminalCollections || [],
    );
    const fetched = expansion?.[nodeId] ?? { nodes: [], links: [] };

    // Guarantee the origin node itself is in its subgraph even if the
    // neighborhood query omits the seed — fall back to the node already in the
    // live graph (this thunk is invoked on a node already rendered).
    const subgraphNodes = [...(fetched.nodes || [])];
    const hasOrigin = subgraphNodes.some((n) => (n._id ?? n.id) === nodeId);
    if (!hasOrigin) {
      const existing = graphData.nodes.find((n) => (n._id ?? n.id) === nodeId);
      if (existing) subgraphNodes.push(existing);
    }
    const subgraph = { nodes: subgraphNodes, links: fetched.links || [] };

    const nextOriginIds = originNodeIds.includes(nodeId)
      ? originNodeIds
      : [...originNodeIds, nodeId];
    const nextSubgraphs = { ...originSubgraphs, [nodeId]: subgraph };

    const healedSubgraphs = await ensureOriginSubgraphs(
      nextOriginIds,
      nextSubgraphs,
      settings,
      graphData.nodes,
    );
    const graph = await composeWithCrossOriginEdges(nextOriginIds, healedSubgraphs, {
      graphType: settings.graphType,
      edgeFilters: include,
      excludeEdgeFilters: exclude,
    });

    return {
      nodeId,
      originSubgraphs: healedSubgraphs,
      originNodeIds: nextOriginIds,
      graphData: graph,
    };
  },
);

// Removes a node from the live origins: drops its subgraph, recomposes over the
// remaining origins (shared nodes survive, this origin's unshared nodes drop),
// and refills cross-origin edges. No re-query of the surviving origins.
export const removeOriginNode = createAsyncThunk(
  "graph/removeOriginNode",
  async (nodeId, { getState }) => {
    const { settings, originNodeIds, originSubgraphs, graphData } = getState().graph.present;
    const { include, exclude } = splitEdgeFiltersByMode(
      settings.edgeFilters,
      settings.edgeFilterModes,
    );

    const nextOriginIds = originNodeIds.filter((id) => id !== nodeId);
    const nextSubgraphs = { ...originSubgraphs };
    delete nextSubgraphs[nodeId];

    if (nextOriginIds.length === 0) {
      return {
        nodeId,
        originNodeIds: [],
        graphData: { nodes: [], links: [] },
      };
    }

    const healedSubgraphs = await ensureOriginSubgraphs(
      nextOriginIds,
      nextSubgraphs,
      settings,
      graphData.nodes,
    );
    const graph = await composeWithCrossOriginEdges(nextOriginIds, healedSubgraphs, {
      graphType: settings.graphType,
      edgeFilters: include,
      excludeEdgeFilters: exclude,
    });

    return {
      nodeId,
      originSubgraphs: healedSubgraphs,
      originNodeIds: nextOriginIds,
      graphData: graph,
    };
  },
);

// Initial state for graph slice.
const initialState = {
  // User-configurable settings for graph generation and appearance.
  settings: {
    depth: DEFAULT_DEPTH,
    edgeDirection: DEFAULT_EDGE_DIRECTION,
    setOperation: DEFAULT_SET_OPERATION,
    allowedCollections: [], // Collections currently allowed in query
    terminalCollections: [], // Collections returned but never expanded through
    availableCollections: [], // Collections currently in DB
    allCollections: [], // Collections in all DB
    nodeFontSize: DEFAULT_NODE_FONT_SIZE,
    edgeFontSize: DEFAULT_EDGE_FONT_SIZE,
    labelStates: { ...DEFAULT_LABEL_STATES },
    findShortestPaths: DEFAULT_FIND_SHORTEST_PATHS,
    useFocusNodes: DEFAULT_USE_FOCUS_NODES,
    collapseOnStart: DEFAULT_COLLAPSE_ON_START,
    graphType: DEFAULT_GRAPH_TYPE,
    includeInterNodeEdges: DEFAULT_INCLUDE_INTER_NODE_EDGES,
    layoutMode: "force",
    edgeFilters: getFilterableEdgeFields().reduce((acc, field) => {
      acc[field] = [];
      return acc;
    }, {}),
    edgeFilterModes: getFilterableEdgeFields().reduce((acc, field) => {
      acc[field] = "include";
      return acc;
    }, {}),
  },
  // Stores a snapshot of the settings last used to generate the graph.
  lastAppliedSettings: null,
  // Core graph data and state.
  originNodeIds: [], // Initial nodes for graph query.
  // Per-origin captured neighborhoods; the live graph is their client-side union.
  originSubgraphs: {},
  rawData: {}, // Unprocessed data directly from API.
  graphData: {
    // Processed data with positions, ready for D3.
    nodes: [],
    links: [],
  },
  // State for managing node collapse/expand behavior.
  collapsed: {
    initial: [], // Nodes collapsed by default on new graph.
    userDefined: [], // Nodes user has explicitly collapsed.
    userIgnored: [], // Initial nodes user has expanded.
  },
  nodeToCenter: null, // ID of node to center view on after update.
  // Async operation status for UI feedback.
  status: GRAPH_STATUS.IDLE,
  error: null,
  lastActionType: null, // Tracks last action for conditional logic in UI.
  source: null, // Tracks data source: "graph" | "workflow" | null
  availableEdgeFilters: {}, // Stores all unique edge attribute values fetched from API.
  edgeFilterStatus: GRAPH_STATUS.IDLE, // Status for edge filter options fetch.
  // Flag indicating if advanced mode is active for the current query.
  isAdvancedMode: false,
  // Stores the settings for each origin node when in advanced mode.
  perNodeSettings: {},
  // IDs of nodes currently selected via the lasso tool.
  lassoSelectedNodeIds: [],
};
// Redux slice for managing all graph-related state.
const graphSlice = createSlice({
  name: "graph",
  initialState,
  // Synchronous actions and reducers.
  reducers: {
    // Updates single setting in state.
    updateSetting: (state, action) => {
      const { setting, value } = action.payload;
      state.settings[setting] = value;
      state.lastActionType = "updateSetting";
    },
    // Sets final, processed graph data, including node positions.
    // Accepts either {nodes, links} directly, or {graphData, originNodeIds}
    // for workflow-style initialization that also sets origin nodes.
    setGraphData: (state, action) => {
      if (action.payload.graphData) {
        state.graphData = action.payload.graphData;
        state.rawData = action.payload.graphData;
        // A restore/replace of graphData invalidates any previously captured
        // per-origin subgraphs — they described the pre-restore composition.
        // Reset here so a later add/remove-origin recomposes over fresh data
        // instead of stale or partial subgraphs.
        state.originSubgraphs = {};
        if (action.payload.originNodeIds && !action.payload.isRestore) {
          state.originNodeIds = action.payload.originNodeIds;
          state.lastAppliedOriginNodeIds = action.payload.originNodeIds;
          // Restore any saved display settings (filters, collapse-on-start, …)
          // first so a restored graph comes back to its saved configuration.
          if (action.payload.settings) {
            state.settings = { ...state.settings, ...action.payload.settings };
          }
          // Configure display settings for pre-fetched workflow results
          // and snapshot lastAppliedSettings so the "Apply Changes" banner
          // appears when the user changes query-affecting settings. Depth
          // overrides any restored value because the data is already resolved,
          // so re-querying must stay disabled.
          state.settings.depth = 0;
          // useFocusNodes is display-only (see DISPLAY_ONLY_SETTINGS): it draws
          // the donut marking origin nodes and never reaches a query. Forcing
          // it off here bought no re-query protection and left the origins
          // indistinguishable from every other node in the result.
          state.settings.useFocusNodes = true;
          if (action.payload.collapseLeafNodes !== undefined) {
            state.settings.collapseOnStart = action.payload.collapseLeafNodes;
          }
          // Reset collapsed state so ForceGraph can rebuild it from the new data.
          state.collapsed = { initial: [], userDefined: [], userIgnored: [] };
          try {
            state.lastAppliedSettings = JSON.parse(JSON.stringify(state.settings));
          } catch (_err) {
            state.lastAppliedSettings = { ...state.settings };
          }
        } else if (action.payload.isRestore) {
          // A history restore carries the origins its snapshot was captured
          // from, so the panel keeps listing them and the graph keeps marking
          // them. Only a restore with no origins at all (loadGraphFromJson)
          // clears them, so the sidebar never shows phantom origins from the
          // pre-restore composition. Display state is left untouched either
          // way: a restore reinstates positions rather than re-rendering.
          const restoredOrigins = action.payload.originNodeIds || [];
          state.originNodeIds = restoredOrigins;
          state.lastAppliedOriginNodeIds = restoredOrigins;
        }
      } else {
        const graphData = action.payload.nodes
          ? { nodes: action.payload.nodes, links: action.payload.links }
          : action.payload;
        state.graphData = graphData;
        // Only overwrite rawData when this is an API/workflow dispatch (has originNodeIds),
        // not when it's a simulation-end update.
        if (action.payload.originNodeIds) {
          state.rawData = graphData;
        }
      }
      if (action.payload.source) {
        state.source = action.payload.source;
      }
      state.status = GRAPH_STATUS.SUCCEEDED;
      // A restore render (saved-graph load, history recompose) already has
      // fixed node positions and must skip the fresh-query simulation reheat,
      // so flag it distinctly for the ForceGraph render effect to branch on.
      state.lastActionType = action.payload.isRestore ? "restoreGraph" : "setGraphData";
    },
    // Clears graph data, used when navigating away from workflow results to the graph page.
    clearGraphData: (state) => {
      state.graphData = { nodes: [], links: [] };
      state.rawData = {};
      state.originNodeIds = [];
      state.originSubgraphs = {};
      state.source = null;
      state.lassoSelectedNodeIds = [];
      state.lastActionType = null;
    },
    // Resets graph state for new query.
    initializeGraph: (state, action) => {
      const { nodeIds, isAdvancedMode, perNodeSettings } = action.payload;
      state.originNodeIds = nodeIds;
      state.originSubgraphs = {};
      state.lastAppliedOriginNodeIds = nodeIds;

      // Store the advanced mode configuration that will be used for the fetch.
      state.isAdvancedMode = isAdvancedMode;
      state.perNodeSettings = perNodeSettings;

      // Reset graph data and status.
      state.status = GRAPH_STATUS.IDLE;
      state.lastActionType = "initializeGraph";
      state.rawData = {};
      state.graphData = { nodes: [], links: [] };
      state.collapsed = { initial: [], userDefined: [], userIgnored: [] };
      state.lassoSelectedNodeIds = [];
    },
    // Populates available collections after initial fetch.
    setAvailableCollections: (state, action) => {
      state.settings.availableCollections = action.payload;
      // Default value.
      state.settings.allowedCollections = action.payload;
      state.lastActionType = "setAvailableCollections";
    },
    // Populates all collections after initial fetch.
    setAllCollections: (state, action) => {
      state.settings.allCollections = action.payload;
      state.lastActionType = "setAllCollections";
    },
    // Updates user-selected edge filter for a specific field (toggles single value).
    updateEdgeFilter: (state, action) => {
      const { field, value } = action.payload;
      const currentFilters = state.settings.edgeFilters[field] || [];

      // Toggle filter values
      const newFilters = currentFilters.includes(value)
        ? currentFilters.filter((v) => v !== value)
        : [...currentFilters, value];

      // Save current state
      state.settings.edgeFilters = {
        ...state.settings.edgeFilters,
        [field]: newFilters,
      };

      state.lastActionType = "updateEdgeFilter";
    },
    // Sets the include/exclude mode for a specific edge filter field.
    setEdgeFilterMode: (state, action) => {
      const { field, mode } = action.payload;
      state.settings.edgeFilterModes = {
        ...state.settings.edgeFilterModes,
        [field]: mode === "exclude" ? "exclude" : "include",
      };
      state.lastActionType = "setEdgeFilterMode";
    },
    // Updates a numeric edge filter range for a specific field.
    updateNumericEdgeFilter: (state, action) => {
      const { field, min, max } = action.payload;
      state.settings.edgeFilters = {
        ...state.settings.edgeFilters,
        [field]: { min, max },
      };
      state.lastActionType = "updateNumericEdgeFilter";
    },
    // Sets edge filters directly.
    // Merges partial updates into existing filters so callers can pass just the changed property.
    setEdgeFilters: (state, action) => {
      state.settings.edgeFilters = { ...state.settings.edgeFilters, ...action.payload };
      state.lastActionType = "setEdgeFilters";
    },
    // Updates a node's position, typically after user drag.
    // If userPinned is supplied (drag-end, Pin/Unpin actions), copy it onto
    // the node so pin state survives subsequent updateGraph rebuilds — the
    // existing-node-merge in processGraphData preserves it by reference, but
    // the Redux record needs the flag too so a fresh constructor (e.g. after
    // remount) re-hydrates with the correct pin state.
    updateNodePosition: (state, action) => {
      const { nodeId, x, y, userPinned } = action.payload;
      const nodeToUpdate = state.graphData.nodes.find((n) => n.id === nodeId);
      if (nodeToUpdate) {
        nodeToUpdate.x = x;
        nodeToUpdate.y = y;
        if (userPinned !== undefined) {
          nodeToUpdate.userPinned = userPinned;
        }
      }
      state.lastActionType = "updateNodePosition";
    },
    // Stores initial list of nodes to be collapsed.
    setInitialCollapseList: (state, action) => {
      state.collapsed.initial = action.payload;
      state.lastActionType = "setInitialCollapseList";
    },
    // Records user action to expand a node.
    uncollapseNode: (state, action) => {
      const nodeId = action.payload;
      // Remove from user-defined collapse list.
      state.collapsed.userDefined = state.collapsed.userDefined.filter((id) => id !== nodeId);
      // Add to ignore list if it was initially collapsed.
      if (
        state.collapsed.initial.includes(nodeId) &&
        !state.collapsed.userIgnored.includes(nodeId)
      ) {
        state.collapsed.userIgnored.push(nodeId);
      }
      state.lastActionType = "uncollapseNode";
    },
    // Records user action to collapse a node.
    collapseNode: (state, action) => {
      const nodeId = action.payload;
      // Add to user-defined collapse list.
      if (!state.collapsed.userDefined.includes(nodeId)) {
        state.collapsed.userDefined.push(nodeId);
      }
      // Remove from ignore list.
      state.collapsed.userIgnored = state.collapsed.userIgnored.filter((id) => id !== nodeId);
      state.lastActionType = "collapseNode";
    },
    // Clears node centering state.
    clearNodeToCenter: (state) => {
      state.nodeToCenter = null;
      state.lastActionType = "clearNodeToCenter";
    },
    // Loads graph into state
    loadGraph: (state, action) => {
      const { originNodeIds, settings, graphData } = action.payload;
      state.originNodeIds = originNodeIds;
      state.originSubgraphs = {};
      state.settings = settings;
      state.graphData = graphData;
      state.status = GRAPH_STATUS.SUCCEEDED;
      // Ensure lastAppliedSettings reflects the settings that produced this graph.
      try {
        state.lastAppliedSettings = JSON.parse(JSON.stringify(settings));
      } catch (_err) {
        state.lastAppliedSettings = { ...settings };
      }
      state.lastActionType = "loadGraph";
      state.rawData = {};
      state.lassoSelectedNodeIds = [];
    },
    loadGraphFromJson: (state, action) => {
      const graphDataFromFile = action.payload; // Expects { nodes: [], links: [] }

      // Use the nodes from the file as the new graphData.
      state.graphData = graphDataFromFile;

      // Since the file doesn't specify origin nodes, assume no origin nodes
      state.originNodeIds = [];
      state.originSubgraphs = {};
      state.lastAppliedOriginNodeIds = [];

      // Reset settings to a default state.
      state.settings = initialState.settings;
      state.lastAppliedSettings = initialState.settings;

      // Set the state to signal a successful load.
      state.status = GRAPH_STATUS.SUCCEEDED;
      // lastAppliedSettings already set to initial defaults above, ensure deep clone
      try {
        state.lastAppliedSettings = JSON.parse(JSON.stringify(state.settings));
      } catch (_err) {
        state.lastAppliedSettings = { ...state.settings };
      }
      state.lastActionType = "loadGraph";
      state.rawData = {};
      state.lassoSelectedNodeIds = [];
    },
    // Replaces the lasso selection with the given node IDs.
    setLassoSelection: (state, action) => {
      state.lassoSelectedNodeIds = [...new Set(action.payload || [])];
      state.lastActionType = "setLassoSelection";
    },
    // Adds node IDs to the existing lasso selection (set union).
    addToLassoSelection: (state, action) => {
      const incoming = action.payload || [];
      const merged = new Set(state.lassoSelectedNodeIds);
      for (const id of incoming) merged.add(id);
      state.lassoSelectedNodeIds = Array.from(merged);
      state.lastActionType = "addToLassoSelection";
    },
    // Empties the lasso selection.
    clearLassoSelection: (state) => {
      state.lassoSelectedNodeIds = [];
      state.lastActionType = "clearLassoSelection";
    },
    // Bulk version of collapseNode: records multiple node IDs as user-collapsed
    // in a single dispatch. Used by the lasso bulk-delete flow so the graph
    // mutation is a single store update rather than N sequential dispatches.
    collapseNodes: (state, action) => {
      const ids = action.payload || [];
      const userDefined = new Set(state.collapsed.userDefined);
      const ignored = new Set(state.collapsed.userIgnored);
      for (const id of ids) {
        userDefined.add(id);
        ignored.delete(id);
      }
      state.collapsed.userDefined = Array.from(userDefined);
      state.collapsed.userIgnored = Array.from(ignored);
      state.lastActionType = "collapseNodes";
    },
    // Bulk version of updateNodePosition: commits final positions for many
    // nodes after a group drag in a single dispatch. Each entry may include
    // userPinned; copied onto the matching node when present.
    updateNodePositions: (state, action) => {
      const positions = action.payload || [];
      const byId = new Map(positions.map((p) => [p.nodeId, p]));
      for (const node of state.graphData.nodes) {
        const next = byId.get(node.id);
        if (next) {
          node.x = next.x;
          node.y = next.y;
          if (next.userPinned !== undefined) {
            node.userPinned = next.userPinned;
          }
        }
      }
      state.lastActionType = "updateNodePositions";
    },
    // Resets settings to match lastAppliedSettings after undo/redo so the
    // "Apply Changes" banner doesn't appear for the restored graph.
    syncSettingsToLastApplied: (state) => {
      if (state.lastAppliedSettings) {
        state.settings = state.lastAppliedSettings;
      }
    },
    // Releases every user-pin in graphData. Companion to the constructor's
    // unpinAll() — the constructor handles the live D3 nodes; this keeps
    // Redux in sync so a constructor remount (or future setGraphData
    // dispatch) doesn't re-pin nodes that the user just released.
    // Intentionally not added to the redux-undo filter — "Reset positions"
    // is a layout operation, not a topology change, like Restart Simulation.
    clearAllPins: (state) => {
      for (const node of state.graphData.nodes) {
        node.userPinned = false;
      }
      state.lastActionType = "clearAllPins";
    },
    // Removes node ids from the compositional origin bookkeeping without
    // recomposing. Used when nodes are deleted from the view directly (context
    // menu "Remove Node", lasso bulk delete) so a later add/remove-origin
    // recompose can't resurrect a node the user already deleted.
    pruneOrigins: (state, action) => {
      const ids = new Set(action.payload || []);
      if (ids.size === 0) return;
      state.originNodeIds = state.originNodeIds.filter((id) => !ids.has(id));
      for (const id of ids) {
        delete state.originSubgraphs[id];
      }
      state.lastActionType = "pruneOrigins";
    },
  },
  // Reducers for handling async thunk lifecycle actions.
  extraReducers: (builder) => {
    builder
      // Reducers for main graph fetch.
      .addCase(fetchAndProcessGraph.pending, (state) => {
        state.status = GRAPH_STATUS.LOADING;
        state.lastActionType = "fetch/pending";
      })
      .addCase(fetchAndProcessGraph.fulfilled, (state, action) => {
        state.status = GRAPH_STATUS.PROCESSING;
        // Store deep-cloned snapshots so later comparisons are by-value, not by reference.
        try {
          state.lastAppliedSettings = JSON.parse(JSON.stringify(state.settings));
        } catch (_err) {
          // Fallback to shallow copy if cloning fails for some reason.
          state.lastAppliedSettings = { ...state.settings };
        }

        if (state.isAdvancedMode) {
          try {
            state.lastAppliedPerNodeSettings = JSON.parse(JSON.stringify(state.perNodeSettings));
          } catch (_err) {
            state.lastAppliedPerNodeSettings = { ...state.perNodeSettings };
          }
        } else {
          // Clear the snapshot when not in advanced mode to prevent stale comparisons.
          state.lastAppliedPerNodeSettings = null;
        }

        state.rawData = action.payload;
        // Capture each origin's neighborhood so the compositional add/remove-origin
        // flow can recompose from a graph built by the ordinary bulk fetch, not
        // only from graphs assembled via "Add as origin". The standard-traversal
        // payload is keyed by origin id; shortest-path/advanced payloads are not,
        // so we leave originSubgraphs empty for those.
        const capturedSubgraphs = {};
        if (!state.settings.findShortestPaths && !state.isAdvancedMode && action.payload) {
          for (const id of state.originNodeIds) {
            if (action.payload[id]) {
              capturedSubgraphs[id] = action.payload[id];
            }
          }
        }
        state.originSubgraphs = capturedSubgraphs;
        state.lastActionType = "fetch/fulfilled";
      })
      .addCase(fetchAndProcessGraph.rejected, (state, action) => {
        state.status = GRAPH_STATUS.FAILED;
        state.error = action.error.message;
        state.lastActionType = "fetch/rejected";
      })
      // Reducers for edge filter options fetch.
      .addCase(fetchEdgeFilterOptions.pending, (state) => {
        state.edgeFilterStatus = GRAPH_STATUS.LOADING;
      })
      .addCase(fetchEdgeFilterOptions.fulfilled, (state, action) => {
        state.edgeFilterStatus = GRAPH_STATUS.SUCCEEDED;
        // Sort: categorical fields first, then numeric, each alphabetical.
        const entries = Object.entries(action.payload);
        const categorical = entries
          .filter(([, v]) => v.type !== "numeric")
          .sort(([a], [b]) => a.localeCompare(b));
        const numeric = entries
          .filter(([, v]) => v.type === "numeric")
          .sort(([a], [b]) => a.localeCompare(b));
        const sorted = Object.fromEntries([...categorical, ...numeric]);
        state.availableEdgeFilters = sorted;
        // Initialize edgeFilters: empty array for categorical, full {min, max} for numeric.
        for (const [field, filterData] of Object.entries(sorted)) {
          if (!state.settings.edgeFilters[field]) {
            if (filterData.type === "numeric") {
              state.settings.edgeFilters[field] = { min: filterData.min, max: filterData.max };
            } else {
              state.settings.edgeFilters[field] = [];
            }
          }
        }
      })
      .addCase(fetchEdgeFilterOptions.rejected, (state, action) => {
        state.edgeFilterStatus = GRAPH_STATUS.FAILED;
        state.error = action.error.message; // Store error for UI feedback.
        console.error("fetchEdgeFilterOptions rejected:", action.error.message);
      })
      // Reducers for node expansion.
      .addCase(expandNode.pending, (state) => {
        state.lastActionType = "expand/pending";
      })
      .addCase(expandNode.fulfilled, (state, action) => {
        // Get states
        const { newNodes, newLinks, centerNodeId } = action.payload;
        const existingGraph = current(state.graphData);
        const newGraph = { nodes: newNodes, links: newLinks };

        // Perform a union operation to merge the graphs and remove duplicates.
        const mergedGraph = performSetOperation([existingGraph, newGraph], "Union");

        // Update the state.
        state.graphData = mergedGraph;
        state.nodeToCenter = centerNodeId;
        state.lastActionType = "expand/fulfilled";
      })
      .addCase(expandNode.rejected, (state, action) => {
        console.error("Expansion failed:", action.error.message);
        state.status = GRAPH_STATUS.FAILED;
        state.lastActionType = "expand/rejected";
      })
      // Reducers for compositional origin add.
      .addCase(addOriginNode.fulfilled, (state, action) => {
        const { originSubgraphs, originNodeIds, graphData } = action.payload;
        state.originSubgraphs = originSubgraphs;
        state.originNodeIds = originNodeIds;
        state.graphData = graphData;
        state.rawData = graphData;
        state.status = GRAPH_STATUS.SUCCEEDED;
        state.lastActionType = "recompose/add";
      })
      .addCase(addOriginNode.rejected, (state, action) => {
        state.status = GRAPH_STATUS.FAILED;
        state.error = action.error.message;
        state.lastActionType = "recompose/rejected";
      })
      // Reducers for compositional origin remove.
      .addCase(removeOriginNode.fulfilled, (state, action) => {
        const { originNodeIds, graphData, originSubgraphs } = action.payload;
        if (originSubgraphs) {
          state.originSubgraphs = originSubgraphs;
        } else {
          state.originSubgraphs = {};
        }
        state.originNodeIds = originNodeIds;
        state.graphData = graphData;
        state.rawData = graphData;
        state.status = GRAPH_STATUS.SUCCEEDED;
        state.lastActionType = "recompose/remove";
      })
      .addCase(removeOriginNode.rejected, (state, action) => {
        state.status = GRAPH_STATUS.FAILED;
        state.error = action.error.message;
        state.lastActionType = "recompose/rejected";
      });
  },
});

export const {
  updateSetting,
  setGraphData,
  clearGraphData,
  initializeGraph,
  setAvailableCollections,
  setAllCollections,
  clearNodeToCenter,
  updateNodePosition,
  updateNodePositions,
  setInitialCollapseList,
  uncollapseNode,
  collapseNode,
  collapseNodes,
  updateEdgeFilter,
  updateNumericEdgeFilter,
  setEdgeFilterMode,
  setEdgeFilters,
  loadGraph,
  loadGraphFromJson,
  setLassoSelection,
  addToLassoSelection,
  clearLassoSelection,
  syncSettingsToLastApplied,
  clearAllPins,
  pruneOrigins,
} = graphSlice.actions;

// Wrap base reducer with redux-undo.
const undoableGraphReducer = undoable(graphSlice.reducer, {
  // Only create new history states on these specific actions.
  // Skip undo entries for simulation-end dispatches (flagged with skipUndo).
  // syncFilter keeps _latestUnfiltered in sync with present so the undo target
  // is always the most recent state, not a stale snapshot.
  // Note: redux-undo runs the reducer BEFORE calling filter, so the second
  // argument is the state AFTER the reducer. Use previousHistory.present
  // to inspect the state BEFORE the action.
  filter: (action, _newState, previousHistory) => {
    if (action.type === setGraphData.type && action.payload?.skipUndo) return false;
    // Create an undo checkpoint when re-generating a graph (settings change),
    // but not on the very first initialization (empty graph).
    if (action.type === initializeGraph.type) {
      return previousHistory.present.graphData.nodes.length > 0;
    }
    return (
      action.type === setGraphData.type ||
      action.type === updateNodePosition.type ||
      action.type === updateNodePositions.type ||
      action.type === expandNode.fulfilled.type ||
      action.type === addOriginNode.fulfilled.type ||
      action.type === removeOriginNode.fulfilled.type
    );
  },
  ignoreInitialState: true,
  syncFilter: true,
});

export default undoableGraphReducer;
