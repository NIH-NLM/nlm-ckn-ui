/**
 * Default graph settings and configuration
 */

/**
 * Feature flag to show/hide the graph source toggle in settings.
 * Currently false — phenotypes graph is used exclusively.
 */
export const PHENOTYPES_ENABLED = false;

// Graph generation defaults
export const DEFAULT_DEPTH = 2;
export const DEFAULT_NODE_LIMIT = 5000;
export const DEFAULT_EDGE_DIRECTION = "ANY";
export const DEFAULT_SET_OPERATION = "Union";
export const DEFAULT_GRAPH_TYPE = "phenotypes";

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

// Dropdown option arrays (shared across PhaseEditor, GeneralSettingsPanel, etc.)
export const DEPTH_OPTIONS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
export const DIRECTION_OPTIONS = ["ANY", "INBOUND", "OUTBOUND"];
export const SET_OPERATION_OPTIONS = [
  { value: "Union", label: "Union (combine all)" },
  { value: "Intersection", label: "Intersection (common nodes)" },
  { value: "Symmetric Difference", label: "Symmetric Difference" },
];
export const ORIGIN_FILTER_OPTIONS = [
  { value: "all", label: "All nodes" },
  { value: "leafNodes", label: "Leaf nodes only" },
  { value: "originNodes", label: "Origin nodes only" },
];

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
