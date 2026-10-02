import { faCircleQuestion } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import DatasetFigures from "components/DatasetFigures";
import ForceGraph from "components/ForceGraph/ForceGraph";
import NodeInspector from "components/NodeInspector";
import OriginsSidebar from "components/OriginsSidebar";
import SavedGraphShelf from "components/SavedGraphShelf";
import { useNodeDocument } from "hooks";
import { useId, useRef, useState } from "react";
import { useSelector } from "react-redux";
import { selectOriginHistory } from "store";
import { getDatasetFigures, getTitle } from "utils";

const STRIP_COLLAPSED_KEY = "cellkn_graphStripCollapsed";

/** Whether the user last left the history/figures strip collapsed. */
const readStripCollapsed = () => {
  try {
    return localStorage.getItem(STRIP_COLLAPSED_KEY) === "true";
  } catch {
    return false;
  }
};

const writeStripCollapsed = (collapsed) => {
  try {
    localStorage.setItem(STRIP_COLLAPSED_KEY, String(collapsed));
  } catch {
    // Storage unavailable (private mode, quota): the choice lasts this visit only.
  }
};

/**
 * Host-agnostic graph workspace: left node-inspector, center force graph
 * with the saved-graph shelf beneath it, and — for a cell set dataset — its
 * published figures below that.
 *
 * The Collections host feeds it an explicit origin document. Hosts without a
 * single origin (Graph Builder, Workflow) omit `originDocument`; the inspector
 * then defaults to the first origin node in the store until the user selects one.
 *
 * The graph title and the Overview (inspector default) both follow the active
 * History entry, so restoring or adding an origin updates them in place.
 *
 * @param {object} props
 * @param {object} [props.originDocument]  Explicit origin document, or omitted.
 * @param {string[]} [props.nodeIds]       Origin node ids (Collections host only).
 * @param {object} [props.settings]        One-time ForceGraph display defaults.
 * @param {string} [props.title]           Explicit graph title; falls back to the
 *   current origin document's title, or "Graph" when neither is available.
 * @param {boolean} [props.showLearnExplore]  Whether the inspector shows its
 *   Learn & Explore footer. The Workflow host opts out; the rest keep it.
 */
const GraphWorkspace = ({
  originDocument = null,
  nodeIds,
  settings,
  title,
  showLearnExplore = true,
  // Forwarded to ForceGraph: the workflow builder hosts its own results and
  // must not have them cleared as stale.
  isWorkflowHost = false,
}) => {
  const [selectedNodeId, setSelectedNodeId] = useState(null);
  const [isOriginsOpen, setIsOriginsOpen] = useState(false);
  const originNodeIds = useSelector((state) => state.graph.present.originNodeIds);
  const originHistory = useSelector(selectOriginHistory);
  const activeHistoryId = useSelector((state) => state.savedGraphs.activeHistoryId);

  // The active history entry is the single "current origin" signal — it tracks
  // both restores (restoreHistoryEntry) and new adds (addHistoryEntry). Fall back
  // to the page's origin ids before any history exists.
  const activeEntry = originHistory.find((e) => e.id === activeHistoryId);

  // originNodeIds is empty both on first paint (before the page's query has
  // initialized, where the seeded originDocument avoids a loading flash) and
  // after the user removes every origin. Latch once origins have actually
  // resolved so the second case reads as "nothing to inspect" and blanks the
  // panel instead of resurrecting the seed. A latch rather than
  // originHistory.length, so deleting every history card does not undo it.
  const hadOriginsRef = useRef(false);
  if (originNodeIds?.length) hadOriginsRef.current = true;
  const originsCleared = hadOriginsRef.current && !originNodeIds?.length && !activeEntry;

  const currentOriginId = originsCleared
    ? null
    : (activeEntry?.originId ?? nodeIds?.[0] ?? originNodeIds?.[0] ?? null);

  // Resolve the current origin's full document (cached). Seed with the page's
  // originDocument so the first paint doesn't flash a loading state.
  const { document: fetchedOriginDoc } = useNodeDocument(currentOriginId);
  // With an active history entry, follow that entry's origin. Before any history
  // exists, trust the page's own originDocument — its _id may differ from
  // currentOriginId (e.g. an edge document, whose origin ids are its endpoints).
  let currentOriginDoc = null;
  if (!originsCleared) {
    currentOriginDoc = activeEntry
      ? (fetchedOriginDoc ?? (originDocument?._id === currentOriginId ? originDocument : null))
      : (originDocument ?? fetchedOriginDoc);
  }

  // Default (no selection): show the resolved current-origin doc via originDocument.
  // If it isn't resolved yet (a host without a seed), let the inspector fetch the
  // origin id itself so it shows a loading state rather than an empty prompt.
  const inspectedNodeId = selectedNodeId ?? (currentOriginDoc ? null : currentOriginId);

  // Title: explicit prop wins (Graph/Workflow hosts); otherwise the current
  // origin's title; otherwise the generic default.
  const graphTitle = title ?? (currentOriginDoc ? getTitle(currentOriginDoc) : "Graph");

  // Figures follow whatever the inspector is showing. useNodeDocument is cached,
  // so asking for the selected node here does not fetch it twice.
  const { document: selectedDoc } = useNodeDocument(selectedNodeId);
  const figuresDocument = selectedNodeId ? selectedDoc : currentOriginDoc;
  const figureCount = getDatasetFigures(figuresDocument).length;

  // The bottom strip shows either the graph history or the dataset's figures.
  // Falls back to history when the inspected document has no figures.
  const [stripView, setStripView] = useState("history");

  // Collapsing the strip gives the graph its height; remembered per browser.
  const [stripCollapsed, setStripCollapsed] = useState(readStripCollapsed);
  const stripContentId = useId();
  const collapseStrip = (collapsed) => {
    setStripCollapsed(collapsed);
    writeStripCollapsed(collapsed);
  };
  const showStripView = (view) => {
    setStripView(view);
    if (stripCollapsed) collapseStrip(false);
  };
  const showingFigures = stripView === "figures" && figureCount > 0;

  return (
    <div className="graph-workspace">
      <div className="graph-workspace-body">
        <aside className="graph-workspace-inspector">
          <NodeInspector
            selectedNodeId={inspectedNodeId}
            originDocument={currentOriginDoc}
            showLearnExplore={showLearnExplore}
          />
        </aside>
        <section className="graph-workspace-canvas">
          <div className="graph-workspace-pane">
            <div className="graph-workspace-canvas-body">
              {/* The origins toggle lives among the canvas action icons (ForceGraph
                renders it) so the panel is opened from the graph itself. */}
              <ForceGraph
                nodeIds={nodeIds}
                settings={settings}
                title={graphTitle}
                onNodeSelect={setSelectedNodeId}
                isWorkflowHost={isWorkflowHost}
                originsOpen={isOriginsOpen}
                onToggleOrigins={() => setIsOriginsOpen((open) => !open)}
              />
              <OriginsSidebar isOpen={isOriginsOpen} onClose={() => setIsOriginsOpen(false)} />
            </div>
            <div className="graph-workspace-shelf">
              <h3 className="graph-history-title">
                {/* Named "Graph history" for assistive tech: the options panel
                    already has a "History" tab, which is the undo history. */}
                <button
                  type="button"
                  className="graph-strip-toggle"
                  aria-label="Graph history"
                  aria-pressed={!stripCollapsed && !showingFigures}
                  onClick={() => showStripView("history")}
                >
                  History
                </button>
                {figureCount > 0 && (
                  <button
                    type="button"
                    className="graph-strip-toggle"
                    aria-pressed={!stripCollapsed && showingFigures}
                    onClick={() => showStripView("figures")}
                  >
                    Figures ({figureCount})
                  </button>
                )}
                <FontAwesomeIcon
                  icon={faCircleQuestion}
                  title={
                    showingFigures
                      ? "Quality-control figures for this dataset. Click one to open it full size."
                      : "Switch back and forth between your recent graphs."
                  }
                  className="graph-history-help"
                />
                <button
                  type="button"
                  className="graph-strip-collapse"
                  aria-expanded={!stripCollapsed}
                  aria-controls={stripContentId}
                  aria-label={
                    stripCollapsed ? "Expand history and figures" : "Collapse history and figures"
                  }
                  title={stripCollapsed ? "Expand" : "Collapse"}
                  onClick={() => collapseStrip(!stripCollapsed)}
                >
                  <svg
                    className="graph-strip-collapse-icon"
                    aria-hidden="true"
                    focusable="false"
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    width="24"
                    height="24"
                    fill="currentColor"
                  >
                    {/* The Show Options chevron (Figma 651:3255), turned by CSS. */}
                    <path d="M14.199 19.605 7.878 13.005a1.52 1.52 0 0 1-.291-.467A1.62 1.62 0 0 1 7.5 12c0-.191.029-.371.087-.538.057-.168.154-.323.291-.467l6.321-6.6c.252-.263.572-.395.962-.395.389 0 .71.132.961.395.252.263.378.598.378 1.004 0 .407-.126.742-.378 1.005L10.763 12l5.359 5.596c.252.264.378.598.378 1.005 0 .407-.126.741-.378 1.004-.251.263-.572.395-.961.395-.39 0-.71-.132-.962-.395Z" />
                  </svg>
                </button>
              </h3>
              {/* The container stays mounted so the toggle's aria-controls always
                  names an element; only its content goes when collapsed, which
                  also keeps the figures from loading while hidden. */}
              <div id={stripContentId} hidden={stripCollapsed}>
                {!stripCollapsed &&
                  (showingFigures ? (
                    <DatasetFigures document={figuresDocument} />
                  ) : (
                    <SavedGraphShelf />
                  ))}
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};

export default GraphWorkspace;
