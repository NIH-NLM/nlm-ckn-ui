/**
 * Serializes an SVG element into an inline data URL for use as a saved-graph
 * thumbnail. Best-effort: returns null instead of throwing on any failure.
 * @param {SVGElement|null} svgElement
 * @param {{ width?: number }} [opts]
 * @returns {Promise<string|null>}
 */
export const captureGraphThumbnail = async (svgElement, { width = 240 } = {}) => {
  try {
    if (!svgElement || typeof svgElement.cloneNode !== "function") return null;
    const clone = svgElement.cloneNode(true);
    clone.setAttribute("width", String(width));
    const serialized = new XMLSerializer().serializeToString(clone);
    const encoded = encodeURIComponent(serialized);
    return `data:image/svg+xml;charset=utf-8,${encoded}`;
  } catch {
    return null;
  }
};
