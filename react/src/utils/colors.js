/**
 * Color utilities for collection-based coloring.
 * Uses predefined colors from collection config for consistency.
 */
import * as d3 from "d3";
import collMaps from "../assets/nlm-ckn-collection-maps.json";

// Build color mappings from config
const collectionMaps = new Map(collMaps.maps);
const domain = [];
const range = [];

collectionMaps.forEach((config, id) => {
  // Exclude edges from default categorical scale
  if (id !== "edges") {
    domain.push(id);
    range.push(config.color);
  }
});

/**
 * D3 ordinal color scale with predefined domain/range from config.
 * Used to assign consistent colors to different collections/categories.
 */
export const colorScale = d3.scaleOrdinal(domain, range);

// Default color for unknown collections or those without color property.
const defaultColor = "#cccccc";

/**
 * Gets stable color for specific collection ID from main config file.
 * The color is defined in nlm-ckn-collection-maps.json, ensuring
 * consistent colors across page loads and renders.
 *
 * @param {string} collectionId - The ID of collection (e.g., "CL", "UBERON").
 * @returns {string} The assigned hex color code or default color.
 */
export function getColorForCollection(collectionId) {
  // Get config for collectionId and return its color or default.
  const config = collectionMaps.get(collectionId);
  return config?.color || defaultColor;
}

/**
 * Get the collection color for a node ID (e.g., "CL/0000540") or a collection key (e.g., "CL").
 * Extracts the collection prefix from node IDs that contain "/".
 * @param {string} nodeIdOrKey - A node ID or collection key.
 * @returns {string} The hex color code or a default fallback.
 */
export const getCollectionColor = (nodeIdOrKey) => {
  const collection = nodeIdOrKey?.includes("/")
    ? nodeIdOrKey.split("/")[0]
    : nodeIdOrKey || "";
  return collectionMaps.get(collection)?.color || "#666666";
};

/**
 * Get the collection color by collection key (e.g., "CL").
 * @param {string} collectionKey - The collection key.
 * @returns {string|null} The hex color code or null if not found.
 */
export const getCollectionColorByKey = (collectionKey) => {
  return collectionMaps.get(collectionKey)?.color || null;
};
