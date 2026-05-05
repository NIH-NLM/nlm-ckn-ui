/**
 * API endpoint constants for ArangoDB backend
 */

// Base API path
export const API_BASE = "/arango_api";

// Collection endpoints
export const COLLECTIONS_ENDPOINT = `${API_BASE}/collections/`;
export const COLLECTION_ENDPOINT = (collection) => `${API_BASE}/collection/${collection}/`;
export const COLLECTION_DOCUMENT_ENDPOINT = (collection, id) =>
  `${API_BASE}/collection/${collection}/${id}/`;

// Document endpoints
export const DOCUMENT_DETAILS_ENDPOINT = `${API_BASE}/document/details`;
export const NODES_DETAILS_ENDPOINT = `${API_BASE}/nodes/details`;

// Graph endpoints
export const GRAPH_ENDPOINT = `${API_BASE}/graph/`;
export const NEIGHBOR_COLLECTIONS_ENDPOINT = `${API_BASE}/graph/neighbor-collections/`;
export const SHORTEST_PATHS_ENDPOINT = `${API_BASE}/shortest_paths/`;
export const CONNECTING_PATHS_ENDPOINT = `${API_BASE}/connecting_paths/`;
export const EDGE_FILTER_OPTIONS_ENDPOINT = `${API_BASE}/edge_filter_options/`;

// Search endpoint
export const SEARCH_ENDPOINT = `${API_BASE}/search/`;

// Hierarchy/Sunburst endpoint
export const SUNBURST_ENDPOINT = `${API_BASE}/sunburst/`;

// AQL query endpoint
export const AQL_ENDPOINT = `${API_BASE}/aql/`;

// Workflow presets endpoint
export const WORKFLOW_PRESETS_ENDPOINT = `${API_BASE}/workflow_presets/`;
