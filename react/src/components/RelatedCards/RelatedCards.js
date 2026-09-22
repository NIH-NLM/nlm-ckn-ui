import DocumentCard from "components/DocumentCard";
import { useRelatedDocuments } from "hooks";

/**
 * Shows the full cards of a document's related nodes under a "Related"
 * heading, so a neighbor's values appear as its own card and never as rows of
 * this one. Renders nothing when the document has no related nodes.
 * @param {object} props
 * @param {object} props.document - The document whose related nodes to show.
 */
const RelatedCards = ({ document }) => {
  const related = useRelatedDocuments(document);
  if (related.length === 0) return null;
  return (
    <section className="inspector-related" aria-label="Related">
      <h3 className="inspector-related-title">Related</h3>
      {related.map((doc) => (
        <DocumentCard key={doc._id} document={doc} />
      ))}
    </section>
  );
};

export default RelatedCards;
