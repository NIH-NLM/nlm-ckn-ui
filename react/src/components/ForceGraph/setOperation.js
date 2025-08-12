/**
 * Performs set operation on graph data from multiple origins.
 * @param {object} data - Raw graph data from API.
 * @param {string} operation - Name of operation: 'Intersection', 'Union', etc.
 * @param {Array<string>} originNodeIds - List of origin node IDs.
 * @returns {{nodes: Array, links: Array}} Processed graph data.
 */
export function performSetOperation(data, operation, originNodeIds) {
  // Return early if data is invalid or lacks nodes.
  if (!data || !data.nodes) {
    console.warn("performSetOperation called with invalid data:", data);
    return { nodes: [], links: [] };
  }

  // Extract raw nodes and links from data.
  const nodesByOrigin = data.nodes;
  const allLinks = data.links || [];

  // Helper calculates final set of node IDs based on operation.
  const getAllNodeIdsFromOrigins = (operation) => {
    // Map each origin's subgraph to a set of node IDs.
    const nodeIdsPerOrigin = Object.values(nodesByOrigin).map((originGroup) => {
      if (!Array.isArray(originGroup)) return new Set();
      return new Set(originGroup.filter(item => item?.node?._id).map(item => item.node._id));
    });

    if (nodeIdsPerOrigin.length === 0) return new Set();

    if (operation === "Intersection") {
      if (nodeIdsPerOrigin.length < 2) return new Set(nodeIdsPerOrigin[0] || []);

      // Find intersection between all node sets.
      let intersectionResult = new Set(nodeIdsPerOrigin[0]);
      for (let i = 1; i < nodeIdsPerOrigin.length; i++) {
        intersectionResult = new Set(
          [...intersectionResult].filter((id) => nodeIdsPerOrigin[i].has(id))
        );
      }

      // Ensure origin nodes are always included in intersection result.
      originNodeIds.forEach((id) => intersectionResult.add(id));
      return intersectionResult;
    }

    if (operation === "Union") {
      // Combine all node sets into single unique set.
      return new Set(nodeIdsPerOrigin.flatMap((s) => [...s]));
    }

    if (operation === "Symmetric Difference") {
       if (nodeIdsPerOrigin.length < 2) return new Set(nodeIdsPerOrigin[0] || []);

       // Calculate symmetric difference between node sets.
       let result = new Set(nodeIdsPerOrigin[0]);
       for (let i = 1; i < nodeIdsPerOrigin.length; i++) {
         const currentSet = nodeIdsPerOrigin[i];
         const nextResult = new Set();
         result.forEach((id) => { if (!currentSet.has(id)) nextResult.add(id); });
         currentSet.forEach((id) => { if (!result.has(id)) nextResult.add(id); });
         result = nextResult;
       }
       return result;
    }

    console.error("Unknown set operation:", operation);
    return new Set();
  };

  // Get set of node IDs for final graph.
  const finalNodeIdSet = getAllNodeIdsFromOrigins(operation);

  // Filter master link list.
  const filteredLinks = allLinks.filter(
    (link) => finalNodeIdSet.has(link._from) && finalNodeIdSet.has(link._to)
  );

  // Gather unique node objects corresponding to final IDs.
  const finalNodeMap = new Map();
  Object.values(nodesByOrigin).flat().forEach(item => {
    if (item?.node?._id && finalNodeIdSet.has(item.node._id)) {
      if (!finalNodeMap.has(item.node._id)) {
        finalNodeMap.set(item.node._id, item.node);
      }
    }
  });

  // Return graph structure.
  return {
    nodes: Array.from(finalNodeMap.values()),
    links: filteredLinks,
  };
}