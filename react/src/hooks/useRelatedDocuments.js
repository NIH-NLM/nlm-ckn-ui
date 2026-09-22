import { relatedCollections } from "config/fieldSections";
import { useEffect, useState } from "react";
import { fetchGraphData } from "services";

/**
 * Fetches the documents a node card shows under "Related": its one-hop
 * neighbors in the collections `relatedCollections` names for it, ordered as
 * listed there. A failed fetch leaves the list empty rather than erroring the
 * card.
 * @param {object|null} document - The card's document. Must contain `_id`.
 * @returns {Array<object>} The related documents.
 */
export const useRelatedDocuments = (document) => {
  const nodeId = document?._id;
  const [related, setRelated] = useState({ nodeId: null, documents: [] });

  useEffect(() => {
    const collections = nodeId ? relatedCollections[nodeId.split("/")[0]] : undefined;
    if (!collections) return;
    let cancelled = false;
    fetchGraphData({
      nodeIds: [nodeId],
      depth: 1,
      edgeDirection: "ANY",
      allowedCollections: collections,
      // Every collection with related documents is a phenotypes collection.
      graphType: "phenotypes",
      edgeFilters: {},
      includeInterNodeEdges: false,
    })
      .then((data) => {
        const rank = (doc) => collections.indexOf(doc._id.split("/")[0]);
        const documents = (data?.[nodeId]?.nodes ?? [])
          .filter((doc) => doc._id !== nodeId && rank(doc) !== -1)
          .sort((a, b) => rank(a) - rank(b));
        if (!cancelled) setRelated({ nodeId, documents });
      })
      .catch(() => {
        if (!cancelled) setRelated({ nodeId, documents: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [nodeId]);

  return related.nodeId === nodeId ? related.documents : [];
};
