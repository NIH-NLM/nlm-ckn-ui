/**
 * API functions for the CL hierarchy rendered by the Browse page.
 */

import { HIERARCHY_ENDPOINT, HIERARCHY_LABELS_ENDPOINT } from "constants/index";
import { fetchWithErrorHandling, postJson } from "./fetchWrapper";

/**
 * Fetch hierarchy data for one curated predicate.
 * @param {string} label - The edge predicate the hierarchy follows.
 * @param {string|null} parentId - Parent node ID (null for the root).
 * @returns {Promise<Object|Array>} The root object, or an array of children.
 */
export const fetchHierarchyData = async (label, parentId = null) => {
  return postJson(HIERARCHY_ENDPOINT, { label, parent_id: parentId });
};

/**
 * Fetch the curated predicates present in the loaded data.
 * @returns {Promise<Array<{label: string, root: string, edge_count: number}>>}
 */
export const fetchHierarchyLabels = async () => {
  return fetchWithErrorHandling(HIERARCHY_LABELS_ENDPOINT);
};
