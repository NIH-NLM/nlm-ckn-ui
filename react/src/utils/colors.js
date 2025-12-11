/**
 * Color utilities for collection-based coloring.
 * Uses D3 ordinal scales to assign consistent colors to collections.
 */
import * as d3 from "d3";

/**
 * D3 ordinal color scale with a comprehensive palette.
 * Used to assign consistent colors to different collections/categories.
 */
export const colorScale = d3.scaleOrdinal(d3.schemeTableau10);

/**
 * Gets a hex color for a given collection ID.
 * The color is deterministically assigned based on the collection ID,
 * ensuring the same collection always gets the same color.
 *
 * @param {string} collectionId - The collection identifier
 * @returns {string} - Hex color code (e.g., "#4e79a7")
 */
export function getColorForCollection(collectionId) {
  return colorScale(collectionId);
}
