/**
 * Split categorical edge filters into include vs exclude dicts based on a
 * parallel per-field mode map. Numeric range filters (object values) always
 * go to `include`. A missing mode defaults to "include".
 *
 * @param {Object} edgeFilters - { field: string[] | {min,max} }
 * @param {Object} edgeFilterModes - { field: "include" | "exclude" }
 * @returns {{ include: Object, exclude: Object }}
 */
export const splitEdgeFiltersByMode = (edgeFilters = {}, edgeFilterModes = {}) => {
  const include = {};
  const exclude = {};
  for (const [field, value] of Object.entries(edgeFilters || {})) {
    const isNumericRange = value && !Array.isArray(value) && typeof value === "object";
    if (isNumericRange) {
      include[field] = value;
      continue;
    }
    if (edgeFilterModes?.[field] === "exclude") {
      exclude[field] = value;
    } else {
      include[field] = value;
    }
  }
  return { include, exclude };
};
