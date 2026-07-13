import ForceGraph from "components/ForceGraph/ForceGraph";
import NodeInspector from "components/NodeInspector";
import SavedGraphShelf from "components/SavedGraphShelf";
import { useState } from "react";

/**
 * Host-agnostic graph workspace: left node-inspector, center force graph,
 * bottom saved-graph shelf. The Collections host feeds it an origin document,
 * origin node ids, and settings.
 */
const GraphWorkspace = ({ originDocument, nodeIds, settings }) => {
  const [selectedNodeId, setSelectedNodeId] = useState(null);

  return (
    <div className="graph-workspace">
      <div className="graph-workspace-body">
        <aside className="graph-workspace-inspector">
          <NodeInspector selectedNodeId={selectedNodeId} originDocument={originDocument} />
        </aside>
        <section className="graph-workspace-canvas">
          <ForceGraph nodeIds={nodeIds} settings={settings} onNodeSelect={setSelectedNodeId} />
        </section>
      </div>
      <footer className="graph-workspace-shelf">
        <SavedGraphShelf />
      </footer>
    </div>
  );
};

export default GraphWorkspace;
