import ForceGraph from "components/ForceGraph/ForceGraph";
import NodeInspector from "components/NodeInspector";
import SavedGraphShelf from "components/SavedGraphShelf";
import { useNodeDocument } from "hooks";
import { useState } from "react";
import { useSelector } from "react-redux";
import { selectOriginHistory } from "store";
import { getTitle } from "utils";

/**
 * Host-agnostic graph workspace: left node-inspector, center force graph,
 * bottom saved-graph shelf.
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
 */
const GraphWorkspace = ({ originDocument = null, nodeIds, settings, title }) => {
  const [selectedNodeId, setSelectedNodeId] = useState(null);
  const originNodeIds = useSelector((state) => state.graph.present.originNodeIds);
  const originHistory = useSelector(selectOriginHistory);
  const activeHistoryId = useSelector((state) => state.savedGraphs.activeHistoryId);

  // The active history entry is the single "current origin" signal — it tracks
  // both restores (restoreHistoryEntry) and new adds (addHistoryEntry). Fall back
  // to the page's origin ids before any history exists.
  const activeEntry = originHistory.find((e) => e.id === activeHistoryId);
  const currentOriginId = activeEntry?.originId ?? nodeIds?.[0] ?? originNodeIds?.[0] ?? null;

  // Resolve the current origin's full document (cached). Seed with the page's
  // originDocument so the first paint doesn't flash a loading state.
  const { document: fetchedOriginDoc } = useNodeDocument(currentOriginId);
  // With an active history entry, follow that entry's origin. Before any history
  // exists, trust the page's own originDocument — its _id may differ from
  // currentOriginId (e.g. an edge document, whose origin ids are its endpoints).
  const currentOriginDoc = activeEntry
    ? (fetchedOriginDoc ?? (originDocument?._id === currentOriginId ? originDocument : null))
    : (originDocument ?? fetchedOriginDoc);

  // Default (no selection): show the resolved current-origin doc via originDocument.
  // If it isn't resolved yet (a host without a seed), let the inspector fetch the
  // origin id itself so it shows a loading state rather than an empty prompt.
  const inspectedNodeId = selectedNodeId ?? (currentOriginDoc ? null : currentOriginId);

  // Title: explicit prop wins (Graph/Workflow hosts); otherwise the current
  // origin's title; otherwise the generic default.
  const graphTitle = title ?? (currentOriginDoc ? getTitle(currentOriginDoc) : "Graph");

  return (
    <div className="graph-workspace">
      <div className="graph-workspace-body">
        <aside className="graph-workspace-inspector">
          <NodeInspector selectedNodeId={inspectedNodeId} originDocument={currentOriginDoc} />
        </aside>
        <section className="graph-workspace-canvas">
          <ForceGraph
            nodeIds={nodeIds}
            settings={settings}
            title={graphTitle}
            onNodeSelect={setSelectedNodeId}
          />
        </section>
      </div>
      <footer className="graph-workspace-shelf">
        <SavedGraphShelf />
      </footer>
    </div>
  );
};

export default GraphWorkspace;
