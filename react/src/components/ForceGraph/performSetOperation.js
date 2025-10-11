/**
 * Performs a set operation on an array of graph objects.
 *
 * @param {object[]} graphs - An array of graph objects, each with { nodes, links }.
 * @param {string} operation - The set operation: 'UNION', 'INTERSECTION', etc.
 * @returns {{nodes: object[], links: object[]}} - A single, combined graph object.
 */
export function performSetOperation(graphs, operation) {
  // Handle base cases.
  if (!graphs || graphs.length === 0) {
    return { nodes: [], links: [] };
  }

  if (graphs.length === 1) {
    return graphs[0] || { nodes: [], links: [] };
  }

  // Aggregate nodes and count their frequencies.
  const nodeFrequencyMap = new Map();
  for (const graph of graphs) {
    const currentNodes = graph?.nodes || [];
    for (const node of currentNodes) {
      if (nodeFrequencyMap.has(node._id)) {
        nodeFrequencyMap.get(node._id).count++;
      } else {
        nodeFrequencyMap.set(node._id, { node: node, count: 1 });
      }
    }
  }

  // Filter nodes based on the operation.
  let finalNodes = [];
  const allEntries = Array.from(nodeFrequencyMap.values());

  switch (operation) {
    case "Intersection":
      finalNodes = allEntries
        .filter((entry) => entry.count === graphs.length)
        .map((entry) => entry.node);
      break;

    case "Symmetric Difference":
      finalNodes = allEntries.filter((entry) => entry.count === 1).map((entry) => entry.node);
      break;

    case "Union":
    default:
      finalNodes = allEntries.map((entry) => entry.node);
      break;
  }

  // Create a Set of final node IDs for efficient link filtering.
  const finalNodeIdSet = new Set(finalNodes.map((node) => node._id));

  // Aggregate all unique links and filter them.
  const uniqueLinks = new Map();
  for (const graph of graphs) {
    const currentLinks = graph?.links || [];
    for (const link of currentLinks) {
      uniqueLinks.set(link._id, link);
    }
  }

  // A link is kept only if its source and target nodes are in the final set.
  const filteredLinks = Array.from(uniqueLinks.values()).filter(
    (link) => finalNodeIdSet.has(link._from) && finalNodeIdSet.has(link._to),
  );

  // Return the final, flat graph object.
  return {
    nodes: finalNodes,
    links: filteredLinks,
  };
}
