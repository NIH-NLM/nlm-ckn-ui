import DocumentCard from "components/DocumentCard";
import { useNodeDocument } from "hooks";

/**
 * Left-panel inspector. Shows the origin document until a node is selected,
 * then swaps to the selected node's document (fetched on demand).
 * @param {object} props
 * @param {string|null} props.selectedNodeId  "COLL/key" of the clicked node, or null.
 * @param {object} [props.originDocument]      The page's origin document, if any. Hosts
 *   without a single origin (Graph Builder, Workflow) omit it and rely on selection.
 */
const NodeInspector = ({ selectedNodeId, originDocument = null }) => {
  const { document, loading, error } = useNodeDocument(selectedNodeId);

  if (!selectedNodeId) {
    // No selection: show the origin document if the host provides one, otherwise
    // prompt the user to pick a node (Graph Builder / Workflow hosts).
    if (!originDocument) {
      return (
        <div className="node-inspector">
          <div className="node-inspector-empty">Select a node to inspect it.</div>
        </div>
      );
    }
    return (
      <div className="node-inspector">
        <DocumentCard document={originDocument} />
      </div>
    );
  }
  if (loading) {
    return (
      <div className="node-inspector">
        <div className="node-inspector-loading" aria-busy="true">
          Loading node details…
        </div>
      </div>
    );
  }
  if (error || !document?._id) {
    return (
      <div className="node-inspector">
        <div className="node-inspector-fallback">
          <p>{selectedNodeId}</p>
          <a href={`/#/collections/${selectedNodeId}`}>Go to document</a>
        </div>
      </div>
    );
  }
  return (
    <div className="node-inspector">
      <DocumentCard document={document} />
    </div>
  );
};

export default NodeInspector;
