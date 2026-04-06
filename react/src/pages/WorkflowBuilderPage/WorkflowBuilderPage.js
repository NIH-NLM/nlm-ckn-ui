/**
 * WorkflowBuilderPage - Full page for the multi-phase workflow builder.
 *
 * Features:
 * - Multi-phase workflow configuration
 * - Table view of results (default)
 * - Graph visualization of results
 * - Shareable URLs with encoded workflow state
 * - Integration with existing ForceGraph component
 */

import ErrorBoundary from "components/ErrorBoundary";
import ForceGraph from "components/ForceGraph/ForceGraph";
import WorkflowBuilder from "components/WorkflowBuilder";
import ResultsTable from "components/WorkflowBuilder/ResultsTable";
import { GRAPH_STATUS } from "constants/index";
import { useCallback, useEffect, useRef, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useLocation, useNavigate } from "react-router-dom";
import { loadWorkflow, setActiveGraph, setGraphData } from "store";

const WorkflowBuilderPage = () => {
  const dispatch = useDispatch();
  const location = useLocation();
  const navigate = useNavigate();
  const resultsAreaRef = useRef(null);

  // Local state
  const [hasResults, setHasResults] = useState(false);
  const [activeView, setActiveView] = useState("table"); // "table" | "graph"

  // Workflow builder state
  const { activeGraph, activePhaseId, phases, phaseResults, status, executingPhaseId } =
    useSelector((state) => state.workflowBuilder);

  // Load workflow from URL on mount
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const encodedWorkflow = params.get("w");

    if (encodedWorkflow) {
      try {
        // Decode: URL-decode -> base64 -> UTF-8 bytes -> JSON string
        const base64 = decodeURIComponent(encodedWorkflow);
        const binaryStr = atob(base64);
        const utf8Bytes = new Uint8Array(binaryStr.length);
        for (let i = 0; i < binaryStr.length; i++) {
          utf8Bytes[i] = binaryStr.charCodeAt(i);
        }
        const jsonStr = new TextDecoder().decode(utf8Bytes);
        const decoded = JSON.parse(jsonStr);
        dispatch(loadWorkflow(decoded));
        // Clear the URL parameter to avoid re-loading on navigation
        navigate(location.pathname, { replace: true });
      } catch (err) {
        console.error("Failed to decode workflow from URL:", err);
      }
    }
  }, [dispatch, location.search, location.pathname, navigate]);

  // Handle switching to a different phase's results
  const handlePhaseSelect = useCallback(
    (phaseId) => {
      const graph = phaseResults[phaseId];
      if (graph) {
        dispatch(setActiveGraph({ phaseId, graph }));
      }
    },
    [dispatch, phaseResults],
  );

  // Handle when a graph result is ready from the workflow builder
  const handleGraphReady = useCallback(
    (graphData) => {
      if (graphData?.nodes?.length > 0) {
        // Use the actual origin node IDs from the active phase, not all graph nodes.
        const activePhase = phases.find((p) => p.id === activePhaseId);
        const nodeIds = activePhase?._executedOriginNodeIds || activePhase?.originNodeIds || [];

        // Set graph data and origin node IDs in a single dispatch.
        // The setGraphData reducer also sets depth=0 and useFocusNodes=false
        // and snapshots lastAppliedSettings so the "Apply Changes" mechanism
        // works for query-affecting settings in the graph options panel.
        const collapseLeafNodes = activePhase?.settings?.collapseLeafNodes ?? false;
        dispatch(
          setGraphData({
            graphData,
            originNodeIds: nodeIds,
            source: "workflow",
            collapseLeafNodes,
          }),
        );

        setHasResults(true);

        // Scroll to results
        setTimeout(() => {
          if (resultsAreaRef.current) {
            resultsAreaRef.current.scrollIntoView({
              behavior: "smooth",
              block: "start",
            });
          }
        }, 100);
      }
    },
    [dispatch, phases, activePhaseId],
  );

  return (
    <div className="workflow-builder-page">
      <div className="workflow-builder-page-header">
        <h1>Workflow Builder</h1>
        <p>
          Build complex, multi-phase graph queries. Start from a preset or create your own workflow.
          Results from one phase can feed into the next.
        </p>
      </div>

      <div className="workflow-builder-layout">
        {/* Workflow Builder Panel */}
        <aside className="workflow-builder-sidebar">
          <WorkflowBuilder onGraphReady={handleGraphReady} />
        </aside>

        {/* Results Display Area */}
        <main className="workflow-builder-results-area" ref={resultsAreaRef}>
          {hasResults ? (
            <>
              {/* Phase Tabs - show when multiple phases exist and execution has started */}
              {phases.length > 1 && (hasResults || status === GRAPH_STATUS.LOADING) && (
                <div className="results-phase-tabs">
                  {phases.map((phase, index) => {
                    const hasPhaseResults = !!phaseResults[phase.id];
                    const isExecuting = executingPhaseId === phase.id;
                    const isPending = !hasPhaseResults && !isExecuting;
                    return (
                      <button
                        type="button"
                        key={phase.id}
                        className={`phase-tab${activePhaseId === phase.id ? " active" : ""}${isExecuting ? " executing" : ""}${isPending ? " pending" : ""}`}
                        onClick={() => handlePhaseSelect(phase.id)}
                        disabled={isPending}
                      >
                        Phase {index + 1}
                        {phase.name ? `: ${phase.name}` : ""}
                        {isExecuting && <span className="spinner" />}
                      </button>
                    );
                  })}
                </div>
              )}

              {/* View Tabs */}
              <div className="results-view-tabs">
                <button
                  type="button"
                  className={`view-tab ${activeView === "table" ? "active" : ""}`}
                  onClick={() => setActiveView("table")}
                >
                  Table
                </button>
                <button
                  type="button"
                  className={`view-tab ${activeView === "graph" ? "active" : ""}`}
                  onClick={() => setActiveView("graph")}
                >
                  Graph
                </button>
              </div>

              {/* Table View */}
              {activeView === "table" && (
                <div className="results-view-content">
                  <ResultsTable graphData={activeGraph} />
                </div>
              )}

              {/* Graph View */}
              <div
                className="results-view-content graph-view"
                style={{ display: activeView === "graph" ? "block" : "none" }}
              >
                <ErrorBoundary>
                  <ForceGraph />
                </ErrorBoundary>
              </div>
            </>
          ) : (
            <div className="workflow-graph-placeholder">
              <div className="placeholder-content">
                <h3>Results</h3>
                <p>
                  Configure and execute a workflow phase to see results here. Results will display
                  as a table of nodes and edges, with an option to view as a graph.
                </p>
                {status === GRAPH_STATUS.LOADING && (
                  <div className="wb-loading-indicator">
                    <span className="spinner" />
                    Executing query...
                  </div>
                )}
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
};

export default WorkflowBuilderPage;
