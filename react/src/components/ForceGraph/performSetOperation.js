/**
 * Performs a set operation on an array of graph objects.
 *
 * @param {object[]} graphs - An array of graph objects, each with { nodes, links }.
 * @param {string} operation - The set operation: 'UNION', 'INTERSECTION', etc.
 * @returns {{nodes: object[], links: object[]}} - A single, combined graph object.
 */
export function performSetOperation(graphs, operation) {
  try {
    // Normalize inputs
    const safeGraphs = (Array.isArray(graphs) ? graphs : []).filter(Boolean);

    // Base cases
    if (safeGraphs.length === 0) return { nodes: [], links: [] };
    if (safeGraphs.length === 1) return safeGraphs[0] || { nodes: [], links: [] };

    // Normalize operation 
    const op = String(operation || "Union").toLowerCase();

    // Aggregate nodes and counts
    const nodeFrequencyMap = new Map();
    for (const graph of safeGraphs) {
      const currentNodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
      for (const node of currentNodes) {
        const id = node && (node._id || node.id);
        if (!id) continue;
        const entry = nodeFrequencyMap.get(id);
        if (entry) {
          entry.count += 1;
        } else {
          nodeFrequencyMap.set(id, { node: node, count: 1 });
        }
      }
    }

    // Select nodes by operation
    let finalNodes = [];
    const allEntries = Array.from(nodeFrequencyMap.values());
    switch (op) {
      case "intersection": {
        const required = safeGraphs.length;
        finalNodes = allEntries.filter((e) => e.count === required).map((e) => e.node);
        break;
      }
      case "symmetric difference":
      case "symmetric_difference":
      case "xor": {
        finalNodes = allEntries.filter((e) => e.count === 1).map((e) => e.node);
        break;
      }
      case "union":
      default: {
        finalNodes = allEntries.map((e) => e.node);
        break;
      }
    }

    // Node id set for filtering links
    const finalNodeIdSet = new Set(
      finalNodes
        .map((n) => (n ? n._id || n.id : null))
        .filter((id) => typeof id === "string" && id.length > 0),
    );

    // Aggregate unique links with safe keys
    const uniqueLinks = new Map();
    for (const graph of safeGraphs) {
      const currentLinks = Array.isArray(graph?.links) ? graph.links : [];
      for (const link of currentLinks) {
        if (!link) continue;
        const key = link._id || link._key || `${link._from || "?"}->${link._to || "?"}|${link.Label || ""}`;
        if (!uniqueLinks.has(key)) uniqueLinks.set(key, link);
      }
    }

    // Keep links whose endpoints are in final set
    const filteredLinks = Array.from(uniqueLinks.values()).filter((link) => {
      const from = link && link._from;
      const to = link && link._to;
      return typeof from === "string" && typeof to === "string" && finalNodeIdSet.has(from) && finalNodeIdSet.has(to);
    });

    return { nodes: finalNodes, links: filteredLinks };
  } catch (err) {
    console.error("performSetOperation failed:", err);
    // Fallback to defensive union
    const flatNodes = [];
    const flatLinks = [];
    const seenNode = new Set();
    const seenLink = new Set();
    for (const g of graphs || []) {
      const ns = g?.nodes || [];
      for (const n of ns) {
        const id = n && (n._id || n.id);
        if (id && !seenNode.has(id)) {
          seenNode.add(id);
          flatNodes.push(n);
        }
      }
      const ls = g?.links || [];
      for (const l of ls) {
        const key = l?._id || l?._key || `${l?._from || "?"}->${l?._to || "?"}|${l?.Label || ""}`;
        if (key && !seenLink.has(key)) {
          seenLink.add(key);
          flatLinks.push(l);
        }
      }
    }
    return { nodes: flatNodes, links: flatLinks };
  }
}
