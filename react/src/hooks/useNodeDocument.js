import { useEffect, useState } from "react";
import { fetchDocument } from "services";

// Session-scoped cache of resolved node documents, keyed by "COLL/key".
const nodeDocumentCache = new Map();

// Test-only helper to clear the module-scoped cache so specs stay isolated and
// order-independent. Not part of the public API.
export const __clearNodeDocumentCache = () => nodeDocumentCache.clear();

/**
 * Fetches the full document for a graph node id ("COLL/key"), caching results
 * for the session so re-selecting a visited node is instant.
 * @param {string|null} nodeId
 * @returns {{ document: object|null, loading: boolean, error: Error|null }}
 */
export const useNodeDocument = (nodeId) => {
  // Tracks which nodeId the stored document/loading/error state belongs to, so a
  // stale document from a prior nodeId is never returned while a new one is pending.
  const [state, setState] = useState({ nodeId: null, document: null, loading: false, error: null });

  useEffect(() => {
    if (!nodeId) {
      setState({ nodeId: null, document: null, loading: false, error: null });
      return;
    }
    if (nodeDocumentCache.has(nodeId)) {
      setState({ nodeId, document: nodeDocumentCache.get(nodeId), loading: false, error: null });
      return;
    }
    let cancelled = false;
    setState({ nodeId, document: null, loading: true, error: null });
    const [coll, ...rest] = nodeId.split("/");
    const id = rest.join("/");
    fetchDocument(coll, id)
      .then((doc) => {
        if (cancelled) return;
        nodeDocumentCache.set(nodeId, doc);
        setState({ nodeId, document: doc, loading: false, error: null });
      })
      .catch((err) => {
        if (!cancelled) setState({ nodeId, document: null, loading: false, error: err });
      });
    return () => {
      cancelled = true;
    };
  }, [nodeId]);

  if (state.nodeId !== nodeId) {
    // The effect for the current nodeId hasn't run yet; report loading (unless
    // there's no node selected) instead of exposing the previous nodeId's document.
    return { document: null, loading: !!nodeId, error: null };
  }

  const { nodeId: _nodeId, ...rest } = state;
  return rest;
};
