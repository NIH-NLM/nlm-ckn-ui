import {
  COLLAPSE_OPTIONS,
  DEPTH_OPTIONS,
  DIRECTION_OPTIONS,
  LAYOUT_MODE_OPTIONS,
  PHENOTYPES_ENABLED,
} from "constants/index";
import { memo } from "react";

const COLLAPSE_LABELS = { off: "None", standard: "Exclude Origin", all: "All" };

/**
 * General settings panel for graph visualization.
 * Controls depth, direction, font sizes, labels, and simulation.
 */
const GeneralSettingsPanel = ({
  settings,
  onDepthChange,
  onEdgeDirectionChange,
  onNodeFontSizeChange,
  onEdgeFontSizeChange,
  onLabelToggle,
  onLeafModeChange,
  onFocusNodesToggle,
  onGraphToggle,
  onLayoutModeChange,
  onSimulationRestart,
}) => {
  return (
    // biome-ignore lint/correctness/useUniqueElementIds: legacy id
    <div id="tab-panel-general" className="tab-panel active">
      <div className="option-group">
        <label htmlFor="depth-select">Depth:</label>
        {/* biome-ignore lint/correctness/useUniqueElementIds: legacy id */}
        <select id="depth-select" value={settings.depth} onChange={onDepthChange}>
          {DEPTH_OPTIONS.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </div>

      <div className="option-group">
        <label htmlFor="edge-direction-select">Traversal Direction:</label>
        {/* biome-ignore lint/correctness/useUniqueElementIds: legacy id */}
        <select
          id="edge-direction-select"
          value={settings.edgeDirection}
          onChange={onEdgeDirectionChange}
        >
          {DIRECTION_OPTIONS.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </div>

      <div className="option-group font-size-picker">
        <div className="node-font-size-picker">
          <label htmlFor="node-font-size-select">Node font size:</label>
          {/* biome-ignore lint/correctness/useUniqueElementIds: legacy id */}
          <select
            id="node-font-size-select"
            value={settings.nodeFontSize}
            onChange={onNodeFontSizeChange}
          >
            {[4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32].map((size) => (
              <option key={size} value={size}>
                {size}px
              </option>
            ))}
          </select>
        </div>
        <div className="edge-font-size-picker">
          <label htmlFor="edge-font-size-select">Edge font size:</label>
          {/* biome-ignore lint/correctness/useUniqueElementIds: legacy id */}
          <select
            id="edge-font-size-select"
            value={settings.edgeFontSize}
            onChange={onEdgeFontSizeChange}
          >
            {[2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28].map((size) => (
              <option key={size} value={size}>
                {size}px
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="option-group labels-toggle-container">
        <h3 className="group-label">Toggle Labels:</h3>
        <div className="labels-toggle">
          {Object.entries(settings.labelStates).map(([labelKey, isChecked]) => (
            <div className="label-toggle-item" key={labelKey}>
              {labelKey
                .replace(/-/g, " ")
                .replace("label", "")
                .trim()
                .replace(/^\w/, (c) => c.toUpperCase())}
              <label className="switch">
                <input
                  type="checkbox"
                  checked={isChecked}
                  onChange={() => onLabelToggle(labelKey)}
                />
                <span className="slider round" />
              </label>
            </div>
          ))}
        </div>
      </div>

      <div className="option-group">
        <label htmlFor="collapse-leaf-select">Collapse Leaf Nodes:</label>
        <select
          id="collapse-leaf-select"
          value={settings.collapseOnStart}
          onChange={onLeafModeChange}
        >
          {COLLAPSE_OPTIONS.map((opt) => (
            <option key={opt} value={opt}>
              {COLLAPSE_LABELS[opt]}
            </option>
          ))}
        </select>
      </div>

      <div className="option-group labels-toggle-container">
        <h3 className="group-label">Highlight Origin Nodes:</h3>
        <div className="labels-toggle graph-source-toggle">
          <label className="switch">
            <input type="checkbox" checked={settings.useFocusNodes} onChange={onFocusNodesToggle} />
            <span className="slider round" />
          </label>
        </div>
      </div>

      {PHENOTYPES_ENABLED && (
        <div className="option-group labels-toggle-container">
          <h3 className="group-label">Graph Source:</h3>
          <div className="labels-toggle graph-source-toggle">
            Evidence
            <label className="switch">
              <input
                type="checkbox"
                checked={settings.graphType === "ontologies"}
                onChange={onGraphToggle}
              />
              <span className="slider round" />
            </label>
            Knowledge
          </div>
        </div>
      )}

      <div className="option-group">
        <label htmlFor="layout-mode-select">Layout:</label>
        <select
          id="layout-mode-select"
          value={settings.layoutMode || "force"}
          onChange={onLayoutModeChange}
        >
          {LAYOUT_MODE_OPTIONS.map(({ value, label }) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>

      <div className="option-group">
        <button
          type="button"
          className="simulation-toggle background-color-bg"
          onClick={onSimulationRestart}
        >
          Restart Simulation
        </button>
        <p className="hotkey-hint">
          Hold<kbd>S</kbd> to run live
        </p>
      </div>
    </div>
  );
};

export default memo(GeneralSettingsPanel);
