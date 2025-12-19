/**
 * API functions for collection operations.
 */

import { COLLECTION_ENDPOINT, COLLECTIONS_ENDPOINT } from "constants/index";
import { postJson } from "./fetchWrapper";

/**
 * Fetch available collections from the backend.
 * @param {string} graphType - The graph type to fetch collections for.
 * @returns {Promise<Array>} Array of collection names.
 */
export const fetchCollections = async (graphType) => {
  return postJson(COLLECTIONS_ENDPOINT, { graph: graphType });
};

/**
 * Fetch all documents in a collection.
 * @param {string} collection - Collection name.
 * @param {string} graphType - The graph type/database.
 * @returns {Promise<Object>} Object containing document data.
 */
export const fetchCollectionDocuments = async (collection, graphType) => {
  return postJson(COLLECTION_ENDPOINT(collection), { graph: graphType });
};
