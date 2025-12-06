/**
 * API functions for AQL query operations.
 */

/**
 * Fetch predefined queries from the backend.
 * @returns {Promise<Array>} Array of predefined query objects.
 */
export const fetchPredefinedQueries = async () => {
  const response = await fetch("/api/predefined-queries/");
  if (!response.ok) {
    throw new Error("Failed to fetch predefined queries");
  }
  return response.json();
};

/**
 * Execute an AQL query.
 * @param {string} query - The AQL query string.
 * @param {string} graphType - Graph/database type.
 * @returns {Promise<Object>} Query results.
 */
export const executeAqlQuery = async (query, graphType) => {
  const response = await fetch("/arango_api/aql/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, db: graphType }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `Query failed: ${response.status}`);
  }

  return response.json();
};
