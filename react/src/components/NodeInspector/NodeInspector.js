import DocumentCard from "components/DocumentCard";
import FTUIllustration from "components/FTUIllustration";
import LearnExplore from "components/LearnExplore";
import RelatedCards from "components/RelatedCards";
import { FTU_ILLUSTRATIONS_JSONLD_URL } from "constants/index";
import { useFtuParts } from "contexts";
import { useNodeDocument } from "hooks";
import { findFtuUrlById } from "utils";

/**
 * Derives the FTU illustration URL for a document, if one exists.
 * @param {object|null} inspectedDocument - The document currently shown in the inspector.
 * @param {Array|null|undefined} ftuParts - The FTU parts index from useFtuParts().
 * @returns {string|null} The illustration URL, or null when unavailable.
 */
const resolveFtuUrl = (inspectedDocument, ftuParts) => {
  if (!inspectedDocument?._id || !ftuParts || ftuParts.length === 0) {
    return null;
  }
  const [coll, id] = inspectedDocument._id.split("/");
  if (!coll || !id) {
    return null;
  }
  return findFtuUrlById(ftuParts, `${coll}_${id}`);
};

/**
 * The inspected document's cards in a column that scrolls on its own, with
 * Learn & Explore pinned beneath it (Figma frame V, 930:502).
 */
const InspectedDocument = ({ document, ftuUrl, showLearnExplore }) => (
  <div className="node-inspector">
    <div className="node-inspector-scroll">
      <DocumentCard document={document} />
      <RelatedCards document={document} />
      {ftuUrl && (
        <div className="inspector-ftu">
          <FTUIllustration
            selectedIllustration={ftuUrl}
            illustrations={FTU_ILLUSTRATIONS_JSONLD_URL}
          />
        </div>
      )}
    </div>
    {showLearnExplore && <LearnExplore />}
  </div>
);

/**
 * Left-panel inspector. Shows the origin document until a node is selected,
 * then swaps to the selected node's document (fetched on demand).
 * @param {object} props
 * @param {string|null} props.selectedNodeId  "COLL/key" of the clicked node, or null.
 * @param {object} [props.originDocument]      The page's origin document, if any. Hosts
 *   without a single origin (Graph Builder, Workflow) omit it and rely on selection.
 * @param {boolean} [props.showLearnExplore]   Whether to render the Learn & Explore
 *   footer. The Workflow page hides it (per design); every other host shows it.
 */
const NodeInspector = ({ selectedNodeId, originDocument = null, showLearnExplore = true }) => {
  const { document, loading, error } = useNodeDocument(selectedNodeId);
  const { ftuParts } = useFtuParts();

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
      <InspectedDocument
        document={originDocument}
        ftuUrl={resolveFtuUrl(originDocument, ftuParts)}
        showLearnExplore={showLearnExplore}
      />
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
    <InspectedDocument
      document={document}
      ftuUrl={resolveFtuUrl(document, ftuParts)}
      showLearnExplore={showLearnExplore}
    />
  );
};

export default NodeInspector;
