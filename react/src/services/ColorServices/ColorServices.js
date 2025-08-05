import * as d3 from "d3";
import collMaps from "../../assets/cell-kn-mvp-collection-maps.json";

// Extract the unique collection identifiers
const collectionIds = collMaps.data
  .map(([id]) => id)
  .filter((id) => id !== "edges"); // Filter out 'edges'

const colors = [
  "#e6194B",
  "#3cb44b",
  "#ffe119",
  "#4363d8",
  "#f58231",
  "#ffd8b1",
  "#911eb4",
  "#f032e6",
  "#bfef45",
  "#fabed4",
  "#800000",
  "#dcbeff",
  "#a9a9a9",
  "#9A6324",
  "#fffac8",
  "#42d4f4",
  "#aaffc3",
  "#808000",
  "#000075",
  "#000000",
  "#469990",
];

// Create the ordinal color scale
const colorScale = d3.scaleOrdinal(collectionIds, colors);

// Default color for unknown collections
const defaultColor = "#cccccc"; // Grey

export const getColorForCollection = (collectionId) => {
  if (!collectionId) {
    return defaultColor;
  }
  // Check if the ID is in defined scale's domain
  if (colorScale.domain().includes(collectionId)) {
    return colorScale(collectionId);
  }
  // Return default color for any other unknown ID
  return defaultColor;
};
