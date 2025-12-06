/**
 * API functions for document/node operations.
 */

import {
    COLLECTION_DOCUMENT_ENDPOINT,
    DOCUMENT_DETAILS_ENDPOINT,
    NODES_DETAILS_ENDPOINT,
} from "../../constants";

/**
 * Fetch a single document by collection and ID.
 * @param {string} collection - Collection name.
 * @param {string} id - Document ID/key.
 * @returns {Promise<Object>} Document object.
 */
export const fetchDocument = async (collection, id) => {
    const response = await fetch(COLLECTION_DOCUMENT_ENDPOINT(collection, id));
    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
    }
    return response.json();
};

/**
 * Fetch node/document details for a list of IDs.
 * Returns an array of document objects (or empty array on error).
 * @param {Array<string>} ids - Array of document IDs to fetch.
 * @param {string} db - Database identifier (graph type).
 * @returns {Promise<Array>} Array of document objects.
 */
export const fetchNodeDetailsByIds = async (ids, db) => {
    if (!ids || ids.length === 0) return [];
    try {
        const response = await fetch(DOCUMENT_DETAILS_ENDPOINT, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ document_ids: ids, db }),
        });
        if (!response.ok) throw new Error("Failed to fetch node details");
        return await response.json();
    } catch (error) {
        console.error("Error fetching node details:", error);
        return [];
    }
};

/**
 * Fetch details for multiple nodes by their IDs (alternate endpoint).
 * Used by NodesListTable component.
 * @param {Array<string>} nodeIds - Array of node IDs.
 * @returns {Promise<Array>} Array of node detail objects.
 */
export const fetchNodesDetails = async (nodeIds) => {
    if (!nodeIds || nodeIds.length === 0) return [];
    try {
        const response = await fetch(NODES_DETAILS_ENDPOINT, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ node_ids: nodeIds }),
        });
        if (!response.ok) throw new Error("Failed to fetch node details");
        return await response.json();
    } catch (error) {
        console.error("Error fetching node details:", error);
        return [];
    }
};
