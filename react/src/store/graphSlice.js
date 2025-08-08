import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import undoable from "redux-undo";
import { getFilterableEdgeFields } from "../components/Utils/Utils";

// API helper to fetch graph data from backend.
// Chooses endpoint based on whether shortest path is requested.
const fetchGraphDataAPI = async (params) => {
  const {
    nodeIds,
    shortestPaths,
    depth,
    edgeDirection,
    allowedCollections,
    nodeLimit,
    graphType,
  } = params;

  // Select endpoint for standard traversal or shortest path.
  const endpoint =
    shortestPaths && nodeIds.length > 1
      ? "/arango_api/shortest_paths/"
      : "/arango_api/graph/";

  // Construct request body based on endpoint.
  const body =
    shortestPaths && nodeIds.length > 1
      ? { node_ids: nodeIds, edge_direction: edgeDirection }
      : {
          node_ids: nodeIds,
          depth,
          edge_direction: edgeDirection,
          allowed_collections: allowedCollections,
          node_limit: nodeLimit,
          graph: graphType,
        };

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
// Gathers parameters from current Redux state to make API call.
export const fetchAndProcessGraph = createAsyncThunk(
  "graph/fetchAndProcess",
  async (_, { getState }) => {
    const { settings, originNodeIds } = getState().graph.present;
    const params = {
      nodeIds: originNodeIds,
      shortestPaths: settings.findShortestPaths,
      depth: settings.depth,
      edgeDirection: settings.edgeDirection,
      allowedCollections: settings.allowedCollections,
      nodeLimit: settings.nodeLimit,
      graphType: settings.graphType,
    };
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
    const response = await fetch(
      `/arango_api/edge_filter_options/`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fields: fieldsToQuery, graph: graphType}),
      },
    );

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
        allowed_collections: settings.allowedCollections,
        node_limit: settings.nodeLimit,
        graph: settings.graphType,
      }),
    });
    if (!response.ok) throw new Error("Expansion fetch failed");
    const expansionData = await response.json();
    return {
      newNodes: expansionData.nodes?.[nodeIdToExpand]?.map((d) => d.node) || [],
      newLinks: expansionData.links || [],
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
    allowedCollections: [],
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
    edgeFilters: {},
  },
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
    setGraphData: (state, action) => {
      state.graphData = action.payload;
      state.status = "succeeded";
      state.lastActionType = "setGraphData";
    },
    // Resets graph state for new query.
    initializeGraph: (state, action) => {
      state.originNodeIds = action.payload.nodeIds;
      state.status = "idle";
      state.lastActionType = "initializeGraph";
      state.rawData = {};
      state.graphData = { nodes: [], links: [] };
      state.collapsed = { initial: [], userDefined: [], userIgnored: [] };
    },
    // Populates allowed collections after initial fetch.
    setAvailableCollections: (state, action) => {
      state.settings.allowedCollections = action.payload;
      state.lastActionType = "setAvailableCollections";
    },
    // Updates user-selected edge filter for a specific field.
    updateEdgeFilter: (state, action) => {
      const { field, value } = action.payload; // Example: field: 'source', value: 'ClinVar'
      // Ensure field exists in settings.edgeFilters, initialize if not.
      if (!state.settings.edgeFilters[field]) {
        state.settings.edgeFilters[field] = [];
      }

      const currentFilters = state.settings.edgeFilters[field];
      const newFilters = currentFilters.includes(value)
        ? currentFilters.filter((v) => v !== value) // Remove filter if already present.
        : [...currentFilters, value]; // Add filter if not present.

      state.settings.edgeFilters[field] = newFilters;
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
        const { newNodes, newLinks, centerNodeId } = action.payload;

        // Merge new data from expansion into existing rawData.
        const firstOrigin = state.originNodeIds[0];
        const currentNodes =
          firstOrigin && state.rawData.nodes[firstOrigin]
            ? [...state.rawData.nodes[firstOrigin]]
            : [];
        const currentLinks = [...(state.rawData.links || [])];
        const existingNodeIds = new Set(currentNodes.map((n) => n.node._id));
        const existingLinkIds = new Set(currentLinks.map((l) => l._id));

        newNodes.forEach((node) => {
          if (!existingNodeIds.has(node._id)) {
            currentNodes.push({ node: node, path: null });
          }
        });
        newLinks.forEach((link) => {
          if (!existingLinkIds.has(link._id)) {
            currentLinks.push(link);
          }
        });

        // Update state with merged data.
        if (firstOrigin) {
          state.rawData.nodes[firstOrigin] = currentNodes;
        }
        state.rawData.links = currentLinks;
        state.nodeToCenter = centerNodeId;
        state.status = "processing";
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
  clearNodeToCenter,
  updateNodePosition,
  setInitialCollapseList,
  uncollapseNode,
  collapseNode,
  updateEdgeFilter,
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
