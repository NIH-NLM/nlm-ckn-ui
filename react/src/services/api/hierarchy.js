/**
 * API functions for hierarchical data (sunburst/tree) operations.
 */

/**
 * Fetch hierarchical data for sunburst/tree visualizations.
 * @param {string|null} parentId - Parent node ID (null for root).
 * @param {string} graphType - Graph/database type.
 * @returns {Promise<Object|Array>} Hierarchical data (object for root, array for children).
 */
export const fetchHierarchyData = async (parentId, graphType) => {
  const response = await fetch("/arango_api/sunburst/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      parent_id: parentId,
      graph: graphType,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Fetch failed: ${response.status} ${errorText}`);
  }

  return response.json();
};
