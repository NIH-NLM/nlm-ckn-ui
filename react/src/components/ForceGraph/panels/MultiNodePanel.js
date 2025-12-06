import { memo } from "react";

/**
 * Multi-node panel for advanced per-node settings and set operations.
 */
const MultiNodePanel = ({
  settings,
  isAdvancedMode,
  onAdvancedModeToggle,
  onOperationChange,
  onShortestPathToggle,
}) => {
  return (
    // biome-ignore lint/correctness/useUniqueElementIds: legacy id
    <div id="tab-panel-multiNode" className="tab-panel active">
      <div className="option-group labels-toggle-container">
        <h3 className="group-label">Advanced Per-Node Settings:</h3>
        <div className="labels-toggle graph-source-toggle">
          <label className="switch">
            <input type="checkbox" checked={isAdvancedMode} onChange={onAdvancedModeToggle} />
            <span className="slider round" />
          </label>
        </div>
      </div>
      <div className="option-group multi-node">
        <label htmlFor="set-operation-select">Graph operation:</label>
        {/* biome-ignore lint/correctness/useUniqueElementIds: legacy id */}
        <select
          id="set-operation-select"
          value={settings.setOperation}
          onChange={onOperationChange}
        >
          {["Intersection", "Union", "Symmetric Difference"].map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </div>
      <div className="option-group multi-node">
        Shortest Path
        <label className="switch">
          <input
            type="checkbox"
            checked={settings.findShortestPaths}
            onChange={onShortestPathToggle}
          />
          <span className="slider round" />
        </label>
      </div>
    </div>
  );
};

export default memo(MultiNodePanel);
