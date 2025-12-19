/**
 * API functions for search operations.
 */

import { SEARCH_ENDPOINT } from "constants/index";
import { postJson } from "./fetchWrapper";

/**
 * Search for documents matching a term.
 * @param {string} searchTerm - The search term.
 * @param {string} graphType - Graph/database type.
 * @param {Array<string>} searchFields - Fields to search in.
 * @returns {Promise<Array>} Array of matching documents.
 */
export const searchDocuments = async (searchTerm, graphType, searchFields) => {
  return postJson(
    SEARCH_ENDPOINT,
    {
      search_term: searchTerm,
      db: graphType,
      search_fields: searchFields,
    },
    { fallback: [] },
  );
};
