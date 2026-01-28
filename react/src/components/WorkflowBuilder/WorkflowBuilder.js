/**
 * WorkflowBuilder component - main container for the multi-phase workflow builder.
 *
 * Manages the workflow state and coordinates between:
 * - PresetSelector for loading pre-built workflows
 * - PhaseEditor components for configuring each phase
 * - Execution flow for running phases
 */

import { GRAPH_STATUS } from "constants/index";
import { memo, useCallback, useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import {
  addPhase,
  addPhaseOriginNode,
  executePhase,
  executeWorkflow,
  fetchEdgeFilterOptions,
  fetchNodeDetails,
  initializeWorkflow,
  loadWorkflow,
  removePhase,
  removePhaseOriginNode,
  setWorkflowName,
  showPresets,
  toggleAdvancedSettings,
  updatePerNodeSetting,
  updatePhase,
  updatePhaseSettings,
} from "store";
import PhaseEditor from "./PhaseEditor";
import PresetSelector from "./PresetSelector";

/**
 * WorkflowBuilder is the main container component for building multi-phase graph queries.
 */
const WorkflowBuilder = ({ onGraphReady }) => {
  const dispatch = useDispatch();

  // Select workflow builder state
  const {
    workflowId,
    workflowName,
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
  const collections = useSelector((state) => state.graph.present.settings.allCollections || []);
  const availableEdgeFilters = useSelector((state) => state.graph.present.availableEdgeFilters);
  const edgeFilterStatus = useSelector((state) => state.graph.present.edgeFilterStatus);

  // Toast notification state
  const [toastMessage, setToastMessage] = useState(null);

  // Auto-dismiss toast after 2 seconds
  useEffect(() => {
    if (toastMessage) {
      const timer = setTimeout(() => setToastMessage(null), 2000);
      return () => clearTimeout(timer);
    }
  }, [toastMessage]);

  // Note: workflow is only initialized when user selects a preset or starts from scratch

  // Fetch edge filter options if not already loaded
  useEffect(() => {
    if (edgeFilterStatus === GRAPH_STATUS.IDLE) {
      dispatch(fetchEdgeFilterOptions());
    }
  }, [dispatch, edgeFilterStatus]);

  // Fetch node details when origin nodes change
  useEffect(() => {
    // Collect all origin node IDs that need details
    const allNodeIds = phases.flatMap((phase) => phase.originNodeIds || []);
    const missingNodeIds = allNodeIds.filter((id) => !nodeDetails[id]);

    if (missingNodeIds.length > 0) {
      dispatch(fetchNodeDetails({ nodeIds: missingNodeIds }));
    }
  }, [dispatch, phases, nodeDetails]);

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
    },
    [dispatch],
  );

  // Handle starting from scratch
  const handleStartFromScratch = useCallback(() => {
    dispatch(initializeWorkflow());
  }, [dispatch]);

  // Handle going back to preset selection
  const handleBackToPresets = useCallback(() => {
    dispatch(showPresets());
  }, [dispatch]);

  // Handle workflow name change
  const handleNameChange = useCallback(
    (e) => {
      dispatch(setWorkflowName(e.target.value));
    },
    [dispatch],
  );

  // Handle adding a new phase
  const handleAddPhase = useCallback(() => {
    dispatch(addPhase());
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
    (phaseIndex) => {
      dispatch(executePhase({ phaseIndex }));
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
      phases: phases.map((p) => ({
        ...p,
        result: null, // Don't include results in shared URL
      })),
    };

    try {
      const encoded = btoa(JSON.stringify(workflowData));
      // Use hash router format: origin/path#/workflow-builder?w=...
      const url = `${window.location.origin}${window.location.pathname}#/workflow-builder?w=${encoded}`;
      navigator.clipboard.writeText(url);
      setToastMessage("Link copied to clipboard!");
    } catch (err) {
      console.error("Failed to create shareable URL:", err);
      setToastMessage("Failed to create shareable URL");
    }
  }, [workflowId, workflowName, phases]);

  // Check if all phases have origin nodes configured
  const hasPhases = phases.length > 0;
  const canExecuteWorkflow =
    hasPhases &&
    status !== GRAPH_STATUS.LOADING &&
    phases.every(
      (p, i) =>
        (p.originSource === "manual" && p.originNodeIds.length > 0) ||
        (p.originSource === "previousPhase" && i > 0),
    );

  // Show preset selector view
  if (showPresetSelector) {
    return (
      <div className="workflow-builder">
        <PresetSelector onSelectPreset={handleSelectPreset} onStartFromScratch={handleStartFromScratch} />
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

      {/* Phases */}
      <div className="phases-container">
        {phases.map((phase, index) => (
          <div key={phase.id} className="phase-wrapper">
            {index > 0 && (
              <div className="phase-connector">
                <span className="connector-arrow">&#8595;</span>
                <span className="connector-label">feeds into</span>
              </div>
            )}
            <PhaseEditor
              phase={phase}
              phaseIndex={index}
              previousPhaseResult={index > 0 ? phaseResults[phases[index - 1].id] : null}
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
              onExecute={() => handleExecutePhase(index)}
              onDelete={() => handleRemovePhase(phase.id)}
              isExecuting={executingPhaseId === phase.id}
              collections={collections}
              edgeFilterOptions={availableEdgeFilters}
              nodeDetails={nodeDetails}
            />
          </div>
        ))}
      </div>

      {/* Add Phase / Execute Workflow */}
      <div className="workflow-footer">
        <button type="button" className="add-phase-btn" onClick={handleAddPhase}>
          + Add Phase
        </button>
        <button
          type="button"
          className="execute-workflow-btn"
          onClick={handleExecuteWorkflow}
          disabled={!canExecuteWorkflow}
        >
          {status === GRAPH_STATUS.LOADING ? "Executing..." : "Execute Workflow"}
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

export default memo(WorkflowBuilder);
