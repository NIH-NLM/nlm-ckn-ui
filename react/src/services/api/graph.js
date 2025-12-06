/**
 * API functions for graph operations.
 */

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

  const endpoint = useShortestPath ? "/arango_api/shortest_paths/" : "/arango_api/graph/";

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

/**
 * Expand a single node by fetching its neighbors.
 * @param {string} nodeId - The node ID to expand.
 * @param {string} graphType - Graph/database type.
 * @param {boolean} [includeInterNodeEdges=true] - Include edges between result nodes.
 * @returns {Promise<Object>} Expansion data with nodes and links.
 */
export const fetchNodeExpansion = async (nodeId, graphType, includeInterNodeEdges = true) => {
  const response = await fetch("/arango_api/graph/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      node_ids: [nodeId],
      depth: 1,
      edge_direction: "ANY",
      allowed_collections: [],
      graph: graphType,
      edge_filters: [],
      include_inter_node_edges: includeInterNodeEdges,
    }),
  });

  if (!response.ok) {
    throw new Error("Expansion fetch failed");
  }

  return response.json();
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

  const response = await fetch("/arango_api/edge_filter_options/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fields, graph: graphType }),
  });

  if (!response.ok) {
    throw new Error("Edge filter options fetch failed.");
  }

  return response.json();
};
