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
  DEFAULT_NODE_LIMIT,
  DEFAULT_SET_OPERATION,
  DEFAULT_USE_FOCUS_NODES,
  GRAPH_STATUS,
} from "../constants";
import {
  fetchEdgeFilterOptions as fetchEdgeFilterOptionsAPI,
  fetchGraphData,
  fetchNodeExpansion,
} from "../services";
import { getFilterableEdgeFields, performSetOperation } from "../utils";

// Async thunk for fetching graph data.
export const fetchAndProcessGraph = createAsyncThunk(
  "graph/fetchAndProcess",
  async (_, { getState }) => {
    // Retrieve current settings and advanced mode state from Redux.
    const { settings, originNodeIds, isAdvancedMode, perNodeSettings } = getState().graph.present;
    let params;

    if (isAdvancedMode) {
      // If in advanced mode, construct parameters with the per-node settings object.
      params = {
        nodeIds: originNodeIds,
        advancedSettings: perNodeSettings,
        graphType: settings.graphType,
        includeInterNodeEdges: settings.includeInterNodeEdges,
      };
    } else {
      // Otherwise, construct parameters using the global settings.
      params = {
        nodeIds: originNodeIds,
        shortestPaths: settings.findShortestPaths,
        depth: settings.depth,
        edgeDirection: settings.edgeDirection,
        allowedCollections: settings.allowedCollections,
        nodeLimit: settings.nodeLimit,
        graphType: settings.graphType,
        edgeFilters: settings.edgeFilters,
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

// Async thunk for expanding a single node.
// Fetches neighbors at depth 1 and returns new nodes/links.
export const expandNode = createAsyncThunk(
  "graph/expandNode",
  async (nodeIdToExpand, { getState }) => {
    const { settings } = getState().graph.present;
    const expansionData = await fetchNodeExpansion(
      nodeIdToExpand,
      settings.graphType,
      settings.allowedCollections,
      settings.includeInterNodeEdges ?? true,
    );
    return {
      newNodes: expansionData?.[nodeIdToExpand].nodes || [],
      newLinks: expansionData?.[nodeIdToExpand].links || [],
      centerNodeId: nodeIdToExpand,
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
    availableCollections: [], // Collections currently in DB
    allCollections: [], // Collections in all DB
    nodeFontSize: DEFAULT_NODE_FONT_SIZE,
    edgeFontSize: DEFAULT_EDGE_FONT_SIZE,
    nodeLimit: DEFAULT_NODE_LIMIT,
    labelStates: { ...DEFAULT_LABEL_STATES },
    findShortestPaths: DEFAULT_FIND_SHORTEST_PATHS,
    useFocusNodes: DEFAULT_USE_FOCUS_NODES,
    collapseOnStart: DEFAULT_COLLAPSE_ON_START,
    graphType: DEFAULT_GRAPH_TYPE,
    includeInterNodeEdges: DEFAULT_INCLUDE_INTER_NODE_EDGES,
    edgeFilters: getFilterableEdgeFields().reduce((acc, field) => {
      acc[field] = [];
      return acc;
    }, {}),
    lastAppliedOriginNodeIds: [],
    lastAppliedPerNodeSettings: null,
  },
  // Stores a snapshot of the settings last used to generate the graph.
  lastAppliedSettings: null,
  // Core graph data and state.
  originNodeIds: [], // Initial nodes for graph query.
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
        if (action.payload.originNodeIds) {
          state.originNodeIds = action.payload.originNodeIds;
          state.lastAppliedOriginNodeIds = action.payload.originNodeIds;
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
      state.lastActionType = "setGraphData";
    },
    // Clears graph data, used when navigating away from workflow results to the graph page.
    clearGraphData: (state) => {
      state.graphData = { nodes: [], links: [] };
      state.rawData = {};
      state.originNodeIds = [];
      state.source = null;
      state.lastActionType = null;
    },
    // Resets graph state for new query.
    initializeGraph: (state, action) => {
      const { nodeIds, isAdvancedMode, perNodeSettings } = action.payload;
      state.originNodeIds = nodeIds;
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
    // Sets edge filters directly.
    // Merges partial updates into existing filters so callers can pass just the changed property.
    setEdgeFilters: (state, action) => {
      state.settings.edgeFilters = { ...state.settings.edgeFilters, ...action.payload };
      state.lastActionType = "setEdgeFilters";
    },
    // Updates a node's position, typically after user drag.
    updateNodePosition: (state, action) => {
      const { nodeId, x, y } = action.payload;
      const nodeToUpdate = state.graphData.nodes.find((n) => n.id === nodeId);
      if (nodeToUpdate) {
        nodeToUpdate.x = x;
        nodeToUpdate.y = y;
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
    },
    loadGraphFromJson: (state, action) => {
      const graphDataFromFile = action.payload; // Expects { nodes: [], links: [] }

      // Use the nodes from the file as the new graphData.
      state.graphData = graphDataFromFile;

      // Since the file doesn't specify origin nodes, assume no origin nodes
      state.originNodeIds = [];
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
        state.availableEdgeFilters = action.payload;
        // Initialize edgeFilters in settings with empty arrays for each new field.
        // Prevents undefined errors when accessing filters later.
        for (const field of Object.keys(action.payload)) {
          if (!state.settings.edgeFilters[field]) {
            state.settings.edgeFilters[field] = [];
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
  setInitialCollapseList,
  uncollapseNode,
  collapseNode,
  updateEdgeFilter,
  setEdgeFilters,
  loadGraph,
  loadGraphFromJson,
} = graphSlice.actions;

// Wrap base reducer with redux-undo.
const undoableGraphReducer = undoable(graphSlice.reducer, {
  // Only create new history states on these specific actions.
  // Skip undo entries for simulation-end dispatches (flagged with skipUndo).
  filter: (action, _currentState, _previousHistory) => {
    if (action.type === setGraphData.type && action.payload?.skipUndo) return false;
    return action.type === setGraphData.type || action.type === updateNodePosition.type;
  },
  ignoreInitialState: true,
});

export default undoableGraphReducer;
