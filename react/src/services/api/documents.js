/**
 * API functions for document/node operations.
 */

import {
  CELL_SET_LABEL_LOOKUPS_ENDPOINT,
  COLLECTION_DOCUMENT_ENDPOINT,
  DOCUMENT_DETAILS_ENDPOINT,
} from "constants/index";
import { getJson, postJson } from "./fetchWrapper";

/**
 * Fetch a single document by collection and ID.
 * @param {string} collection - Collection name.
 * @param {string} id - Document ID/key.
 * @returns {Promise<Object>} Document object.
 */
export const fetchDocument = async (collection, id) => {
  return getJson(COLLECTION_DOCUMENT_ENDPOINT(collection, id));
};

/**
 * Fetch node/document details for a list of IDs.
 * Returns an array of document objects (or empty array on error).
 * @param {Array<string>} ids - Array of document IDs to fetch.
 * @param {string} db - Database identifier (graph type).
 * @returns {Promise<Array>} Array of document objects.
 */
export const fetchNodeDetailsByIds = async (ids, db) => {
  if (!ids || ids.length === 0) return [];

  return postJson(DOCUMENT_DETAILS_ENDPOINT, { document_ids: ids, db }, { fallback: [] });
};

/**
 * Fetch the citation for each cell set DOI and the name for each anatomical
 * structure CURIE, which cell set labels show in place of the references.
 * @returns {Promise<{publications: Object, anatomical_structures: Object} | null>}
 */
export const fetchCellSetLabelLookups = async () => {
  return getJson(CELL_SET_LABEL_LOOKUPS_ENDPOINT, { fallback: null, silent: true });
};
