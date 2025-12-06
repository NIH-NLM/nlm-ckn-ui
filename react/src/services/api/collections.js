/**
 * API functions for collection operations.
 */

/**
 * Fetch available collections from the backend.
 * @param {string} graphType - The graph type to fetch collections for.
 * @returns {Promise<Array>} Array of collection names.
 */
export const fetchCollections = async (graphType) => {
  const response = await fetch("/arango_api/collections/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ graph: graphType }),
  });
  if (!response.ok) {
    console.error("Fetch collections failed:", response.status, await response.text());
    throw new Error(`Network response was not ok (${response.status})`);
  }
  return response.json();
};

/**
 * Fetch all documents in a collection.
 * @param {string} collection - Collection name.
 * @param {string} graphType - The graph type/database.
 * @returns {Promise<Object>} Object containing document data.
 */
export const fetchCollectionDocuments = async (collection, graphType) => {
  const response = await fetch(`/arango_api/collection/${collection}/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ graph: graphType }),
  });
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  return response.json();
};
