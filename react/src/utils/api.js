/**
 * API utility functions for fetching data from the backend.
 */

/**
 * Fetch available collections from the backend.
 * @param {string} graphType - The graph type to fetch collections for.
 * @returns {Promise<Array>} Array of collection names.
 */
export const fetchCollections = async (graphType) => {
    const response = await fetch("/arango_api/collections/", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            graph: graphType,
        }),
    });
    if (!response.ok) {
        console.error("Fetch collections failed:", response.status, await response.text());
        throw new Error(`Network response was not ok (${response.status})`);
    }
    return response.json();
};

/**
 * Fetch node/document details for a list of IDs from the backend.
 * Returns an array of document objects (or empty array on error).
 * @param {Array<string>} ids - Array of document IDs to fetch.
 * @param {string} db - Database identifier (graph type).
 * @returns {Promise<Array>} Array of document objects.
 */
export const fetchNodeDetailsByIds = async (ids, db) => {
    if (!ids || ids.length === 0) return [];
    try {
        const response = await fetch("/arango_api/document/details", {
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
