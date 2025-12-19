/**
 * API functions for AQL query operations.
 */

import { AQL_ENDPOINT } from "constants/index";
import { getJson, postJson } from "./fetchWrapper";

/**
 * Fetch predefined queries from the backend.
 * @returns {Promise<Array>} Array of predefined query objects.
 */
export const fetchPredefinedQueries = async () => {
  return getJson("/api/predefined-queries/");
};

/**
 * Execute an AQL query.
 * @param {string} query - The AQL query string.
 * @param {string} graphType - Graph/database type.
 * @returns {Promise<Object>} Query results.
 */
export const executeAqlQuery = async (query, graphType) => {
  return postJson(AQL_ENDPOINT, { query, db: graphType });
};
