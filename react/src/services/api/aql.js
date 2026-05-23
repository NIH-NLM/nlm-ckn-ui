/**
 * API functions for AQL query operations.
 */

import {
  AQL_ENDPOINT,
  ASK_ENDPOINT,
  ASK_NODE_SUGGESTIONS_ENDPOINT,
  ASK_SUMMARY_ENDPOINT,
} from "constants/index";
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

/**
 * Ask a natural-language question and receive generated AQL plus normalized results.
 * @param {Object} params - Request parameters.
 * @param {string} params.question - Natural-language question.
 * @param {string} params.graph - Graph/database type.
 * @param {string} params.mode - Query mode: "new" or "refine".
 * @param {Array} params.history - Recent conversation history.
 * @returns {Promise<Object>} Answer payload with rows, columns, nodes, links, and AQL.
 */
export const askQuestion = async ({ question, graph, mode, history }) => {
  return postJson(ASK_ENDPOINT, { question, graph, mode, history });
};

/**
 * Generate a narrative summary of the active ask-a-question result.
 * @param {Object} params - Active result context.
 * @returns {Promise<Object>} Summary payload.
 */
export const summarizeQuestionResult = async ({
  question,
  answer,
  graph,
  columns,
  rows,
  nodes,
  links,
}) => {
  return postJson(ASK_SUMMARY_ENDPOINT, {
    question,
    answer,
    graph,
    columns,
    rows,
    nodes,
    links,
  });
};

/**
 * Fetch graph-aware follow-up suggestions for a selected node.
 * @param {Object} params - Request parameters.
 * @param {string} params.nodeId - Selected Arango node _id.
 * @param {string} params.graph - Graph/database type.
 * @returns {Promise<Object>} Node metadata and suggested follow-up questions.
 */
export const fetchNodeQuestionSuggestions = async ({
  nodeId,
  graph,
  visibleEdgeCount = 0,
  visibleNeighborCounts = {},
  visibleNeighborIds = {},
}) => {
  return postJson(ASK_NODE_SUGGESTIONS_ENDPOINT, {
    node_id: nodeId,
    graph,
    visible_edge_count: visibleEdgeCount,
    visible_neighbor_counts: visibleNeighborCounts,
    visible_neighbor_ids: visibleNeighborIds,
  });
};
