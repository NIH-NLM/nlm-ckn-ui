/**
 * API functions for graph operations.
 */

import {
  EDGE_FILTER_OPTIONS_ENDPOINT,
  EXPANSION_DEPTH,
  GRAPH_ENDPOINT,
  SHORTEST_PATHS_ENDPOINT,
} from "constants/index";
import { postJson } from "./fetchWrapper";

/**
 * Fetch graph data from backend.
 * Handles three types of requests: standard traversal, shortest path, and advanced per-node settings.
 * @param {Object} params - Query parameters.
 * @param {Array<string>} params.nodeIds - Node IDs to query.
 * @param {boolean} [params.shortestPaths] - Whether to find shortest paths.
 * @param {number} [params.depth] - Traversal depth.
 * @param {string} [params.edgeDirection] - Edge direction (ANY, INBOUND, OUTBOUND).
 * @param {Array<string>} [params.allowedCollections] - Collections to include.
 * @param {number} [params.nodeLimit] - Maximum nodes to return.
 * @param {string} params.graphType - Graph/database type.
 * @param {Array} [params.edgeFilters] - Edge filters.
 * @param {Object} [params.advancedSettings] - Per-node advanced settings.
 * @param {boolean} [params.includeInterNodeEdges] - Include edges between result nodes.
 * @returns {Promise<Object>} Graph data with nodes and links.
 */
export const fetchGraphData = async (params) => {
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
    includeInterNodeEdges = true,
  } = params;

  // Determine if this is a shortest path query.
  const useShortestPath = shortestPaths && !advancedSettings && nodeIds.length > 1;

  const endpoint = useShortestPath ? SHORTEST_PATHS_ENDPOINT : GRAPH_ENDPOINT;

  let body;

  if (useShortestPath) {
    body = {
      node_ids: nodeIds,
      edge_direction: edgeDirection,
    };
  } else if (advancedSettings) {
    body = {
      node_ids: nodeIds,
      advanced_settings: advancedSettings,
      graph: graphType,
      include_inter_node_edges: includeInterNodeEdges,
    };
  } else {
    body = {
      node_ids: nodeIds,
      depth,
      edge_direction: edgeDirection,
      allowed_collections: allowedCollections,
      node_limit: nodeLimit,
      graph: graphType,
      edge_filters: edgeFilters,
      include_inter_node_edges: includeInterNodeEdges,
    };
  }

  return postJson(endpoint, body);
};

/**
 * Expand a single node by fetching its neighbors.
 * @param {string} nodeId - The node ID to expand.
 * @param {string} graphType - Graph/database type.
 * @param {Array<string>} allowedCollections - Collections to include in traversal.
 * @param {boolean} [includeInterNodeEdges=true] - Include edges between result nodes.
 * @returns {Promise<Object>} Expansion data with nodes and links.
 */
export const fetchNodeExpansion = async (
  nodeId,
  graphType,
  allowedCollections,
  includeInterNodeEdges = true,
) => {
  return postJson(GRAPH_ENDPOINT, {
    node_ids: [nodeId],
    depth: EXPANSION_DEPTH,
    edge_direction: "ANY",
    allowed_collections: allowedCollections,
    graph: graphType,
    edge_filters: {},
    include_inter_node_edges: includeInterNodeEdges,
  });
};

/**
 * Fetch available edge filter options from backend.
 * @param {Array<string>} fields - Field names to get options for.
 * @param {string} graphType - Graph/database type.
 * @returns {Promise<Object>} Object with field names as keys and arrays of options as values.
 */
export const fetchEdgeFilterOptions = async (fields, graphType) => {
  if (!fields || fields.length === 0) {
    return {};
  }

  return postJson(EDGE_FILTER_OPTIONS_ENDPOINT, { fields, graph: graphType });
};
