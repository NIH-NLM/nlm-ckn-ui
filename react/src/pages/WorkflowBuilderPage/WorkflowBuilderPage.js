/**
 * WorkflowBuilderPage - Full page for the multi-phase workflow builder.
 *
 * Features:
 * - Multi-phase workflow configuration
 * - The marked step's rows as the workflow's answer (Results tab)
 * - A step's results shown as a graph (default) or a table (Results in context)
 * - Shareable URLs with encoded workflow state
 * - Graph results rendered in the shared GraphWorkspace shell
 */

import ErrorBoundary from "components/ErrorBoundary";
import GraphWorkspace from "components/GraphWorkspace";
import WorkflowBuilder from "components/WorkflowBuilder";
import ResultsTable from "components/WorkflowBuilder/ResultsTable";
import ResultsTabs, { resultsPanelProps } from "components/WorkflowBuilder/ResultsTabs";
import ResultsViewSwitch from "components/WorkflowBuilder/ResultsViewSwitch";
import SolutionTable from "components/WorkflowBuilder/SolutionTable";
import { GRAPH_STATUS } from "constants/index";
import { useCallback, useEffect, useRef, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useLocation, useNavigate } from "react-router-dom";
import { loadWorkflow, setActiveGraph, setGraphData, setSolutionCollection } from "store";
import { phaseOriginsIn } from "utils";

const WorkflowBuilderPage = () => {
  const dispatch = useDispatch();
  const location = useLocation();
  const navigate = useNavigate();
  const resultsAreaRef = useRef(null);

  // Local state
  const [hasResults, setHasResults] = useState(false);
  const [tab, setTab] = useState(null); // "data" | "context", or null until results pick one
  const [view, setView] = useState("graph"); // "graph" | "table"
  // Defer mounting ForceGraph until the graph is first shown. Once shown, stay
  // mounted (hidden via display:none on the other views) so switching back is
  // instant and the simulation isn't re-run.
  const [hasShownGraph, setHasShownGraph] = useState(false);

  // Workflow builder state
  const { activeGraph, activePhaseId, phases, phaseResults, status, executingPhaseId, solution } =
    useSelector((state) => state.workflowBuilder);
  // Without a marked step there is no Results tab; the context view shows alone.
  const inContext = !solution || tab === "context";
  if (hasResults && inContext && view === "graph" && !hasShownGraph) setHasShownGraph(true);
  const activePhase = phases.find((p) => p.id === activePhaseId);

  // A loaded workflow's first results open on Results if a step is marked by then.
  // Loading a workflow clears activeGraph and the tab; re-runs keep both.
  useEffect(() => {
    if (!activeGraph) setTab(null);
    else setTab((t) => t ?? (solution ? "data" : "context"));
  }, [activeGraph, solution]);
  // A loaded or new workflow has no results yet; the old ones and their graph go.
  useEffect(() => {
    if (activeGraph) return;
    setHasResults(false);
    setHasShownGraph(false);
  }, [activeGraph]);
  // Unmarking the answer falls back to the context view, and re-marking keeps it.
  useEffect(() => {
    if (!solution) setTab((t) => t && "context");
  }, [solution]);

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
        const nodeIds = phaseOriginsIn(activePhase, graphData);

        // Set graph data and origin node IDs in a single dispatch.
        // The setGraphData reducer also sets depth=0 and useFocusNodes=false
        // and snapshots lastAppliedSettings so the "Apply Changes" mechanism
        // works for query-affecting settings in the graph options panel.
        const collapseLeafNodes = activePhase?.settings?.collapseLeafNodes ?? "standard";
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
              {solution && <ResultsTabs tab={inContext ? "context" : "data"} onChange={setTab} />}

              {/* Kept mounted while a step is marked so the Results tab's aria-controls has a target */}
              {solution && (
                <div
                  className="results-view-content"
                  style={inContext ? { display: "none" } : undefined}
                  {...resultsPanelProps("data")}
                >
                  {!inContext && (
                    <SolutionTable
                      phaseResult={phaseResults[solution.phaseId]}
                      solution={solution}
                      onChangeCollection={(c) => dispatch(setSolutionCollection(c))}
                    />
                  )}
                </div>
              )}

              {/* One wrapper, always rendered, so toggling the answer never remounts the graph */}
              <div
                className="results-context"
                style={inContext ? undefined : { display: "none" }}
                {...(solution && resultsPanelProps("context"))}
              >
                {/* Step buttons - show when the workflow has more than one step */}
                {phases.length > 1 && (
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

                <ResultsViewSwitch view={view} onChange={setView} />

                {/* Table View */}
                {inContext && view === "table" && (
                  <div className="results-view-content">
                    <ResultsTable
                      graphData={activeGraph}
                      collapseMode={activePhase?.settings?.collapseLeafNodes ?? "standard"}
                      originNodeIds={phaseOriginsIn(activePhase, activeGraph)}
                    />
                  </div>
                )}

                {/* Graph View - mounted only once the graph is first shown, then kept
                  mounted (display:none) while the table or Results shows. */}
                {hasShownGraph && (
                  <div
                    className="results-view-content graph-view"
                    style={{ display: view === "graph" ? "block" : "none" }}
                  >
                    <ErrorBoundary>
                      <GraphWorkspace
                        title="Workflow Graph"
                        showLearnExplore={false}
                        isWorkflowHost
                      />
                    </ErrorBoundary>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="workflow-graph-placeholder">
              <div className="placeholder-content">
                <h3>Results</h3>
                <p>
                  Configure and execute a workflow phase to see results here. Results will display
                  as a graph of nodes and edges, with an option to view as a table.
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
