/**
 * Performs a set operation (union, intersection, etc.) on multiple graph datasets.
 *
 * @param {object} data - The full dataset from the API, keyed by origin node IDs.
 * @param {string} operation - The set operation to perform: 'UNION', 'INTERSECTION', or 'SYMMETRIC_DIFFERENCE'.
 * @param {string[]} originNodeIds - An array of the start_node_ids to include in the operation.
 * @returns {{nodes: object[], links: object[]}} - A single, flat graph object.
 */
export function performSetOperation(data, operation, originNodeIds) {
  // Handle base cases
  if (!originNodeIds || originNodeIds.length === 0) {
    return { nodes: [], links: [] };
  }

  if (originNodeIds.length === 1) {
    const singleNodeId = originNodeIds[0];
    // Return the data for the single node, or empty arrays if it doesn't exist.
    return data[singleNodeId] || { nodes: [], links: [] };
  }

  // Aggregate all nodes and count their frequencies across graphs.
  const nodeFrequencyMap = new Map();
  for (const nodeId of originNodeIds) {
    // Safely access nodes, defaulting to an empty array.
    const currentNodes = data[nodeId]?.nodes || [];
    for (const node of currentNodes) {
      if (nodeFrequencyMap.has(node._id)) {
        // Increment count for existing node.
        nodeFrequencyMap.get(node._id).count++;
      } else {
        // Add new node to the map.
        nodeFrequencyMap.set(node._id, { node: node, count: 1 });
      }
    }
  }

  // Filter the aggregated nodes based on the requested operation.
  let finalNodes = [];
  const allEntries = Array.from(nodeFrequencyMap.values());

  switch (operation) {
    case "Intersection":
      finalNodes = allEntries
        .filter((entry) => entry.count === originNodeIds.length)
        .map((entry) => entry.node);
      break;

    case "Symmetric Difference":
      finalNodes = allEntries
        .filter((entry) => entry.count === 1)
        .map((entry) => entry.node);
      break;

    case "Union":
    default:
      // Union is the default behavior.
      finalNodes = allEntries.map((entry) => entry.node);
      break;
  }

  // Create a Set of final node IDs for efficient link filtering.
  const finalNodeIdSet = new Set(finalNodes.map((node) => node._id));

  // Aggregate all unique links and filter them.
  const uniqueLinks = new Map();
  for (const nodeId of originNodeIds) {
    const currentLinks = data[nodeId]?.links || [];
    for (const link of currentLinks) {
      // Use a Map to automatically handle duplicate links across graphs.
      uniqueLinks.set(link._id, link);
    }
  }

  // A link is kept only if both its source and target nodes are in the final set.
  const filteredLinks = Array.from(uniqueLinks.values()).filter(
    (link) => finalNodeIdSet.has(link._from) && finalNodeIdSet.has(link._to),
  );

  // Return the final, flat graph object.
  return {
    nodes: finalNodes,
    links: filteredLinks,
  };
}
