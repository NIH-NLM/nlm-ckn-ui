import { VERSION_ENDPOINT } from "constants/index";
import { getJson } from "./fetchWrapper";

/**
 * Fetch the UI and ETL version strings for display.
 * Non-critical: returns null on any failure instead of throwing.
 * @returns {Promise<{ui_version: string, etl_version: string} | null>}
 */
export const fetchVersionInfo = async () => {
  return getJson(VERSION_ENDPOINT, { fallback: null, silent: true });
};
