/**
 * Workflow Builder defaults and utilities.
 *
 * Preset data (WORKFLOW_PRESETS, PRESET_CATEGORIES) is fetched from the
 * backend API at /arango_api/workflow_presets/. This file contains only
 * frontend-specific defaults used when constructing new phases.
 */

/**
 * Query-semantic defaults -- what an MCP tool / agent cares about.
 */
export const QUERY_DEFAULTS = {
  depth: 2,
  edgeDirection: "ANY",
  allowedCollections: [],
  edgeFilters: { Label: [], Source: [] },
  setOperation: "Union",
  graphType: "ontologies",
  returnCollections: [],
  includeInterNodeEdges: true,
};

/**
 * UI/visualization defaults -- only the frontend needs these.
 */
export const UI_DEFAULTS = {
  collapseLeafNodes: true,
  useFocusNodes: true,
};

/**
 * Combined defaults for frontend use (backward compatible).
 */
export const DEFAULT_PHASE_SETTINGS = { ...QUERY_DEFAULTS, ...UI_DEFAULTS };

/**
 * Creates a new empty phase with default settings.
 * @param {number} index - The phase index (0-based).
 * @returns {Object} A new phase object.
 */
export const createEmptyPhase = (index) => ({
  id: `phase-${Date.now()}-${index}`,
  name: "",
  originSource: index === 0 ? "manual" : "previousPhase",
  originNodeIds: [],
  // For "collection" origin: which collection to use as source
  originCollection: null,
  previousPhaseId: null,
  // For "multiplePhases" origin: IDs of upstream phases to combine
  previousPhaseIds: [],
  // Set operation for combining multiple phase results
  phaseCombineOperation: "Intersection",
  originFilter: "all",
  settings: { ...DEFAULT_PHASE_SETTINGS },
  // Per-node settings overrides (nodeId -> settings object)
  perNodeSettings: {},
  // Whether to show advanced per-node settings UI
  showAdvancedSettings: false,
  result: null,
});
