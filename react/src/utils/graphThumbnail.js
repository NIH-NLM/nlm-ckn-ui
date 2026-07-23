/**
 * Serializes an SVG element into an inline data URL for use as a saved-graph
 * thumbnail. Best-effort: returns null instead of throwing on any failure.
 * @param {SVGElement|null} svgElement
 * @param {{ width?: number, height?: number }} [opts]
 * @returns {Promise<string|null>}
 */
export const captureGraphThumbnail = async (svgElement, { width = 240, height = 160 } = {}) => {
  try {
    if (!svgElement || typeof svgElement.cloneNode !== "function") return null;
    const clone = svgElement.cloneNode(true);
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    clone.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");

    // Best-effort tight-frame to the graph content so the fixed-size thumbnail
    // isn't cropped to an empty margin of the live viewBox. Falls back to the
    // clone's existing viewBox when bounding-box measurement isn't available
    // (e.g. the element isn't laid out, or getBBox is unsupported).
    try {
      if (typeof svgElement.getBBox === "function") {
        const box = svgElement.getBBox();
        if (box && box.width > 0 && box.height > 0) {
          const padX = box.width * 0.08;
          const padY = box.height * 0.08;
          clone.setAttribute(
            "viewBox",
            `${box.x - padX} ${box.y - padY} ${box.width + 2 * padX} ${box.height + 2 * padY}`,
          );
        }
      }
    } catch {
      // Keep the clone's existing viewBox.
    }

    clone.setAttribute("width", String(width));
    clone.setAttribute("height", String(height));
    clone.setAttribute("preserveAspectRatio", "xMidYMid meet");
    const serialized = new XMLSerializer().serializeToString(clone);
    const encoded = encodeURIComponent(serialized);
    return `data:image/svg+xml;charset=utf-8,${encoded}`;
  } catch {
    return null;
  }
};
