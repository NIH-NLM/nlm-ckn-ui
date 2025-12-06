import { memo } from "react";

/**
 * Export panel for downloading graph as SVG, PNG, or JSON.
 */
const ExportPanel = ({ onExport }) => {
  return (
    // biome-ignore lint/correctness/useUniqueElementIds: legacy id
    <div id="tab-panel-export" className="tab-panel active">
      <div className="option-group export-buttons">
        <h3 className="group-label">Export Graph:</h3>
        <button type="button" onClick={() => onExport("svg")}>
          Download as SVG
        </button>
        <button type="button" onClick={() => onExport("png")}>
          Download as PNG
        </button>
        <button type="button" onClick={() => onExport("json")}>
          Download as JSON
        </button>
      </div>
    </div>
  );
};

export default memo(ExportPanel);
