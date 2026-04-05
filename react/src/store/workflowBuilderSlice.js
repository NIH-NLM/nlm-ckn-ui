/**
 * Redux slice for the Workflow Builder feature.
 *
 * Manages multi-phase workflow state including:
 * - Workflow configuration (phases, settings)
 * - Phase execution and results
 * - Loading and saving presets
 *
 * Results storage: `state.phaseResults[phaseId]` is the source of truth for
 * phase results. `phase.result` is a convenience reference that is ALWAYS
 * derived from `phaseResults`. Any code that clears or sets results must
 * update BOTH to keep them in sync.
 */

import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import { createEmptyPhase, DEFAULT_GRAPH_TYPE, GRAPH_STATUS, UI_DEFAULTS } from "../constants";
import {
  fetchCollectionDocuments,
  fetchConnectingPaths,
  fetchEdgesBetween,
  fetchGraphData,
  fetchNodeDetailsByIds,
} from "../services";
import { performSetOperation } from "../utils";

/**
 * Generates a unique ID for workflows and phases.
 * @returns {string} A unique identifier.
 */
const generateId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

/**
 * Creates a new empty phase and links it to the last phase in the given array.
 * Wraps createEmptyPhase to consolidate previousPhaseId logic.
 * @param {Array} existingPhases - The current phases array.
 * @returns {Object} A new phase object with previousPhaseId set.
 */
const createLinkedPhase = (existingPhases) => {
  const newPhase = createEmptyPhase(existingPhases.length);
  if (existingPhases.length > 0) {
    newPhase.previousPhaseId = existingPhases[existingPhases.length - 1].id;
  }
  return newPhase;
};

/**
 * Filters nodes from a phase result based on the filter type.
 * @param {Array} nodes - Nodes from the phase result.
 * @param {string} filter - Filter type: "all", "leafNodes", or "originNodes".
 * @param {Array} originNodeIds - IDs of the origin nodes for the phase.
 * @returns {Array<string>} Filtered node IDs.
 */
const filterNodesForNextPhase = (nodes, filter, originNodeIds = []) => {
  if (!nodes || nodes.length === 0) return [];

  switch (filter) {
    case "leafNodes": {
      // Leaf nodes are those that have no outgoing edges in the result
      // For simplicity, we'll consider nodes that aren't origin nodes as leaves
      const originSet = new Set(originNodeIds);
      return nodes.filter((n) => !originSet.has(n._id)).map((n) => n._id);
    }
    case "originNodes": {
      // Return only the origin nodes that appear in the result
      const resultIds = new Set(nodes.map((n) => n._id));
      return originNodeIds.filter((id) => resultIds.has(id));
    }
    default:
      // "all" and any other value: return all node IDs
      return nodes.map((n) => n._id);
  }
};

/**
 * Recursively invalidates cached results for all phases downstream of the
 * given phase. A phase is downstream if its previousPhaseId or
 * previousPhaseIds includes the given phaseId, or if it transitively depends
 * on such a phase.
 * @param {Object} state - The workflowBuilder state (Immer draft).
 * @param {string} phaseId - The phase whose downstream dependents to invalidate.
 */
const invalidateDownstream = (state, phaseId) => {
  for (const phase of state.phases) {
    if (
      phase.previousPhaseId === phaseId ||
      (phase.previousPhaseIds && phase.previousPhaseIds.includes(phaseId))
    ) {
      if (state.phaseResults[phase.id]) {
        delete state.phaseResults[phase.id];
        // phase.result is a convenience mirror of phaseResults — clear both
        phase.result = null;
        invalidateDownstream(state, phase.id); // recurse
      }
    }
  }
};

/**
 * Helper to clear results for a phase. Ensures both phaseResults and
 * phase.result are always cleared together.
 * @param {Object} state - The workflowBuilder state (Immer draft).
 * @param {string} phaseId - The phase ID to clear results for.
 */
const clearPhaseResult = (state, phaseId) => {
  delete state.phaseResults[phaseId];
  const phase = state.phases.find((p) => p.id === phaseId);
  if (phase) {
    phase.result = null;
  }
};

/**
 * Helper to set results for a phase. Writes to phaseResults (source of truth)
 * and mirrors the value to phase.result for convenience.
 * @param {Object} state - The workflowBuilder state (Immer draft).
 * @param {string} phaseId - The phase ID to set results for.
 * @param {Object} result - The result data.
 */
const setPhaseResult = (state, phaseId, result) => {
  state.phaseResults[phaseId] = result;
  // phase.result is a convenience mirror — always derived from phaseResults
  const phase = state.phases.find((p) => p.id === phaseId);
  if (phase) {
    phase.result = state.phaseResults[phaseId];
  }
};

/**
 * Filters a graph result to only include nodes belonging to the specified
 * collections, and prunes links whose endpoints are no longer present.
 * Returns the original result unchanged if returnCollections is empty.
 * @param {{ nodes: Array, links: Array }} result - The graph result to filter.
 * @param {Array<string>} returnCollections - Collection prefixes to keep.
 * @returns {{ nodes: Array, links: Array }} The filtered (or original) result.
 */
const filterResultByCollections = (result, returnCollections) => {
  if (!returnCollections || returnCollections.length === 0) {
    return result;
  }
  const filteredNodes = result.nodes.filter((node) => {
    const collection = node._id?.split("/")[0];
    return returnCollections.includes(collection);
  });
  const remainingIds = new Set(filteredNodes.map((n) => n._id));
  const filteredLinks = result.links.filter((link) => {
    const fromId = link._from || (typeof link.source === "object" ? link.source._id : link.source);
    const toId = link._to || (typeof link.target === "object" ? link.target._id : link.target);
    return remainingIds.has(fromId) && remainingIds.has(toId);
  });
  return { nodes: filteredNodes, links: filteredLinks };
};

/**
 * Async thunk for executing a single phase.
 * Takes a phaseId and looks up the phase from current state, avoiding stale
 * index references if phases are modified during execution.
 */
export const executePhase = createAsyncThunk(
  "workflowBuilder/executePhase",
  async ({ phaseId }, { getState }) => {
    const { phases, phaseResults } = getState().workflowBuilder;
    const phase = phases.find((p) => p.id === phaseId);

    if (!phase) {
      throw new Error(`Phase with id ${phaseId} not found`);
    }

    // Return cached result if available (cache is cleared when settings change)
    const cachedResult = phaseResults[phase.id];
    if (cachedResult) {
      return {
        phaseId: phase.id,
        result: cachedResult,
        originNodeIds: phase._executedOriginNodeIds || phase.originNodeIds,
        cached: true,
      };
    }

    // Handle "collection" origin — fetch all node IDs from a collection
    let collectionOriginNodeIds = null;
    if (phase.originSource === "collection" && phase.originCollection) {
      const graphType = phase.settings.graphType || DEFAULT_GRAPH_TYPE;
      const docs = await fetchCollectionDocuments(phase.originCollection, graphType);
      collectionOriginNodeIds = Object.values(docs)
        .map((doc) => doc._id)
        .filter(Boolean);
      if (collectionOriginNodeIds.length === 0) {
        throw new Error(`No nodes found in collection "${phase.originCollection}".`);
      }
      // Falls through to normal execution below using collectionOriginNodeIds
    }

    // Handle "multiplePhases" combine origin — no API call, pure set operation
    if (phase.originSource === "multiplePhases") {
      const sourcePhaseIds = phase.previousPhaseIds || [];
      if (sourcePhaseIds.length < 2) {
        throw new Error("Combine phase requires at least 2 source phases.");
      }

      // Collect results from each source phase, applying originFilter per source
      const sourceGraphs = [];
      for (const srcId of sourcePhaseIds) {
        const srcResult = phaseResults[srcId];
        if (!srcResult || !srcResult.nodes) {
          throw new Error(`Source phase has no results. Execute it first.`);
        }
        const srcPhase = phases.find((p) => p.id === srcId);
        const srcOriginIds = srcPhase?._executedOriginNodeIds || srcPhase?.originNodeIds || [];
        const filteredIds = filterNodesForNextPhase(
          srcResult.nodes,
          phase.originFilter,
          srcOriginIds,
        );
        const filteredIdSet = new Set(filteredIds);
        const filteredNodes = srcResult.nodes.filter((n) => filteredIdSet.has(n._id));
        const filteredLinks = (srcResult.links || []).filter((link) => {
          const from = link?._from;
          const to = link?._to;
          return filteredIdSet.has(from) && filteredIdSet.has(to);
        });
        sourceGraphs.push({ nodes: filteredNodes, links: filteredLinks });
      }

      // Apply combine set operation
      const combineOp = phase.phaseCombineOperation || "Intersection";
      const combinedResult = filterResultByCollections(
        performSetOperation(sourceGraphs, combineOp),
        phase.settings.returnCollections || [],
      );

      return {
        phaseId: phase.id,
        result: combinedResult,
        originNodeIds: sourcePhaseIds,
      };
    }

    // Determine origin node IDs
    let originNodeIds;
    if (collectionOriginNodeIds) {
      originNodeIds = collectionOriginNodeIds;
    } else if (phase.originSource === "previousPhase" && phase.previousPhaseId) {
      const prevResult = phaseResults[phase.previousPhaseId];
      if (!prevResult || !prevResult.nodes) {
        throw new Error("Previous phase has no results. Execute it first.");
      }
      // Find the previous phase to get its origin node IDs for filtering
      // Prefer _executedOriginNodeIds (set during execution) over originNodeIds
      // because chained phases have empty originNodeIds
      const prevPhase = phases.find((p) => p.id === phase.previousPhaseId);
      const prevOriginIds = prevPhase?._executedOriginNodeIds || prevPhase?.originNodeIds || [];
      originNodeIds = filterNodesForNextPhase(prevResult.nodes, phase.originFilter, prevOriginIds);
    } else {
      originNodeIds = phase.originNodeIds;
    }

    if (!originNodeIds || originNodeIds.length === 0) {
      throw new Error("No origin nodes specified for this phase.");
    }

    // Get all available collections from graph state for the advanced settings
    const graphState = getState().graph?.present;
    const allCollections = graphState?.settings?.allCollections || [];
    const availableCollections = graphState?.settings?.availableCollections || allCollections;

    // Build per-node advanced settings
    // Start with shared settings, then override with per-node settings if present
    const advancedSettings = {};
    const perNodeSettings = phase.perNodeSettings || {};

    for (const nodeId of originNodeIds) {
      // Get per-node overrides for this specific node
      const nodeOverrides = perNodeSettings[nodeId] || {};

      advancedSettings[nodeId] = {
        // Use per-node override if available, otherwise use shared phase settings
        depth: nodeOverrides.depth ?? phase.settings.depth,
        edgeDirection: nodeOverrides.edgeDirection ?? phase.settings.edgeDirection,
        setOperation: phase.settings.setOperation || "Union",
        allowedCollections: nodeOverrides.allowedCollections ?? phase.settings.allowedCollections,
        availableCollections,
        allCollections,
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
        useFocusNodes: phase.settings.useFocusNodes ?? true,
        collapseOnStart: phase.settings.collapseLeafNodes ?? false,
        graphType: phase.settings.graphType,
        includeInterNodeEdges: phase.settings.includeInterNodeEdges ?? true,
        edgeFilters: nodeOverrides.edgeFilters ??
          phase.settings.edgeFilters ?? { Label: [], Source: [] },
        lastAppliedOriginNodeIds: [],
        lastAppliedPerNodeSettings: null,
      };
    }

    let mergedResult;

    // "Connected Paths" uses a dedicated API to find shortest paths between origins
    if (phase.settings.setOperation === "Connected Paths") {
      mergedResult = await fetchConnectingPaths({
        nodeIds: originNodeIds,
        graphType: phase.settings.graphType,
        allowedCollections: phase.settings.allowedCollections,
        edgeFilters: phase.settings.edgeFilters,
        maxDepth: phase.settings.depth || undefined,
      });
    } else {
      // Standard flow: traverse from each origin, then merge with set operation
      const params = {
        nodeIds: originNodeIds,
        advancedSettings,
        graphType: phase.settings.graphType,
        includeInterNodeEdges: phase.settings.includeInterNodeEdges ?? true,
      };

      const rawData = await fetchGraphData(params);

      const graphsArray = Object.values(rawData).map((data) => ({
        nodes: data.nodes || [],
        links: data.links || [],
      }));

      mergedResult = performSetOperation(
        graphsArray,
        phase.settings.setOperation || "Union",
        phase.settings.minOverlap,
      );

      // For "Intersection with Origins", add back origin nodes and their edges
      if (phase.settings.setOperation === "Intersection with Origins") {
        const existingIds = new Set(mergedResult.nodes.map((n) => n._id || n.id));
        const addedNodes = [...mergedResult.nodes];
        const addedLinks = [...mergedResult.links];
        const linkKeys = new Set(
          addedLinks.map((l) => l._id || `${l._from}->${l._to}`),
        );

        for (const originId of originNodeIds) {
          if (existingIds.has(originId)) continue;
          const originData = rawData[originId];
          if (originData) {
            const originNode = originData.nodes?.find((n) => (n._id || n.id) === originId);
            if (originNode) {
              addedNodes.push(originNode);
              existingIds.add(originId);
            }
          }
        }

        for (const data of Object.values(rawData)) {
          for (const link of data.links || []) {
            const key = link._id || `${link._from}->${link._to}`;
            if (linkKeys.has(key)) continue;
            if (existingIds.has(link._from) && existingIds.has(link._to)) {
              addedLinks.push(link);
              linkKeys.add(key);
            }
          }
        }

        mergedResult = { nodes: addedNodes, links: addedLinks };
      }
    }

    // Post-merge inter-node edge scan: find edges between nodes that
    // came from different origins (e.g., origin nodes added back after
    // intersection may have edges to result nodes not yet discovered).
    if (phase.settings.includeInterNodeEdges !== false && mergedResult.nodes?.length >= 2) {
      const allNodeIds = mergedResult.nodes.map((n) => n._id || n.id).filter(Boolean);
      const existingLinkIds = new Set(mergedResult.links.map((l) => l._id).filter(Boolean));
      const interEdges = await fetchEdgesBetween(allNodeIds, phase.settings.graphType);
      const nodeIdSet = new Set(allNodeIds);
      for (const edge of interEdges) {
        if (!edge?._id || existingLinkIds.has(edge._id)) continue;
        if (nodeIdSet.has(edge._from) && nodeIdSet.has(edge._to)) {
          mergedResult.links.push(edge);
          existingLinkIds.add(edge._id);
        }
      }
    }

    // Filter results to only include nodes from specified collections (if set)
    const finalResult = filterResultByCollections(
      mergedResult,
      phase.settings.returnCollections || [],
    );

    // Check for empty results and provide a helpful message
    if (!finalResult.nodes || finalResult.nodes.length === 0) {
      const op = phase.settings.setOperation || "Union";
      if (op === "Connected Paths") {
        const depth = phase.settings.depth;
        throw new Error(
          `No connecting paths found at depth ${depth}. ` +
            "Try increasing the depth to find longer paths between the origin nodes.",
        );
      }
      throw new Error("No results found for this phase configuration.");
    }

    return {
      phaseId: phase.id,
      result: finalResult,
      originNodeIds, // Store which nodes were actually used
    };
  },
);

/**
 * Async thunk for fetching node details (for display names).
 */
export const fetchNodeDetails = createAsyncThunk(
  "workflowBuilder/fetchNodeDetails",
  async ({ nodeIds, graphType = DEFAULT_GRAPH_TYPE }, { getState }) => {
    const { nodeDetails } = getState().workflowBuilder;
    // Only fetch nodes we don't already have
    const missingIds = nodeIds.filter((id) => !nodeDetails[id]);
    if (missingIds.length === 0) {
      return {};
    }
    const details = await fetchNodeDetailsByIds(missingIds, graphType);
    // Convert array to map keyed by _id
    const detailsMap = {};
    for (const node of details) {
      detailsMap[node._id] = node;
    }
    return detailsMap;
  },
);

/**
 * Async thunk for executing all phases in sequence.
 * Captures phase IDs at the start to avoid stale index references if
 * phases are modified during execution.
 */
export const executeWorkflow = createAsyncThunk(
  "workflowBuilder/executeWorkflow",
  async (_, { getState, dispatch }) => {
    const { phases } = getState().workflowBuilder;
    const phaseIds = phases.map((p) => p.id);
    const results = {};

    for (let i = 0; i < phaseIds.length; i++) {
      const phaseId = phaseIds[i];
      const action = await dispatch(executePhase({ phaseId }));
      if (executePhase.rejected.match(action)) {
        throw new Error(`Phase ${i + 1} failed: ${action.error.message}`);
      }
      results[phaseId] = action.payload.result;
    }

    return results;
  },
);

// Initial state
const initialState = {
  // Workflow metadata
  workflowId: null,
  workflowName: "",
  workflowDescription: "",

  // Phases configuration
  phases: [createEmptyPhase(0)],

  // Execution results keyed by phase ID (source of truth for results)
  phaseResults: {},

  // Node details cache (nodeId -> node object with label, etc.)
  nodeDetails: {},

  // Currently active phase (for display)
  activePhaseId: null,

  // The graph currently being displayed (from any phase)
  activeGraph: null,

  // Status tracking
  status: GRAPH_STATUS.IDLE,
  executingPhaseId: null,
  error: null,

  // UI state - show preset selector until user picks something
  showPresetSelector: true,
};

const workflowBuilderSlice = createSlice({
  name: "workflowBuilder",
  initialState,
  reducers: {
    /**
     * Initialize a new empty workflow.
     */
    initializeWorkflow: (state) => {
      state.workflowId = generateId();
      state.workflowName = "";
      state.workflowDescription = "";
      state.phases = [createEmptyPhase(0)];
      state.phaseResults = {};
      state.nodeDetails = {};
      state.activePhaseId = null;
      state.activeGraph = null;
      state.status = GRAPH_STATUS.IDLE;
      state.error = null;
      state.showPresetSelector = false; // Hide presets after starting
    },

    /**
     * Load a workflow (from preset or URL).
     */
    loadWorkflow: (state, action) => {
      const workflow = action.payload;
      state.workflowId = workflow.id || generateId();
      state.workflowName = workflow.name || "";
      state.workflowDescription = workflow.description || "";
      // Deep clone phases to avoid mutation issues
      const rawPhases = JSON.parse(JSON.stringify(workflow.phases || [createEmptyPhase(0)]));
      // Normalize phases: apply UI defaults and runtime state for phases from
      // presets or backend (which only contain query-semantic fields)
      state.phases = rawPhases.map((p) => ({
        ...p,
        originCollection: p.originCollection || null,
        previousPhaseIds: p.previousPhaseIds || [],
        phaseCombineOperation: p.phaseCombineOperation || "Intersection",
        showAdvancedSettings:
          p.showAdvancedSettings ?? Object.keys(p.perNodeSettings || {}).length > 0,
        result: null,
        settings: { ...UI_DEFAULTS, ...p.settings },
      }));
      state.phaseResults = {};
      state.activePhaseId = null;
      state.activeGraph = null;
      state.status = GRAPH_STATUS.IDLE;
      state.error = null;
      state.showPresetSelector = false; // Hide presets after loading
    },

    /**
     * Update workflow name.
     */
    setWorkflowName: (state, action) => {
      state.workflowName = action.payload;
    },

    /**
     * Update workflow description.
     */
    setWorkflowDescription: (state, action) => {
      state.workflowDescription = action.payload;
    },

    /**
     * Add a new phase, automatically linked to the last existing phase.
     */
    addPhase: (state) => {
      const newPhase = createLinkedPhase(state.phases);
      state.phases.push(newPhase);
    },

    /**
     * Remove a phase by ID.
     */
    removePhase: (state, action) => {
      const phaseId = action.payload;
      const phaseIndex = state.phases.findIndex((p) => p.id === phaseId);
      if (phaseIndex > 0) {
        // Don't allow removing the first phase
        // Update subsequent phases that reference this one
        const removedPhaseId = state.phases[phaseIndex].id;
        state.phases.splice(phaseIndex, 1);

        // Fix references in phases that pointed to the removed phase
        for (const phase of state.phases) {
          if (phase.previousPhaseId === removedPhaseId) {
            // Point to the phase before the removed one
            phase.previousPhaseId = phaseIndex > 0 ? state.phases[phaseIndex - 1]?.id : null;
          }
          // Clean up previousPhaseIds references for combine phases
          if (phase.previousPhaseIds && phase.previousPhaseIds.length > 0) {
            phase.previousPhaseIds = phase.previousPhaseIds.filter((id) => id !== removedPhaseId);
          }
        }

        // Clean up results for removed phase (clear both stores)
        clearPhaseResult(state, phaseId);
      }
    },

    /**
     * Update a phase's configuration.
     */
    updatePhase: (state, action) => {
      const { phaseId, updates } = action.payload;
      const phase = state.phases.find((p) => p.id === phaseId);
      if (phase) {
        Object.assign(phase, updates);
        // Clear result when phase config changes (both stores)
        clearPhaseResult(state, phaseId);
      }
    },

    /**
     * Update a phase's settings.
     */
    updatePhaseSettings: (state, action) => {
      const { phaseId, setting, value } = action.payload;
      const phase = state.phases.find((p) => p.id === phaseId);
      if (phase) {
        phase.settings[setting] = value;
        // Clear result when settings change (both stores)
        clearPhaseResult(state, phaseId);
      }
    },

    /**
     * Add an origin node to a phase.
     */
    addPhaseOriginNode: (state, action) => {
      const { phaseId, nodeId } = action.payload;
      const phase = state.phases.find((p) => p.id === phaseId);
      if (phase && !phase.originNodeIds.includes(nodeId)) {
        phase.originNodeIds.push(nodeId);
        clearPhaseResult(state, phaseId);
      }
    },

    /**
     * Remove an origin node from a phase.
     */
    removePhaseOriginNode: (state, action) => {
      const { phaseId, nodeId } = action.payload;
      const phase = state.phases.find((p) => p.id === phaseId);
      if (phase) {
        phase.originNodeIds = phase.originNodeIds.filter((id) => id !== nodeId);
        // Also remove per-node settings for this node
        if (phase.perNodeSettings) {
          delete phase.perNodeSettings[nodeId];
        }
        clearPhaseResult(state, phaseId);
      }
    },

    /**
     * Toggle advanced (per-node) settings visibility for a phase.
     */
    toggleAdvancedSettings: (state, action) => {
      const { phaseId } = action.payload;
      const phase = state.phases.find((p) => p.id === phaseId);
      if (phase) {
        phase.showAdvancedSettings = !phase.showAdvancedSettings;
        // Initialize perNodeSettings if enabling and empty
        if (phase.showAdvancedSettings && !phase.perNodeSettings) {
          phase.perNodeSettings = {};
        }
      }
    },

    /**
     * Update a per-node setting for a specific node.
     */
    updatePerNodeSetting: (state, action) => {
      const { phaseId, nodeId, setting, value } = action.payload;
      const phase = state.phases.find((p) => p.id === phaseId);
      if (phase) {
        if (!phase.perNodeSettings) {
          phase.perNodeSettings = {};
        }
        if (!phase.perNodeSettings[nodeId]) {
          phase.perNodeSettings[nodeId] = {};
        }
        phase.perNodeSettings[nodeId][setting] = value;
        clearPhaseResult(state, phaseId);
      }
    },

    /**
     * Set the active graph to display.
     */
    setActiveGraph: (state, action) => {
      const { phaseId, graph } = action.payload;
      state.activePhaseId = phaseId;
      state.activeGraph = graph;
    },

    /**
     * Show preset selector (to change workflow).
     */
    showPresets: (state) => {
      state.showPresetSelector = true;
    },
  },
  extraReducers: (builder) => {
    builder
      // Execute single phase
      .addCase(executePhase.pending, (state, action) => {
        const { phaseId } = action.meta.arg;
        const phase = state.phases.find((p) => p.id === phaseId);
        // Skip loading state if we have a cached result
        if (phase && state.phaseResults[phase.id]) return;
        state.status = GRAPH_STATUS.LOADING;
        state.executingPhaseId = phase?.id;
        state.error = null;
      })
      .addCase(executePhase.fulfilled, (state, action) => {
        const { phaseId, result, originNodeIds, cached } = action.payload;
        state.status = GRAPH_STATUS.SUCCEEDED;
        state.executingPhaseId = null;

        // Store result in phaseResults (source of truth) and mirror to phase.result
        setPhaseResult(state, phaseId, result);

        // Store the actual origin nodes used (important for chained phases)
        const phase = state.phases.find((p) => p.id === phaseId);
        if (phase) {
          phase._executedOriginNodeIds = originNodeIds;
        }

        // If this was a fresh fetch (not cached), recursively clear downstream
        // phase caches since their inputs may have changed
        if (!cached) {
          invalidateDownstream(state, phaseId);
        }

        // Set as active graph
        state.activePhaseId = phaseId;
        state.activeGraph = result;
      })
      .addCase(executePhase.rejected, (state, action) => {
        const { phaseId } = action.meta.arg;
        state.status = GRAPH_STATUS.FAILED;
        state.executingPhaseId = null;
        state.error = action.error.message;
        // Find the phase to include its name in error context if needed
        const phase = state.phases.find((p) => p.id === phaseId);
        if (phase) {
          phase._executedOriginNodeIds = null;
        }
      })

      // Execute full workflow
      .addCase(executeWorkflow.pending, (state) => {
        state.status = GRAPH_STATUS.LOADING;
        state.error = null;
      })
      .addCase(executeWorkflow.fulfilled, (state) => {
        state.status = GRAPH_STATUS.SUCCEEDED;
        // The last phase's result is set as active by the individual phase executions
      })
      .addCase(executeWorkflow.rejected, (state, action) => {
        state.status = GRAPH_STATUS.FAILED;
        state.error = action.error.message;
      })

      // Fetch node details
      .addCase(fetchNodeDetails.fulfilled, (state, action) => {
        // Merge new details into existing cache
        Object.assign(state.nodeDetails, action.payload);
      });
  },
});

export const {
  initializeWorkflow,
  loadWorkflow,
  setWorkflowName,
  setWorkflowDescription,
  addPhase,
  removePhase,
  updatePhase,
  updatePhaseSettings,
  addPhaseOriginNode,
  removePhaseOriginNode,
  toggleAdvancedSettings,
  updatePerNodeSetting,
  setActiveGraph,
  showPresets,
} = workflowBuilderSlice.actions;

export default workflowBuilderSlice.reducer;
