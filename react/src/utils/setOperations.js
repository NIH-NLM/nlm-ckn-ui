/**
 * Utility functions for performing set operations on graphs.
 * These operations work on arrays of graph objects containing nodes and links.
 */

/**
 * Performs set operations (union, intersection, symmetric difference)
 * on multiple graph objects.
 *
 * @param {Array<{nodes: Array, links: Array}>} graphs - Array of graph objects
 * @param {string} operation - The set operation: "Union", "Intersection", or "Symmetric Difference"
 * @returns {{nodes: Array, links: Array}} - Result graph with combined/filtered nodes and links
 */
export function performSetOperation(graphs, operation) {
  try {
    if (!graphs || graphs.length === 0) {
      return { nodes: [], links: [] };
    }

    // Ensure all graphs have nodes and links arrays
    const validGraphs = graphs.map((g) => ({
      nodes: g?.nodes || [],
      links: g?.links || [],
    }));

    switch (operation) {
      case "Union": {
        // Combine all nodes/links, removing duplicates
        const nodeMap = new Map();
        const linkMap = new Map();

        for (const graph of validGraphs) {
          for (const node of graph.nodes) {
            if (!nodeMap.has(node.id)) {
              nodeMap.set(node.id, node);
            }
          }
          for (const link of graph.links) {
            const linkKey = `${link.source?.id || link.source}-${link.target?.id || link.target}-${link.predicate}`;
            if (!linkMap.has(linkKey)) {
              linkMap.set(linkKey, link);
            }
          }
        }
        return {
          nodes: Array.from(nodeMap.values()),
          links: Array.from(linkMap.values()),
        };
      }

      case "Intersection": {
        if (validGraphs.length < 2) {
          return validGraphs[0] || { nodes: [], links: [] };
        }

        // Find nodes/links that exist in ALL graphs
        const firstGraph = validGraphs[0];
        const nodeIdSets = validGraphs.map((g) => new Set(g.nodes.map((n) => n.id)));
        const linkKeySets = validGraphs.map(
          (g) =>
            new Set(
              g.links.map(
                (l) => `${l.source?.id || l.source}-${l.target?.id || l.target}-${l.predicate}`,
              ),
            ),
        );

        const intersectedNodes = firstGraph.nodes.filter((node) =>
          nodeIdSets.every((set) => set.has(node.id)),
        );

        const intersectedLinks = firstGraph.links.filter((link) => {
          const linkKey = `${link.source?.id || link.source}-${link.target?.id || link.target}-${link.predicate}`;
          return linkKeySets.every((set) => set.has(linkKey));
        });

        return { nodes: intersectedNodes, links: intersectedLinks };
      }

      case "Symmetric Difference": {
        if (validGraphs.length < 2) {
          return validGraphs[0] || { nodes: [], links: [] };
        }

        // Find nodes/links that exist in exactly one graph
        const nodeCountMap = new Map();
        const linkCountMap = new Map();
        const nodeDataMap = new Map();
        const linkDataMap = new Map();

        for (const graph of validGraphs) {
          for (const node of graph.nodes) {
            nodeCountMap.set(node.id, (nodeCountMap.get(node.id) || 0) + 1);
            if (!nodeDataMap.has(node.id)) nodeDataMap.set(node.id, node);
          }
          for (const link of graph.links) {
            const linkKey = `${link.source?.id || link.source}-${link.target?.id || link.target}-${link.predicate}`;
            linkCountMap.set(linkKey, (linkCountMap.get(linkKey) || 0) + 1);
            if (!linkDataMap.has(linkKey)) linkDataMap.set(linkKey, link);
          }
        }

        const uniqueNodes = [];
        const uniqueLinks = [];

        for (const [id, count] of nodeCountMap.entries()) {
          if (count === 1) uniqueNodes.push(nodeDataMap.get(id));
        }
        for (const [key, count] of linkCountMap.entries()) {
          if (count === 1) uniqueLinks.push(linkDataMap.get(key));
        }

        return { nodes: uniqueNodes, links: uniqueLinks };
      }

      default:
        console.warn(`Unknown operation: ${operation}, defaulting to Union`);
        return performSetOperation(graphs, "Union");
    }
  } catch (err) {
    console.error("performSetOperation failed:", err);
    return { nodes: [], links: [] };
  }
}
