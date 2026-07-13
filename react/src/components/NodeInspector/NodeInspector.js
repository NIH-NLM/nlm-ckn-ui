import DocumentCard from "components/DocumentCard";
import { useNodeDocument } from "hooks";

/**
 * Left-panel inspector. Shows the origin document until a node is selected,
 * then swaps to the selected node's document (fetched on demand).
 * @param {object} props
 * @param {string|null} props.selectedNodeId  "COLL/key" of the clicked node, or null.
 * @param {object} props.originDocument        The page's origin document.
 */
const NodeInspector = ({ selectedNodeId, originDocument }) => {
  const { document, loading, error } = useNodeDocument(selectedNodeId);

  if (!selectedNodeId) {
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
