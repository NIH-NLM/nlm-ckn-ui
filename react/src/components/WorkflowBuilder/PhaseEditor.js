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

import EdgeFilterSelector from "components/EdgeFilterSelector";
import FilterableDropdown from "components/FilterableDropdown";
import { PHENOTYPES_ENABLED } from "constants/index";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { useSelector } from "react-redux";
import {
  getCollectionColor,
  getCollectionColorByKey,
  getCollectionDisplayName,
  getNodeLabel,
} from "utils/collectionHelpers";
import NodeSearchInput from "./NodeSearchInput";

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

  // Handle toggling a source phase in multiplePhases mode
  const handlePreviousPhaseIdToggle = useCallback(
    (sourcePhaseId) => {
      const current = phase.previousPhaseIds || [];
      const newIds = current.includes(sourcePhaseId)
        ? current.filter((id) => id !== sourcePhaseId)
        : [...current, sourcePhaseId];
      onUpdate({ previousPhaseIds: newIds });
    },
    [phase.previousPhaseIds, onUpdate],
  );

  // Handle combine operation change
  const handleCombineOperationChange = useCallback(
    (e) => {
      onUpdate({ phaseCombineOperation: e.target.value });
    },
    [onUpdate],
  );

  // Handle setting changes
  const handleSettingChange = useCallback(
    (setting, value) => {
      onUpdateSettings(setting, value);
    },
    [onUpdateSettings],
  );

  // Handle collection toggle
  const handleCollectionToggle = useCallback(
    (collectionId) => {
      const currentCollections = phase.settings.allowedCollections || [];
      const newCollections = currentCollections.includes(collectionId)
        ? currentCollections.filter((c) => c !== collectionId)
        : [...currentCollections, collectionId];
      onUpdateSettings("allowedCollections", newCollections);
    },
    [phase.settings.allowedCollections, onUpdateSettings],
  );

  // Handle return collection toggle (filter which collections appear in results)
  const handleReturnCollectionToggle = useCallback(
    (collectionId) => {
      const currentCollections = phase.settings.returnCollections || [];
      const newCollections = currentCollections.includes(collectionId)
        ? currentCollections.filter((c) => c !== collectionId)
        : [...currentCollections, collectionId];
      onUpdateSettings("returnCollections", newCollections);
    },
    [phase.settings.returnCollections, onUpdateSettings],
  );

  // Handle edge filter change from EdgeFilterSelector
  const handleEdgeFilterChange = useCallback(
    (propertyName, values) => {
      onUpdateSettings("edgeFilters", { ...phase.settings.edgeFilters, [propertyName]: values });
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
    <div className={`phase-editor ${isExecuting ? "executing" : ""} ${isCombinePhase ? "combine-phase" : ""}`}>
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
                    style={{
                      backgroundColor: `${nodeColor}20`,
                      borderColor: nodeColor,
                      color: nodeColor,
                    }}
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
              <select
                value={phase.originCollection || ""}
                onChange={handleCollectionSelect}
              >
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
                    <option value="all">All nodes</option>
                    <option value="leafNodes">Leaf nodes only</option>
                    <option value="originNodes">Origin nodes only</option>
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
                      Phase {idx + 1}{p.name ? `: ${p.name}` : ""}
                      {result ? ` (${nodeCount} nodes)` : " (not executed)"}
                    </span>
                  </label>
                );
              })}
            </div>
            <div className="settings-grid" style={{ marginTop: "var(--spacing-md)" }}>
              <div className="setting-item">
                <label htmlFor={`combine-op-${phase.id}`}>Combine Operation</label>
                <select
                  id={`combine-op-${phase.id}`}
                  value={phase.phaseCombineOperation || "Intersection"}
                  onChange={handleCombineOperationChange}
                >
                  <option value="Intersection">Intersection (common nodes)</option>
                  <option value="Union">Union (combine all)</option>
                  <option value="Symmetric Difference">Symmetric Difference</option>
                </select>
              </div>
            </div>
            <div className="setting-item full-width" style={{ marginTop: "var(--spacing-md)" }}>
              <label>
                Use from each source:
                <select value={phase.originFilter} onChange={handleOriginFilterChange}>
                  <option value="all">All nodes</option>
                  <option value="leafNodes">Leaf nodes only</option>
                  <option value="originNodes">Origin nodes only</option>
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
              onChange={(e) => handleSettingChange("graphType", e.target.value)}
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
                {/* Depth */}
                <div className="setting-item">
                  <label htmlFor={`depth-${phase.id}`}>Depth</label>
                  <select
                    id={`depth-${phase.id}`}
                    value={phase.settings.depth}
                    onChange={(e) => handleSettingChange("depth", Number.parseInt(e.target.value, 10))}
                  >
                    {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Direction */}
                <div className="setting-item">
                  <label htmlFor={`direction-${phase.id}`}>Direction</label>
                  <select
                    id={`direction-${phase.id}`}
                    value={phase.settings.edgeDirection}
                    onChange={(e) => handleSettingChange("edgeDirection", e.target.value)}
                  >
                    <option value="ANY">ANY</option>
                    <option value="INBOUND">INBOUND</option>
                    <option value="OUTBOUND">OUTBOUND</option>
                  </select>
                </div>

                {/* Set Operation (only show if multiple origin nodes) */}
                {(phase.originNodeIds.length > 1 || phase.originSource === "previousPhase") && (
                  <div className="setting-item">
                    <label htmlFor={`operation-${phase.id}`}>Set Operation</label>
                    <select
                      id={`operation-${phase.id}`}
                      value={phase.settings.setOperation}
                      onChange={(e) => handleSettingChange("setOperation", e.target.value)}
                    >
                      <option value="Union">Union (combine all)</option>
                      <option value="Intersection">Intersection (common nodes)</option>
                      <option value="Symmetric Difference">Symmetric Difference</option>
                    </select>
                  </div>
                )}
              </div>
            )}

            {/* Per-Node Settings (when advanced mode is enabled) */}
            {showAdvancedSettings && (
              <div className="per-node-settings">
                {/* Set Operation (applies to all) */}
                <div className="settings-grid">
                  <div className="setting-item">
                    <label htmlFor={`operation-${phase.id}`}>Set Operation</label>
                    <select
                      id={`operation-${phase.id}`}
                      value={phase.settings.setOperation}
                      onChange={(e) => handleSettingChange("setOperation", e.target.value)}
                    >
                      <option value="Union">Union (combine all)</option>
                      <option value="Intersection">Intersection (common nodes)</option>
                      <option value="Symmetric Difference">Symmetric Difference</option>
                    </select>
                  </div>
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
                        style={{
                          backgroundColor: `${nodeColor}20`,
                          borderColor: nodeColor,
                          color: nodeColor,
                        }}
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
                            {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => (
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
                            <option value="ANY">ANY</option>
                            <option value="INBOUND">INBOUND</option>
                            <option value="OUTBOUND">OUTBOUND</option>
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
            <div className="setting-item full-width">
              <span className="setting-label">Edge Filters</span>
              <EdgeFilterSelector
                availableFilters={edgeFilterOptions || {}}
                selectedFilters={phase.settings.edgeFilters || {}}
                onFilterChange={handleEdgeFilterChange}
              />
            </div>
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
                onChange={(e) => handleSettingChange("collapseLeafNodes", e.target.checked)}
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
