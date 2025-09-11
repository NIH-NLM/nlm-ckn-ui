import { createSlice, createAsyncThunk, current } from "@reduxjs/toolkit";
import undoable from "redux-undo";
import { getFilterableEdgeFields } from "../components/Utils/Utils";
import { performSetOperation } from "../components/ForceGraph/performSetOperation";

// API helper to fetch graph data from backend.
// Handles three types of requests: standard traversal, shortest path, and advanced per-node settings.
const fetchGraphDataAPI = async (params) => {
  const {
    nodeIds,
    shortestPaths,
    depth,
    edgeDirection,
    allowedCollections,
    nodeLimit,
    graphType,
    edgeFilters,
    advancedSettings,
  } = params;

  // Determine if this is a shortest path query.
  const useShortestPath =
    shortestPaths && !advancedSettings && nodeIds.length > 1;

  const endpoint = useShortestPath
    ? "/arango_api/shortest_paths/"
    : "/arango_api/graph/";

  let body;

  if (useShortestPath) {
    // Body for a shortest path query.
    body = {
      node_ids: nodeIds,
      edge_direction: edgeDirection,
    };
  } else if (advancedSettings) {
    // Body for an advanced per-node settings query.
    body = {
      node_ids: nodeIds,
      advanced_settings: advancedSettings,
      graph: graphType,
    };
  } else {
    // Body for a standard traversal query.
    body = {
      node_ids: nodeIds,
      depth,
      edge_direction: edgeDirection,
      allowed_collections: allowedCollections,
      node_limit: nodeLimit,
      graph: graphType,
      edge_filters: edgeFilters,
    };
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch from ${endpoint}`);
  }
  return response.json();
};

// Async thunk for fetching graph data.
export const fetchAndProcessGraph = createAsyncThunk(
  "graph/fetchAndProcess",
  async (_, { getState }) => {
    // Retrieve current settings and advanced mode state from Redux.
    const { settings, originNodeIds, isAdvancedMode, perNodeSettings } =
      getState().graph.present;
    let params;

    if (isAdvancedMode) {
      // If in advanced mode, construct parameters with the per-node settings object.
      params = {
        nodeIds: originNodeIds,
        advancedSettings: perNodeSettings,
        graphType: settings.graphType,
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
      };
    }

    try {
      const rawData = await fetchGraphDataAPI(params);
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

    // Call backend API to get unique field values.
    const response = await fetch(`/arango_api/edge_filter_options/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fields: fieldsToQuery, graph: graphType }),
    });

    if (!response.ok) {
      throw new Error("Edge filter options fetch failed.");
    }

    return await response.json();
  },
);

// Async thunk for expanding a single node.
// Fetches neighbors at depth 1 and returns new nodes/links.
export const expandNode = createAsyncThunk(
  "graph/expandNode",
  async (nodeIdToExpand, { getState }) => {
    const { settings } = getState().graph.present;
    const response = await fetch("/arango_api/graph/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        node_ids: [nodeIdToExpand],
        depth: 1,
        edge_direction: "ANY",
        allowed_collections: [],
        graph: settings.graphType,
        edge_filters: [],
      }),
    });
    if (!response.ok) throw new Error("Expansion fetch failed");
    const expansionData = await response.json();
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
    depth: 2,
    edgeDirection: "ANY",
    setOperation: "Union",
    allowedCollections: [], // Collections currently allowed in query
    availableCollections: [], // Collections currently in DB
    allCollections: [], // Collections in all DB
    nodeFontSize: 12,
    edgeFontSize: 8,
    nodeLimit: 5000,
    labelStates: {
      "collection-label": false,
      "link-source": false,
      "link-label": true,
      "node-label": true,
    },
    findShortestPaths: false,
    useFocusNodes: true,
    collapseOnStart: true,
    graphType: "phenotypes",
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
  status: "idle", // (idle | loading | processing | succeeded | failed)
  error: null,
  lastActionType: null, // Tracks last action for conditional logic in UI.
  availableEdgeFilters: {}, // Stores all unique edge attribute values fetched from API.
  edgeFilterStatus: "idle", // Status for edge filter options fetch.
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
      console.log("Update setting:", value);
      state.lastActionType = "updateSetting";
    },
    // Sets final, processed graph data, including node positions.
    setGraphData: (state, action) => {
      state.graphData = action.payload;
      state.status = "succeeded";
      state.lastActionType = "setGraphData";
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
      state.status = "idle";
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
    // Updates user-selected edge filter for a specific field.
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
      state.collapsed.userDefined = state.collapsed.userDefined.filter(
        (id) => id !== nodeId,
      );
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
      state.collapsed.userIgnored = state.collapsed.userIgnored.filter(
        (id) => id !== nodeId,
      );
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
      state.status = "succeeded";
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
      state.status = "succeeded";
      state.lastActionType = "loadGraph";
      state.rawData = {};
    },
  },
  // Reducers for handling async thunk lifecycle actions.
  extraReducers: (builder) => {
    builder
      // Reducers for main graph fetch.
      .addCase(fetchAndProcessGraph.pending, (state) => {
        state.status = "loading";
        state.lastActionType = "fetch/pending";
      })
      .addCase(fetchAndProcessGraph.fulfilled, (state, action) => {
        state.status = "processing";
        state.lastAppliedSettings = state.settings;
        if (state.isAdvancedMode) {
          state.lastAppliedPerNodeSettings = state.perNodeSettings;
        } else {
          // Clear the snapshot when not in advanced mode to prevent stale comparisons.
          state.lastAppliedPerNodeSettings = null;
        }
        state.rawData = action.payload;
        state.lastActionType = "fetch/fulfilled";
      })
      .addCase(fetchAndProcessGraph.rejected, (state, action) => {
        state.status = "failed";
        state.error = action.error.message;
        state.lastActionType = "fetch/rejected";
      })
      // Reducers for edge filter options fetch.
      .addCase(fetchEdgeFilterOptions.pending, (state) => {
        state.edgeFilterStatus = "loading";
      })
      .addCase(fetchEdgeFilterOptions.fulfilled, (state, action) => {
        state.edgeFilterStatus = "succeeded";
        state.availableEdgeFilters = action.payload;
        // Initialize edgeFilters in settings with empty arrays for each new field.
        // Prevents undefined errors when accessing filters later.
        Object.keys(action.payload).forEach((field) => {
          if (!state.settings.edgeFilters[field]) {
            state.settings.edgeFilters[field] = [];
          }
        });
      })
      .addCase(fetchEdgeFilterOptions.rejected, (state, action) => {
        state.edgeFilterStatus = "failed";
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
        const mergedGraph = performSetOperation(
          [existingGraph, newGraph],
          "Union",
        );

        // Update the state.
        state.graphData = mergedGraph;
        state.nodeToCenter = centerNodeId;
        state.lastActionType = "expand/fulfilled";
      })
      .addCase(expandNode.rejected, (state, action) => {
        console.error("Expansion failed:", action.error.message);
        state.status = "failed";
        state.lastActionType = "expand/rejected";
      });
  },
});

export const {
  updateSetting,
  setGraphData,
  initializeGraph,
  setAvailableCollections,
  setAllCollections,
  clearNodeToCenter,
  updateNodePosition,
  setInitialCollapseList,
  uncollapseNode,
  collapseNode,
  updateEdgeFilter,
  loadGraph,
  loadGraphFromJson,
} = graphSlice.actions;

// Wrap base reducer with redux-undo.
const undoableGraphReducer = undoable(graphSlice.reducer, {
  // Only create new history states on these specific actions.
  filter: (action, currentState, previousHistory) => {
    return (
      action.type === setGraphData.type ||
      action.type === updateNodePosition.type
    );
  },
  ignoreInitialState: true,
});

export default undoableGraphReducer;
