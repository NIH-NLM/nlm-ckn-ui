import ForceGraph from "components/ForceGraph/ForceGraph";
import NodeInspector from "components/NodeInspector";
import SavedGraphShelf from "components/SavedGraphShelf";
import { useState } from "react";
import { useSelector } from "react-redux";
import { getTitle } from "utils";

/**
 * Host-agnostic graph workspace: left node-inspector, center force graph,
 * bottom saved-graph shelf.
 *
 * The Collections host feeds it an explicit origin document. Hosts without a
 * single origin (Graph Builder, Workflow) omit `originDocument`; the inspector
 * then defaults to the first origin node in the store until the user selects one.
 *
 * @param {object} props
 * @param {object} [props.originDocument]  Explicit origin document, or omitted.
 * @param {string[]} [props.nodeIds]       Origin node ids (Collections host only).
 * @param {object} [props.settings]        One-time ForceGraph display defaults.
 * @param {string} [props.title]           Explicit graph title; falls back to the
 *   origin document's title, or "Graph" when neither is available.
 */
const GraphWorkspace = ({ originDocument = null, nodeIds, settings, title }) => {
  const [selectedNodeId, setSelectedNodeId] = useState(null);
  const originNodeIds = useSelector((state) => state.graph.present.originNodeIds);

  // Without an explicit origin document, fall back to the first origin node so the
  // inspector shows meaningful content before the user clicks anything.
  const fallbackNodeId = originDocument ? null : (originNodeIds?.[0] ?? null);
  const inspectedNodeId = selectedNodeId ?? fallbackNodeId;

  // Title precedence: explicit prop → origin document's title → generic default.
  const graphTitle = title ?? (originDocument ? getTitle(originDocument) : "Graph");

  return (
    <div className="graph-workspace">
      <div className="graph-workspace-body">
        <aside className="graph-workspace-inspector">
          <NodeInspector selectedNodeId={inspectedNodeId} originDocument={originDocument} />
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
