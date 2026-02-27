import { useCallback } from "react";
import { downloadBlob } from "utils";

/**
 * Hook for exporting graph to various formats (SVG, PNG, JSON).
 * @param {Object} wrapperRef - Ref to the graph container element
 * @param {Object} graphData - Current graph data (nodes and links)
 * @param {Array} originNodeIds - Array of origin node IDs for filename
 * @returns {Function} exportGraph function
 */
export function useGraphExport(wrapperRef, graphData, originNodeIds) {
  const exportGraph = useCallback(
    (format) => {
      let nodeIdsString = "no-ids";
      if (Array.isArray(originNodeIds) && originNodeIds.length > 0) {
        nodeIdsString = originNodeIds.map((id) => id.replaceAll("/", "-")).join("-");
      }
      const filenameStem = `nlm-ckn-${nodeIdsString}-graph`;

      if (format === "json") {
        if (!graphData) {
          console.error("graphData is not available for export.");
          return;
        }
        const jsonString = JSON.stringify(graphData, null, 2);
        const blob = new Blob([jsonString], { type: "application/json" });
        downloadBlob(blob, `${filenameStem}.json`);
        return;
      }

      if (!wrapperRef.current) return;
      const svgElement = wrapperRef.current.querySelector("svg");
      if (!svgElement) return;

      svgElement.style.backgroundColor = "white";
      const svgData = new XMLSerializer().serializeToString(svgElement);
      const svgBlob = new Blob([svgData], {
        type: "image/svg+xml;charset=utf-8",
      });
      svgElement.style.backgroundColor = "";

      if (format === "svg") {
        downloadBlob(svgBlob, `${filenameStem}.svg`);
        return;
      }

      const url = URL.createObjectURL(svgBlob);

      // PNG export
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        const scaleFactor = 4;
        const viewBox = svgElement.viewBox.baseVal;
        const svgWidth = viewBox?.width || svgElement.width.baseVal.value;
        const svgHeight = viewBox?.height || svgElement.height.baseVal.value;

        canvas.width = svgWidth * scaleFactor;
        canvas.height = svgHeight * scaleFactor;

        ctx.fillStyle = "white";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

        canvas.toBlob(
          (pngBlob) => {
            downloadBlob(pngBlob, `${filenameStem}.${format}`);
            URL.revokeObjectURL(url);
          },
          `image/${format}`,
        );
      };
      img.onerror = () => URL.revokeObjectURL(url);
      img.src = url;
    },
    [wrapperRef, graphData, originNodeIds],
  );

  return exportGraph;
}

export default useGraphExport;
