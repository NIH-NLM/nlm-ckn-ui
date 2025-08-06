import * as d3 from "d3";
import collMaps from "../../assets/cell-kn-mvp-collection-maps.json";

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

// Defines D3 ordinal color scale
export const colorScale = d3.scaleOrdinal(domain, range);

// Default color for unknown collections or those without color property.
const defaultColor = "#cccccc";

/**
 * Gets stable color for specific collection ID from main config file.
 * @param {string} collectionId - The ID of collection (e.g., "BMC", "edges").
 * @returns {string} The assigned hex color code or default color.
 */
export const getColorForCollection = (collectionId) => {
  // Get config for collectionId and return its color or default.
  const config = collectionMaps.get(collectionId);
  return config?.color || defaultColor;
};
