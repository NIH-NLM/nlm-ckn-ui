import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchNodeDetailsByIds as fetchNodeDetailsByIdsHelper } from "../../../services";
import { getLabel } from "../../../utils";

/**
 * Hook for managing node name resolution and caching.
 * Provides node labels from graph data, local cache, or API fetch.
 * @param {Object} graphData - Current graph data with nodes
 * @param {Array} originNodeIds - Array of origin node IDs
 * @param {string} graphType - Type of graph (phenotypes or ontologies)
 * @returns {Object} { nodeNameMap, cachedNames, fetchNodeDetailsByIds }
 */
export function useNodeNames(graphData, originNodeIds, graphType) {
  // Memoized map from nodeId -> display label (uses getLabel fallback).
  const nodeNameMap = useMemo(() => {
    const map = new Map();
    if (graphData && Array.isArray(graphData.nodes)) {
      for (const n of graphData.nodes) {
        const id = n._id || n.id;
        if (id) {
          try {
            map.set(id, getLabel(n));
          } catch (_err) {
            map.set(id, id);
          }
        }
      }
    }
    return map;
  }, [graphData]);

  // Local cache for nodeId that persists in localStorage for 24 hours.
  const [cachedNames, setCachedNames] = useState(() => {
    try {
      const raw = localStorage.getItem("cellkn_nodeNameCache");
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      const age = Date.now() - (parsed.ts || 0);
      const ONE_DAY_MS = 24 * 60 * 60 * 1000; // 24 hours
      if (age < ONE_DAY_MS) {
        return parsed.names || {};
      }
      // expired
      localStorage.removeItem("cellkn_nodeNameCache");
      return {};
    } catch (_err) {
      return {};
    }
  });

  const persistCachedNames = useCallback(
    (newNames) => {
      try {
        const merged = { ...(cachedNames || {}), ...(newNames || {}) };
        setCachedNames(merged);
        localStorage.setItem(
          "cellkn_nodeNameCache",
          JSON.stringify({ ts: Date.now(), names: merged }),
        );
      } catch (_err) {
        // ignore
      }
    },
    [cachedNames],
  );

  // Use the shared helper from Utils. Adapt results to a map and persist.
  const fetchNodeDetailsByIds = useCallback(
    async (ids = []) => {
      if (!ids || ids.length === 0) return {};
      const results = await fetchNodeDetailsByIdsHelper(ids, graphType);
      const mapped = {};
      if (Array.isArray(results)) {
        for (const item of results) {
          const id = item._id || item.id;
          if (id) mapped[id] = getLabel(item) || id;
        }
      }
      persistCachedNames(mapped);
      return mapped;
    },
    [graphType, persistCachedNames],
  );

  // Ensure origin node labels are available: prefer graphData labels, then cached, otherwise fetch and cache them.
  useEffect(() => {
    if (!originNodeIds || originNodeIds.length === 0) return;
    const missing = originNodeIds.filter((id) => !nodeNameMap?.get(id) && !cachedNames[id]);
    if (missing.length === 0) return;
    // fire-and-forget
    fetchNodeDetailsByIds(missing).catch(() => {});
  }, [originNodeIds, nodeNameMap, cachedNames, fetchNodeDetailsByIds]);

  return { nodeNameMap, cachedNames, fetchNodeDetailsByIds };
}

export default useNodeNames;
