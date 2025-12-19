/**
 * API functions for hierarchical data (sunburst/tree) operations.
 */

import { SUNBURST_ENDPOINT } from "constants/index";
import { postJson } from "./fetchWrapper";

/**
 * Fetch hierarchical data for sunburst/tree visualizations.
 * @param {string|null} parentId - Parent node ID (null for root).
 * @param {string} graphType - Graph/database type.
 * @returns {Promise<Object|Array>} Hierarchical data (object for root, array for children).
 */
export const fetchHierarchyData = async (parentId, graphType) => {
  return postJson(SUNBURST_ENDPOINT, {
    parent_id: parentId,
    graph: graphType,
  });
};
