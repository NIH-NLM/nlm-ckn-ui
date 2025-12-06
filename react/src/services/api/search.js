/**
 * API functions for search operations.
 */

/**
 * Search for documents matching a term.
 * @param {string} searchTerm - The search term.
 * @param {string} graphType - Graph/database type.
 * @param {Array<string>} searchFields - Fields to search in.
 * @returns {Promise<Array>} Array of matching documents.
 */
export const searchDocuments = async (searchTerm, graphType, searchFields) => {
  try {
    const response = await fetch("/arango_api/search/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        search_term: searchTerm,
        db: graphType,
        search_fields: searchFields,
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.error("Error fetching search terms:", error);
    return [];
  }
};
