/**
 * Graph and tree data structure utilities.
 */

/**
 * Check if data has any nodes for a specific nodeId.
 * @param {object} data - Graph data object.
 * @param {string} nodeId - Node ID to check.
 * @returns {boolean} True if nodes exist for the nodeId.
 */
export const hasAnyNodes = (data, nodeId) => {
    if (
        !data ||
        typeof data !== "object" ||
        !data.nodes ||
        typeof data.nodes !== "object" ||
        !Object.hasOwn(data.nodes, nodeId)
    ) {
        return false;
    }

    const nodeEntries = data.nodes[nodeId];

    if (!Array.isArray(nodeEntries)) {
        return false;
    }

    const result = nodeEntries.some((entry) => {
        return (
            entry && typeof entry === "object" && Object.hasOwn(entry, "node") && entry.node !== null
        );
    });

    return result;
};

/**
 * Check if raw API graph response has any nodes.
 * @param {object} data - Raw API response data.
 * @returns {boolean} True if data contains nodes.
 */
export const hasNodesInRawData = (data) => {
    if (!data || typeof data !== "object") return false;

    // Shortest-path shape: { nodes: Array, links: Array }
    if (Array.isArray(data.nodes)) {
        return data.nodes.length > 0;
    }

    // Per-origin shape: { [originId]: { nodes: Array, links: Array }, ... }
    // Check each origin's nodes array
    for (const value of Object.values(data)) {
        if (
            value &&
            typeof value === "object" &&
            Array.isArray(value.nodes) &&
            value.nodes.length > 0
        ) {
            return true;
        }
    }

    return false;
};

/**
 * Find a node by ID in a tree structure.
 * @param {object} node - Root node to search from.
 * @param {string} id - ID to find.
 * @returns {object|null} Found node or null.
 */
export function findNodeById(node, id) {
    if (node._id === id) {
        return node;
    }
    if (node.children) {
        for (const child of node.children) {
            const found = findNodeById(child, id);
            if (found) {
                return found;
            }
        }
    }
    return null;
}

/**
 * Merge children into a parent node in graph data.
 * @param {object} graphData - Graph data structure.
 * @param {string} parentId - Parent node ID.
 * @param {Array} childrenWithGrandchildren - Children to merge.
 * @returns {object} New graph data with merged children.
 */
export function mergeChildren(graphData, parentId, childrenWithGrandchildren) {
    const newData = JSON.parse(JSON.stringify(graphData)); // Deep copy
    const parentNode = findNodeById(newData, parentId);

    if (parentNode) {
        parentNode.children = childrenWithGrandchildren;
        parentNode._childrenLoaded = true;
    } else {
        console.warn(`Parent node ${parentId} not found for merging children.`);
    }
    return newData;
}

/**
 * Parse document ID. For edge documents, returns both endpoints.
 * @param {object} document - Document object.
 * @returns {Array<string>} Array of IDs.
 */
export function parseId(document) {
    if (document._from && document._to) {
        return [document._from, document._to];
    }
    return [document._id];
}
