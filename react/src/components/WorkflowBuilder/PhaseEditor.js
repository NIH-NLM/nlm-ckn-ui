/**
 * PhaseEditor component for configuring a single phase in the workflow builder.
 *
 * Each phase has:
 * - Origin node selection (manual or from previous phase)
 * - Graph traversal settings (depth, direction, collections, filters)
 * - Graph operation (union, intersection, difference)
 * - Per-node advanced settings (optional)
 * - Execute action
 */

import FilterableDropdown from "components/FilterableDropdown";
import RangeSliderFilter from "components/RangeSliderFilter/RangeSliderFilter";
import {
  DEPTH_OPTIONS,
  DIRECTION_OPTIONS,
  ORIGIN_FILTER_OPTIONS,
  PHENOTYPES_ENABLED,
  SET_OPERATION_OPTIONS,
} from "constants/index";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { useSelector } from "react-redux";
import {
  getCollectionColor,
  getCollectionColorByKey,
  getCollectionDisplayName,
  getNodeLabel,
} from "utils";
import NodeSearchInput from "./NodeSearchInput";

/**
 * Builds an inline style object for a node color pill/badge.
 */
const nodeColorStyle = (color) => ({
  backgroundColor: `${color}20`,
  borderColor: color,
  color: color,
});

/**
 * Renders a labeled <select> dropdown. Used for depth, direction,
 * set operation, and origin filter selects throughout the editor.
 */
const SettingsSelect = ({ id, label, value, options, onChange }) => (
  <div className="setting-item">
    <label htmlFor={id}>{label}</label>
    <select id={id} value={value} onChange={onChange}>
      {options.map((opt) => {
        const optValue = typeof opt === "object" ? opt.value : opt;
        const optLabel = typeof opt === "object" ? opt.label : opt;
        return (
          <option key={optValue} value={optValue}>
            {optLabel}
          </option>
        );
      })}
    </select>
  </div>
);

/**
 * PhaseEditor displays and manages settings for a single workflow phase.
 */
const PhaseEditor = ({
  phase,
  phaseIndex,
  previousPhaseResult,
  allPhases = [],
  allPhaseResults = {},
  onUpdate,
  onUpdateSettings,
  onAddOriginNode,
  onRemoveOriginNode,
  onToggleAdvancedSettings,
  onUpdatePerNodeSetting,
  onExecute,
  onDelete,
  isExecuting,
  collections,
  edgeFilterOptions,
  nodeDetails = {},
}) => {
  // Get collection information for display
  const allCollections = useSelector((state) => state.graph.present.settings.allCollections || []);

  // Track when result first appears or changes to show a completion flash
  const [justCompleted, setJustCompleted] = useState(false);
  const prevResultRef = useRef(phase.result);
  useEffect(() => {
    if (phase.result && phase.result !== prevResultRef.current) {
      setJustCompleted(true);
      const timer = setTimeout(() => setJustCompleted(false), 1500);
      prevResultRef.current = phase.result;
      return () => clearTimeout(timer);
    }
    prevResultRef.current = phase.result;
  }, [phase.result]);

  // Handle name change
  const handleNameChange = useCallback(
    (e) => {
      onUpdate({ name: e.target.value });
    },
    [onUpdate],
  );

  // Handle origin source change
  const handleOriginSourceChange = useCallback(
    (e) => {
      onUpdate({ originSource: e.target.value });
    },
    [onUpdate],
  );

  // Handle origin filter change (for previousPhase source)
  const handleOriginFilterChange = useCallback(
    (e) => {
      onUpdate({ originFilter: e.target.value });
    },
    [onUpdate],
  );

  // Handle collection selection for "collection" origin source
  const handleCollectionSelect = useCallback(
    (e) => {
      onUpdate({ originCollection: e.target.value || null });
    },
    [onUpdate],
  );

  // Generic array toggle: adds item if absent, removes if present
  const makeArrayToggle = useCallback(
    (currentArray, updater) => (item) => {
      const next = currentArray.includes(item)
        ? currentArray.filter((v) => v !== item)
        : [...currentArray, item];
      updater(next);
    },
    [],
  );

  const handlePreviousPhaseIdToggle = makeArrayToggle(phase.previousPhaseIds || [], (ids) =>
    onUpdate({ previousPhaseIds: ids }),
  );

  const handleCollectionToggle = makeArrayToggle(phase.settings.allowedCollections || [], (cols) =>
    onUpdateSettings("allowedCollections", cols),
  );

  const handleReturnCollectionToggle = makeArrayToggle(
    phase.settings.returnCollections || [],
    (cols) => onUpdateSettings("returnCollections", cols),
  );

  // Handle combine operation change
  const handleCombineOperationChange = useCallback(
    (e) => {
      onUpdate({ phaseCombineOperation: e.target.value });
    },
    [onUpdate],
  );

  // Handle edge filter toggle for a specific categorical field
  const handleEdgeFilterToggle = useCallback(
    (field, value) => {
      const currentValues = phase.settings.edgeFilters?.[field] || [];
      const newValues = currentValues.includes(value)
        ? currentValues.filter((v) => v !== value)
        : [...currentValues, value];
      onUpdateSettings("edgeFilters", { ...phase.settings.edgeFilters, [field]: newValues });
    },
    [phase.settings.edgeFilters, onUpdateSettings],
  );

  // Handle numeric edge filter range change
  const handleNumericEdgeFilterChange = useCallback(
    (field, min, max) => {
      onUpdateSettings("edgeFilters", { ...phase.settings.edgeFilters, [field]: { min, max } });
    },
    [phase.settings.edgeFilters, onUpdateSettings],
  );

  // Whether this is a combine phase
  const isCombinePhase = phase.originSource === "multiplePhases";

  // Determine if phase can be executed
  const canExecute =
    !isExecuting &&
    (isCombinePhase
      ? (phase.previousPhaseIds || []).length >= 2 &&
        (phase.previousPhaseIds || []).every((id) => allPhaseResults[id]?.nodes?.length > 0)
      : phase.originSource === "collection"
        ? !!phase.originCollection
        : phase.originSource === "previousPhase"
          ? previousPhaseResult && previousPhaseResult.nodes?.length > 0
          : phase.originNodeIds.length > 0);

  // Check if advanced settings are enabled
  const showAdvancedSettings = phase.showAdvancedSettings && phase.originNodeIds.length > 1;
  const perNodeSettings = phase.perNodeSettings || {};

  // Get effective depth for a node (per-node override or shared setting)
  const getNodeDepth = (nodeId) => {
    return perNodeSettings[nodeId]?.depth ?? phase.settings.depth;
  };

  // Get effective direction for a node
  const getNodeDirection = (nodeId) => {
    return perNodeSettings[nodeId]?.edgeDirection ?? phase.settings.edgeDirection;
  };

  return (
    <div
      className={`phase-editor ${isExecuting ? "executing" : ""} ${isCombinePhase ? "combine-phase" : ""}`}
    >
      {/* Phase Header */}
      <div className="phase-header">
        <span className="phase-number">Phase {phaseIndex + 1}</span>
        <input
          type="text"
          className="phase-name-input"
          value={phase.name}
          onChange={handleNameChange}
          placeholder="Name this phase..."
        />
        {phaseIndex > 0 && (
          <button
            type="button"
            className="phase-delete-btn"
            onClick={onDelete}
            title="Remove this phase"
          >
            &times;
          </button>
        )}
      </div>

      {/* Origin Nodes Section */}
      <div className="phase-section">
        <h4>Origin Nodes</h4>

        <div className="origin-source-selector">
          <label>
            <input
              type="radio"
              name={`origin-source-${phase.id}`}
              value="manual"
              checked={phase.originSource === "manual"}
              onChange={handleOriginSourceChange}
            />
            Select nodes manually
          </label>
          <label>
            <input
              type="radio"
              name={`origin-source-${phase.id}`}
              value="collection"
              checked={phase.originSource === "collection"}
              onChange={handleOriginSourceChange}
            />
            All nodes from a collection
          </label>
          {phaseIndex > 0 && (
            <label>
              <input
                type="radio"
                name={`origin-source-${phase.id}`}
                value="previousPhase"
                checked={phase.originSource === "previousPhase"}
                onChange={handleOriginSourceChange}
              />
              Use results from Phase {phaseIndex}
            </label>
          )}
          {phaseIndex > 1 && (
            <label>
              <input
                type="radio"
                name={`origin-source-${phase.id}`}
                value="multiplePhases"
                checked={phase.originSource === "multiplePhases"}
                onChange={handleOriginSourceChange}
              />
              Combine results from multiple phases
            </label>
          )}
        </div>

        {phase.originSource === "manual" && (
          <div className="manual-origin-nodes">
            {/* Display selected nodes as pills */}
            <div className="origin-nodes-list">
              {phase.originNodeIds.map((nodeId) => {
                const nodeInfo = nodeDetails[nodeId];
                const displayName = getNodeLabel(nodeInfo, nodeId);
                const nodeColor = getCollectionColor(nodeId);
                return (
                  <div
                    key={nodeId}
                    className="origin-node-pill"
                    title={nodeId}
                    style={nodeColorStyle(nodeColor)}
                  >
                    <span className="node-label">{displayName}</span>
                    <button
                      type="button"
                      className="pill-remove"
                      onClick={() => onRemoveOriginNode(nodeId)}
                      style={{ color: nodeColor }}
                    >
                      &times;
                    </button>
                  </div>
                );
              })}
            </div>
            <NodeSearchInput onSelectNode={onAddOriginNode} existingNodeIds={phase.originNodeIds} />
          </div>
        )}

        {phase.originSource === "collection" && (
          <div className="collection-origin">
            <label>
              Collection:
              <select value={phase.originCollection || ""} onChange={handleCollectionSelect}>
                <option value="">Select a collection...</option>
                {(collections || allCollections).map((collKey) => (
                  <option key={collKey} value={collKey}>
                    {getCollectionDisplayName(collKey)} ({collKey})
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}

        {phase.originSource === "previousPhase" && (
          <div className="previous-phase-origin">
            {previousPhaseResult ? (
              <>
                <p className="previous-phase-info">
                  {previousPhaseResult.nodes?.length || 0} nodes available from Phase {phaseIndex}
                </p>
                <label>
                  Use:
                  <select value={phase.originFilter} onChange={handleOriginFilterChange}>
                    {ORIGIN_FILTER_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            ) : (
              <p className="previous-phase-warning">
                Execute Phase {phaseIndex} first to use its results.
              </p>
            )}
          </div>
        )}

        {isCombinePhase && (
          <div className="multi-phase-origin">
            <div className="multi-phase-selection">
              <p className="previous-phase-info">Select phases to combine:</p>
              {allPhases.map((p, idx) => {
                if (idx >= phaseIndex) return null; // Only show earlier phases
                const result = allPhaseResults[p.id];
                const nodeCount = result?.nodes?.length || 0;
                const isChecked = (phase.previousPhaseIds || []).includes(p.id);
                return (
                  <label key={p.id} className="multi-phase-checkbox">
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => handlePreviousPhaseIdToggle(p.id)}
                    />
                    <span>
                      Phase {idx + 1}
                      {p.name ? `: ${p.name}` : ""}
                      {result ? ` (${nodeCount} nodes)` : " (not executed)"}
                    </span>
                  </label>
                );
              })}
            </div>
            <div className="settings-grid" style={{ marginTop: "var(--spacing-md)" }}>
              <SettingsSelect
                id={`combine-op-${phase.id}`}
                label="Combine Operation"
                value={phase.phaseCombineOperation || "Intersection"}
                options={SET_OPERATION_OPTIONS}
                onChange={handleCombineOperationChange}
              />
            </div>
            <div className="setting-item full-width" style={{ marginTop: "var(--spacing-md)" }}>
              <label>
                Use from each source:
                <select value={phase.originFilter} onChange={handleOriginFilterChange}>
                  {ORIGIN_FILTER_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>
        )}
      </div>

      {/* Settings Section — hide traversal settings for combine phases */}
      <div className="phase-section">
        <h4>{isCombinePhase ? "Output Settings" : "Settings"}</h4>

        {/* Graph Type toggle - only visible when phenotypes graph is enabled */}
        {!isCombinePhase && PHENOTYPES_ENABLED && (
          <div className="setting-item full-width" style={{ marginBottom: "var(--spacing-md)" }}>
            <label htmlFor={`graph-type-${phase.id}`}>Graph</label>
            <select
              id={`graph-type-${phase.id}`}
              value={phase.settings.graphType || "phenotypes"}
              onChange={(e) => onUpdateSettings("graphType", e.target.value)}
            >
              <option value="phenotypes">Phenotypes</option>
              <option value="ontologies">Ontologies</option>
            </select>
          </div>
        )}

        {!isCombinePhase && (
          <>
            {/* Same settings toggle - only show when multiple nodes */}
            {phase.originNodeIds.length > 1 && (
              <div className="setting-item full-width">
                <label className="toggle-label">
                  <input
                    type="checkbox"
                    checked={!phase.showAdvancedSettings}
                    onChange={() => onToggleAdvancedSettings()}
                  />
                  Use same settings for all nodes
                </label>
              </div>
            )}

            {/* Shared Settings (when "same settings" is checked) */}
            {!showAdvancedSettings && (
              <div className="settings-grid">
                <SettingsSelect
                  id={`depth-${phase.id}`}
                  label="Depth"
                  value={phase.settings.depth}
                  options={DEPTH_OPTIONS}
                  onChange={(e) => onUpdateSettings("depth", Number.parseInt(e.target.value, 10))}
                />
                <SettingsSelect
                  id={`direction-${phase.id}`}
                  label="Direction"
                  value={phase.settings.edgeDirection}
                  options={DIRECTION_OPTIONS}
                  onChange={(e) => onUpdateSettings("edgeDirection", e.target.value)}
                />
                {(phase.originNodeIds.length > 1 || phase.originSource === "previousPhase") && (
                  <SettingsSelect
                    id={`operation-${phase.id}`}
                    label="Set Operation"
                    value={phase.settings.setOperation}
                    options={SET_OPERATION_OPTIONS}
                    onChange={(e) => onUpdateSettings("setOperation", e.target.value)}
                  />
                )}
              </div>
            )}

            {/* Per-Node Settings (when advanced mode is enabled) */}
            {showAdvancedSettings && (
              <div className="per-node-settings">
                <div className="settings-grid">
                  <SettingsSelect
                    id={`operation-${phase.id}`}
                    label="Set Operation"
                    value={phase.settings.setOperation}
                    options={SET_OPERATION_OPTIONS}
                    onChange={(e) => onUpdateSettings("setOperation", e.target.value)}
                  />
                </div>

                <h5>Per-Node Settings</h5>
                {phase.originNodeIds.map((nodeId) => {
                  const nodeInfo = nodeDetails[nodeId];
                  const displayName = getNodeLabel(nodeInfo, nodeId);
                  const nodeColor = getCollectionColor(nodeId);
                  return (
                    <div key={nodeId} className="per-node-setting-row">
                      <span
                        className="per-node-label"
                        title={nodeId}
                        style={nodeColorStyle(nodeColor)}
                      >
                        {displayName}
                      </span>
                      <div className="per-node-controls">
                        <label>
                          Depth:
                          <select
                            value={getNodeDepth(nodeId)}
                            onChange={(e) =>
                              onUpdatePerNodeSetting(
                                nodeId,
                                "depth",
                                Number.parseInt(e.target.value, 10),
                              )
                            }
                          >
                            {DEPTH_OPTIONS.map((d) => (
                              <option key={d} value={d}>
                                {d}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          Direction:
                          <select
                            value={getNodeDirection(nodeId)}
                            onChange={(e) =>
                              onUpdatePerNodeSetting(nodeId, "edgeDirection", e.target.value)
                            }
                          >
                            {DIRECTION_OPTIONS.map((d) => (
                              <option key={d} value={d}>
                                {d}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Collections */}
            <div className="setting-item full-width">
              <span className="setting-label">Collections</span>
              <FilterableDropdown
                label="collections"
                options={collections || allCollections}
                selectedOptions={phase.settings.allowedCollections || []}
                onOptionToggle={handleCollectionToggle}
                getOptionLabel={getCollectionDisplayName}
                getColorForOption={getCollectionColorByKey}
              />
            </div>

            {/* Edge Filters */}
            {Object.keys(edgeFilterOptions || {}).length > 0 && (
              <div className="setting-item full-width">
                <span className="setting-label">Edge Filters</span>
                {Object.entries(edgeFilterOptions).map(([field, filterData]) =>
                  filterData.type === "numeric" ? (
                    <RangeSliderFilter
                      key={field}
                      field={field}
                      min={filterData.min}
                      max={filterData.max}
                      currentMin={phase.settings.edgeFilters?.[field]?.min}
                      currentMax={phase.settings.edgeFilters?.[field]?.max}
                      onRangeChange={handleNumericEdgeFilterChange}
                    />
                  ) : (
                    <FilterableDropdown
                      key={field}
                      label={field}
                      options={filterData.values || filterData}
                      selectedOptions={phase.settings.edgeFilters?.[field] || []}
                      onOptionToggle={(value) => handleEdgeFilterToggle(field, value)}
                    />
                  ),
                )}
              </div>
            )}
          </>
        )}

        {/* Return Collections (filter results to specific collections) */}
        <div className="setting-item full-width">
          <span className="setting-label">Return results from</span>
          <FilterableDropdown
            label="collections to include in results"
            options={collections || allCollections}
            selectedOptions={phase.settings.returnCollections || []}
            onOptionToggle={handleReturnCollectionToggle}
            getOptionLabel={getCollectionDisplayName}
            getColorForOption={getCollectionColorByKey}
          />
          <span className="setting-hint">Leave empty to include all collections in results</span>
        </div>

        {/* Collapse Leaf Nodes toggle - not relevant for combine phases */}
        {!isCombinePhase && (
          <div className="setting-item">
            <label className="toggle-label">
              <input
                type="checkbox"
                checked={phase.settings.collapseLeafNodes ?? true}
                onChange={(e) => onUpdateSettings("collapseLeafNodes", e.target.checked)}
              />
              Collapse leaf nodes
            </label>
          </div>
        )}
      </div>

      {/* Actions Section */}
      <div className="phase-actions">
        <button
          type="button"
          className={`execute-phase-btn ${justCompleted ? "completed" : ""}`}
          onClick={onExecute}
          disabled={!canExecute}
        >
          {isExecuting ? (
            <>
              <span className="spinner" />
              Executing...
            </>
          ) : justCompleted ? (
            "\u2713 Done"
          ) : (
            `Execute Phase ${phaseIndex + 1}`
          )}
        </button>

        {/* Result Summary */}
        {phase.result && (
          <div className={`phase-result-summary ${justCompleted ? "flash" : ""}`}>
            {phase.result.nodes?.length || 0} nodes, {phase.result.links?.length || 0} edges
          </div>
        )}
      </div>
    </div>
  );
};

export default memo(PhaseEditor);
