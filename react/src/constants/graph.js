/**
 * Default graph settings and configuration
 */

/**
 * Feature flag to enable/disable phenotypes database.
 * When false: only ontologies DB is used, toggle is hidden.
 * When true: both databases available, toggle is shown.
 * To re-enable phenotypes, change this to true.
 */
export const PHENOTYPES_ENABLED = false;

// Graph generation defaults
export const DEFAULT_DEPTH = 2;
export const DEFAULT_NODE_LIMIT = 5000;
export const DEFAULT_EDGE_DIRECTION = "ANY";
export const DEFAULT_SET_OPERATION = "Union";
export const DEFAULT_GRAPH_TYPE = PHENOTYPES_ENABLED ? "phenotypes" : "ontologies";

// Graph display defaults
export const DEFAULT_NODE_FONT_SIZE = 12;
export const DEFAULT_EDGE_FONT_SIZE = 8;

// Default label visibility states
export const DEFAULT_LABEL_STATES = {
  "collection-label": false,
  "link-source": false,
  "link-label": true,
  "node-label": true,
};

// Default graph behavior flags
export const DEFAULT_FIND_SHORTEST_PATHS = false;
export const DEFAULT_USE_FOCUS_NODES = true;
export const DEFAULT_COLLAPSE_ON_START = true;
export const DEFAULT_INCLUDE_INTER_NODE_EDGES = true;

// Node expansion depth
export const EXPANSION_DEPTH = 1;

// Graph status values
export const GRAPH_STATUS = {
  IDLE: "idle",
  LOADING: "loading",
  PROCESSING: "processing",
  SUCCEEDED: "succeeded",
  FAILED: "failed",
};
