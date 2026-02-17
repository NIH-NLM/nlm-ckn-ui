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
  const { activeGraph, activePhaseId, phases, phaseResults, status } = useSelector(
    (state) => state.workflowBuilder,
  );

  // Load workflow from URL on mount
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const encodedWorkflow = params.get("w");

    if (encodedWorkflow) {
      try {
        const decoded = JSON.parse(atob(encodedWorkflow));
        dispatch(loadWorkflow(decoded));
        // Clear the URL parameter to avoid re-loading on navigation
        navigate(location.pathname, { replace: true });
      } catch (err) {
        console.error("Failed to decode workflow from URL:", err);
      }
    }
  }, [dispatch, location.search, location.pathname, navigate]);

  // Phases that have cached results
  const phasesWithResults = phases.filter((p) => phaseResults[p.id]);

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
        const nodeIds = graphData.nodes.map((n) => n._id);

        // Set graph data and origin node IDs in a single dispatch.
        // Settings like depth and useFocusNodes are applied in ForceGraph's
        // constructor path to avoid updateSetting dispatches that set
        // lastActionType="updateSetting" and trigger fetchAndProcessGraph.
        dispatch(setGraphData({ graphData, originNodeIds: nodeIds }));

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
    [dispatch],
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
              {/* Phase Tabs - show when multiple phases have results */}
              {phasesWithResults.length > 1 && (
                <div className="results-phase-tabs">
                  {phasesWithResults.map((phase) => {
                    const phaseIndex = phases.indexOf(phase);
                    return (
                      <button
                        type="button"
                        key={phase.id}
                        className={`phase-tab ${activePhaseId === phase.id ? "active" : ""}`}
                        onClick={() => handlePhaseSelect(phase.id)}
                      >
                        Phase {phaseIndex + 1}
                        {phase.name ? `: ${phase.name}` : ""}
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
              {activeView === "graph" && (
                <div className="results-view-content graph-view">
                  <ErrorBoundary>
                    <ForceGraph />
                  </ErrorBoundary>
                </div>
              )}
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
                  <div className="loading-indicator">
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
