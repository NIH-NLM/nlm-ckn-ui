/**
 * WorkflowBuilder component - main container for the multi-phase workflow builder.
 *
 * Manages the workflow state and coordinates between:
 * - PresetSelector for loading pre-built workflows
 * - PhaseEditor components for configuring each phase
 * - Execution flow for running phases
 */

import { GRAPH_STATUS } from "constants/index";
import { useGraphDataInit } from "hooks";
import { useCallback, useEffect, useRef, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import {
  addFinalStage,
  addPhase,
  addPhaseOriginNode,
  executePhase,
  executeWorkflow,
  fetchNodeDetails,
  initializeWorkflow,
  loadWorkflow,
  removePhase,
  removePhaseOriginNode,
  setWorkflowDescription,
  setWorkflowName,
  showPresets,
  toggleAdvancedSettings,
  updatePerNodeSetting,
  updatePhase,
  updatePhaseSettings,
  updateSetting,
} from "store";
import PhaseEditor from "./PhaseEditor";
import PresetSelector from "./PresetSelector";

/**
 * WorkflowBuilder is the main container component for building multi-phase graph queries.
 */
const WorkflowBuilder = ({ onGraphReady }) => {
  const dispatch = useDispatch();
  const requestedNodeIdsRef = useRef(new Set());

  // Select workflow builder state
  const {
    workflowId,
    workflowName,
    workflowDescription,
    phases,
    phaseResults,
    activeGraph,
    status,
    executingPhaseId,
    error,
    nodeDetails,
    showPresetSelector,
  } = useSelector((state) => state.workflowBuilder);

  // Get collections and edge filter options from graph state
  const graphType = useSelector((state) => state.graph.present.settings.graphType);
  const collections = useSelector((state) => state.graph.present.settings.allCollections || []);
  const availableEdgeFilters = useSelector((state) => state.graph.present.availableEdgeFilters);

  // Initialize collections and edge filter options
  useGraphDataInit(graphType);

  // Toast notification state
  const [toastMessage, setToastMessage] = useState(null);

  // Auto-dismiss toast after 2 seconds
  useEffect(() => {
    if (toastMessage) {
      const timer = setTimeout(() => setToastMessage(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [toastMessage]);

  // Note: workflow is only initialized when user selects a preset or starts from scratch

  // Fetch node details when origin nodes change
  useEffect(() => {
    const allNodeIds = phases.flatMap((phase) => phase.originNodeIds || []);
    const missingNodeIds = allNodeIds.filter((id) => !requestedNodeIdsRef.current.has(id));

    if (missingNodeIds.length > 0) {
      for (const id of missingNodeIds) requestedNodeIdsRef.current.add(id);
      dispatch(fetchNodeDetails({ nodeIds: missingNodeIds }));
    }
  }, [dispatch, phases]);

  // Notify parent when graph is ready
  useEffect(() => {
    if (activeGraph && onGraphReady) {
      onGraphReady(activeGraph);
    }
  }, [activeGraph, onGraphReady]);

  // Handle loading a preset workflow
  const handleSelectPreset = useCallback(
    (preset) => {
      dispatch(loadWorkflow(preset));
      if (preset.layoutMode) {
        dispatch(updateSetting({ setting: "layoutMode", value: preset.layoutMode }));
      }
    },
    [dispatch],
  );

  // Handle starting from scratch
  const handleStartFromScratch = useCallback(() => {
    dispatch(initializeWorkflow());
  }, [dispatch]);

  // Handle going back to preset selection
  const handleBackToPresets = useCallback(() => {
    if (phases.length > 0) {
      if (!window.confirm("You'll lose your current workflow configuration. Continue?")) {
        return;
      }
    }
    dispatch(showPresets());
  }, [dispatch, phases.length]);

  // Handle workflow name change
  const handleNameChange = useCallback(
    (e) => {
      dispatch(setWorkflowName(e.target.value));
    },
    [dispatch],
  );

  // Handle workflow description change
  const handleDescriptionChange = useCallback(
    (e) => {
      dispatch(setWorkflowDescription(e.target.value));
    },
    [dispatch],
  );

  // Handle adding a new phase
  const handleAddPhase = useCallback(() => {
    dispatch(addPhase());
  }, [dispatch]);

  const handleAddFinalStage = useCallback(() => {
    dispatch(addFinalStage());
  }, [dispatch]);

  // Handle removing a phase
  const handleRemovePhase = useCallback(
    (phaseId) => {
      dispatch(removePhase(phaseId));
    },
    [dispatch],
  );

  // Handle updating a phase
  const handleUpdatePhase = useCallback(
    (phaseId, updates) => {
      dispatch(updatePhase({ phaseId, updates }));
    },
    [dispatch],
  );

  // Handle updating phase settings
  const handleUpdatePhaseSettings = useCallback(
    (phaseId, setting, value) => {
      dispatch(updatePhaseSettings({ phaseId, setting, value }));
    },
    [dispatch],
  );

  // Handle adding origin node to a phase
  const handleAddOriginNode = useCallback(
    (phaseId, nodeId) => {
      dispatch(addPhaseOriginNode({ phaseId, nodeId }));
    },
    [dispatch],
  );

  // Handle removing origin node from a phase
  const handleRemoveOriginNode = useCallback(
    (phaseId, nodeId) => {
      dispatch(removePhaseOriginNode({ phaseId, nodeId }));
    },
    [dispatch],
  );

  // Handle toggling advanced (per-node) settings for a phase
  const handleToggleAdvancedSettings = useCallback(
    (phaseId) => {
      dispatch(toggleAdvancedSettings({ phaseId }));
    },
    [dispatch],
  );

  // Handle updating a per-node setting
  const handleUpdatePerNodeSetting = useCallback(
    (phaseId, nodeId, setting, value) => {
      dispatch(updatePerNodeSetting({ phaseId, nodeId, setting, value }));
    },
    [dispatch],
  );

  // Handle executing a single phase
  const handleExecutePhase = useCallback(
    (phaseId) => {
      dispatch(executePhase({ phaseId }));
    },
    [dispatch],
  );

  // Handle executing the full workflow
  const handleExecuteWorkflow = useCallback(() => {
    dispatch(executeWorkflow());
  }, [dispatch]);

  // Copy shareable URL to clipboard
  const handleShareWorkflow = useCallback(() => {
    const workflowData = {
      id: workflowId,
      name: workflowName,
      description: workflowDescription,
      phases: phases.map((p) => ({
        ...p,
        result: null, // Don't include results in shared URL
      })),
    };

    try {
      // Use a Unicode-safe encoding: JSON -> UTF-8 bytes -> base64
      const jsonStr = JSON.stringify(workflowData);
      const utf8Bytes = new TextEncoder().encode(jsonStr);
      const binaryStr = Array.from(utf8Bytes, (byte) => String.fromCharCode(byte)).join("");
      const encoded = btoa(binaryStr);

      if (encoded.length > 4000) {
        setToastMessage(
          "Workflow is too large to share via URL. Try reducing the number of phases.",
        );
        return;
      }

      // Use hash router format: origin/path#/workflow-builder?w=...
      const url = `${window.location.origin}${window.location.pathname}#/workflow-builder?w=${encodeURIComponent(encoded)}`;
      navigator.clipboard.writeText(url);
      setToastMessage("Link copied to clipboard!");
    } catch (err) {
      console.error("Failed to create shareable URL:", err);
      setToastMessage("Failed to create shareable URL. The workflow may be too large to encode.");
    }
  }, [workflowId, workflowName, workflowDescription, phases]);

  // Check if all phases have origin nodes configured
  const hasPhases = phases.length > 0;
  const canExecuteWorkflow =
    hasPhases &&
    status !== GRAPH_STATUS.LOADING &&
    phases.every(
      (p, i) =>
        (p.originSource === "manual" && p.originNodeIds.length > 0) ||
        (p.originSource === "collection" && !!p.originCollection) ||
        (p.originSource === "previousPhase" && i > 0) ||
        (p.originSource === "multiplePhases" && (p.previousPhaseIds || []).length >= 2) ||
        (p.originSource === "filter" && i > 0),
    );

  // Show preset selector view
  if (showPresetSelector) {
    return (
      <div className="workflow-builder">
        <PresetSelector
          onSelectPreset={handleSelectPreset}
          onStartFromScratch={handleStartFromScratch}
        />
      </div>
    );
  }

  // Show workflow editor view
  return (
    <div className="workflow-builder">
      {/* Header */}
      <div className="workflow-builder-header">
        <div className="workflow-name-section">
          <button type="button" className="back-to-presets-btn" onClick={handleBackToPresets}>
            &larr; Presets
          </button>
          <input
            type="text"
            className="workflow-name-input"
            value={workflowName}
            onChange={handleNameChange}
            placeholder="Untitled Workflow"
          />
        </div>
        <div className="workflow-actions">
          <button type="button" className="share-btn" onClick={handleShareWorkflow}>
            Share
          </button>
        </div>
      </div>

      {/* Description */}
      <textarea
        className="workflow-description-input"
        value={workflowDescription}
        onChange={handleDescriptionChange}
        placeholder="Describe this workflow..."
        rows={2}
      />

      {/* Phases */}
      <div className="phases-container custom-scrollbar">
        {phases.map((phase, index) => {
          const isCombine = phase.originSource === "multiplePhases";
          return (
            <div key={phase.id} className="phase-wrapper">
              {index > 0 && (
                <div className={`phase-connector ${isCombine ? "combine-connector" : ""}`}>
                  <span className="connector-arrow">&#8595;</span>
                  {phase.originSource === "previousPhase" && (
                    <span className="connector-label">feeds into</span>
                  )}
                  {isCombine && <span className="connector-label">combines</span>}
                </div>
              )}
              <PhaseEditor
                phase={phase}
                phaseIndex={index}
                previousPhaseResult={
                  phase.previousPhaseId ? phaseResults[phase.previousPhaseId] : null
                }
                allPhases={phases}
                allPhaseResults={phaseResults}
                onUpdate={(updates) => handleUpdatePhase(phase.id, updates)}
                onUpdateSettings={(setting, value) =>
                  handleUpdatePhaseSettings(phase.id, setting, value)
                }
                onAddOriginNode={(nodeId) => handleAddOriginNode(phase.id, nodeId)}
                onRemoveOriginNode={(nodeId) => handleRemoveOriginNode(phase.id, nodeId)}
                onToggleAdvancedSettings={() => handleToggleAdvancedSettings(phase.id)}
                onUpdatePerNodeSetting={(nodeId, setting, value) =>
                  handleUpdatePerNodeSetting(phase.id, nodeId, setting, value)
                }
                onExecute={() => handleExecutePhase(phase.id)}
                onDelete={() => handleRemovePhase(phase.id)}
                isExecuting={executingPhaseId === phase.id}
                collections={collections}
                edgeFilterOptions={availableEdgeFilters}
                nodeDetails={nodeDetails}
              />
            </div>
          );
        })}
      </div>

      {/* Add Phase / Execute Workflow */}
      <div className="workflow-footer">
        <button type="button" className="add-phase-btn" onClick={handleAddPhase}>
          + Add Phase
        </button>
        <button
          type="button"
          className="add-phase-btn"
          onClick={handleAddFinalStage}
          disabled={
            phases.length < 2 || phases[phases.length - 1]?.originSource === "multiplePhases"
          }
          title={
            phases.length < 2
              ? "Requires at least 2 phases"
              : "Add a phase that combines all previous phases"
          }
        >
          + Add Final Stage
        </button>
        <button
          type="button"
          className="execute-workflow-btn"
          onClick={handleExecuteWorkflow}
          disabled={!canExecuteWorkflow}
        >
          {status === GRAPH_STATUS.LOADING ? (
            <>
              <span className="spinner" />
              Executing...
            </>
          ) : (
            "Execute Workflow"
          )}
        </button>
      </div>

      {/* Error Display */}
      {error && (
        <div className="workflow-error" role="alert">
          <strong>Error:</strong> {error}
        </div>
      )}

      {/* Toast Notification */}
      {toastMessage && <div className="workflow-toast">{toastMessage}</div>}
    </div>
  );
};

export default WorkflowBuilder;
