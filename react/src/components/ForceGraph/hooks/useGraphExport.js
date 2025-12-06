import { useCallback } from "react";

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
      const filenameStem = `cell-kn-mvp-${nodeIdsString}-graph`;

      if (format === "json") {
        if (!graphData) {
          console.error("graphData is not available for export.");
          return;
        }
        const jsonString = JSON.stringify(graphData, null, 2);
        const blob = new Blob([jsonString], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `${filenameStem}.json`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
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

      const url = URL.createObjectURL(svgBlob);

      if (format === "svg") {
        const link = document.createElement("a");
        link.href = url;
        link.download = `${filenameStem}.svg`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        return;
      }

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

        const downloadUrl = canvas.toDataURL(`image/${format}`);
        const filename = `${filenameStem}.${format}`;

        const link = document.createElement("a");
        link.href = downloadUrl;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      };
      img.onerror = () => URL.revokeObjectURL(url);
      img.src = url;
    },
    [wrapperRef, graphData, originNodeIds],
  );

  return exportGraph;
}

export default useGraphExport;
