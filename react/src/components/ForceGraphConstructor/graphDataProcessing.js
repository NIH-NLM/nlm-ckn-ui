/**
 * Pure data processing functions for force graph.
 * These functions transform graph data without side effects.
 */

import { getColorForCollection } from "../../utils";

/**
 * Merges new nodes into existing node list.
 * Filters duplicates and formats new nodes for D3 simulation.
 * @param {Array} existingNodes - Current nodes in graph
 * @param {Array} newNodes - New nodes to add
 * @param {Function} nodeId - Function to extract node ID
 * @param {Function} labelFn - Function to extract node label
 * @param {Function} nodeHover - Function to generate hover text
 * @returns {Array} Combined node list
 */
export function processGraphData(
  existingNodes,
  newNodes,
  nodeId = (d) => d._id,
  labelFn = (d) => d.label,
  nodeHover = undefined,
) {
  // Filter out any new nodes that already exist in the graph.
  const filteredNewNodes = newNodes.filter(
    (newNode) => !existingNodes.some((existing) => existing._id === nodeId(newNode)),
  );

  // Map new nodes to required structure for rendering.
  const processedNewNodes = filteredNewNodes.map((newNode) => {
    const collection = nodeId(newNode).split("/")[0];

    return {
      ...newNode,
      id: nodeId(newNode),
      // Prefer provided nodeHover generator; fallback to labelFn for reasonable default
      nodeHover: typeof nodeHover === "function" ? nodeHover(newNode) : labelFn(newNode),
      color: getColorForCollection(collection),
      nodeLabel: labelFn(newNode),
    };
  });

  return existingNodes.concat(processedNewNodes);
}

/**
 * Integrates new links into existing link list.
 * Resolves source/target objects and flags parallel links for curved rendering.
 * @param {Array} existingLinks - Current links in graph
 * @param {Array} newLinks - New links to add
 * @param {Array} nodes - All nodes (for reference resolution)
 * @param {Function} linkSource - Function to extract source ID from link
 * @param {Function} linkTarget - Function to extract target ID from link
 * @param {Function} labelFn - Function to extract link label
 * @returns {Array} Combined link list
 */
export function processGraphLinks(
  existingLinks,
  newLinks,
  nodes,
  linkSource = ({ _from }) => _from,
  linkTarget = ({ _to }) => _to,
  labelFn = (d) => d.label,
) {
  const updatedExistingLinks = [...existingLinks]; // Work on a mutable copy

  for (const newLink of newLinks) {
    const sourceNodeId = linkSource(newLink);
    const targetNodeId = linkTarget(newLink);

    // Find full node objects for source and target.
    const sourceNode = nodes.find((node) => node.id === sourceNodeId);
    const targetNode = nodes.find((node) => node.id === targetNodeId);

    // Skip link if either node is not found.
    if (!sourceNode || !targetNode) {
      continue;
    }

    // Skip if link with same _id already exists.
    if (updatedExistingLinks.some((existing) => existing._id === newLink._id)) {
      continue;
    }

    // Prepare new link object with resolved nodes.
    const processedNewLink = {
      ...newLink,
      sourceText: newLink.source ?? newLink.Source,
      source: sourceNode,
      target: targetNode,
      label: labelFn(newLink),
      isParallelPair: false,
    };

    // Check for a reverse link to identify a parallel pair.
    const keyParts = processedNewLink._key.split("-");
    if (keyParts.length === 2) {
      const reverseKey = `${keyParts[1]}-${keyParts[0]}`;
      const reversePartner = updatedExistingLinks.find(
        (existingLink) =>
          existingLink._key === reverseKey &&
          existingLink.source.id === targetNodeId &&
          existingLink.target.id === sourceNodeId,
      );

      // If reverse partner found, flag both links.
      if (reversePartner) {
        processedNewLink.isParallelPair = true;
        reversePartner.isParallelPair = true;
      }
    }
    updatedExistingLinks.push(processedNewLink);
  }

  return updatedExistingLinks;
}

/**
 * Identifies leaf nodes connected only to a single neighbor from collapse list.
 * @param {Array} nodes - All nodes in the graph
 * @param {Array} links - All links in the graph
 * @param {Array} collapseNodes - Nodes to check for leaf neighbors
 * @param {Array} originNodeIds - Origin nodes that cannot be leaves
 * @returns {Array} IDs of leaf nodes to remove
 */
export function findLeafNodes(nodes, links, collapseNodes, originNodeIds = []) {
  const leafNodes = [];
  for (const node of nodes) {
    // Origin nodes cannot be leaves.
    if (originNodeIds.includes(node.id)) continue;
    // Filter for links connected to current node.
    const nodeLinks = links.filter(
      (l) => (l.source.id || l.source) === node.id || (l.target.id || l.target) === node.id,
    );
    if (nodeLinks.length > 0) {
      // Check if all links connect to the same neighbor.
      const firstNeighborId =
        (nodeLinks[0].source.id || nodeLinks[0].source) === node.id
          ? nodeLinks[0].target.id || nodeLinks[0].target
          : nodeLinks[0].source.id || nodeLinks[0].source;
      const allLinksToSameNeighbor = nodeLinks.every(
        (l) =>
          ((l.source.id || l.source) === node.id &&
            (l.target.id || l.target) === firstNeighborId) ||
          ((l.target.id || l.target) === node.id && (l.source.id || l.source) === firstNeighborId),
      );
      // If so, and neighbor is in collapse list, mark as leaf.
      if (allLinksToSameNeighbor && collapseNodes.includes(firstNeighborId)) {
        leafNodes.push(node.id);
      }
    }
  }
  return leafNodes;
}
