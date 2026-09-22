import DatasetFigures from "components/DatasetFigures";
import ForceGraph from "components/ForceGraph/ForceGraph";
import NodeInspector from "components/NodeInspector";
import OriginsSidebar from "components/OriginsSidebar";
import SavedGraphShelf from "components/SavedGraphShelf";
import { useNodeDocument } from "hooks";
import { useRef, useState } from "react";
import { useSelector } from "react-redux";
import { selectOriginHistory } from "store";
import { getTitle } from "utils";

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
          {/* Graph and shelf fill the column exactly; the figures scroll in
              beneath them. Grouping the two is what keeps the figures off the
              first screen without reserving a guessed number of pixels for the
              shelf, whose height changes when its history card renders. */}
          <div className="graph-workspace-pane">
            <div className="graph-workspace-canvas-body">
              {/* The origins toggle lives among the canvas action icons (ForceGraph
                renders it) so the panel is opened from the graph itself. */}
              <ForceGraph
                nodeIds={nodeIds}
                settings={settings}
                title={graphTitle}
                onNodeSelect={setSelectedNodeId}
                originsOpen={isOriginsOpen}
                onToggleOrigins={() => setIsOriginsOpen((open) => !open)}
              />
              <OriginsSidebar isOpen={isOriginsOpen} onClose={() => setIsOriginsOpen(false)} />
            </div>
            <div className="graph-workspace-shelf">
              {/* History heading = the graph's origin node(s). */}
              <h3 className="graph-history-title">{graphTitle}</h3>
              <SavedGraphShelf />
            </div>
          </div>
          <DatasetFigures document={figuresDocument} />
        </section>
      </div>
    </div>
  );
};

export default GraphWorkspace;
