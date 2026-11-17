/** Utilities for relating answer rows to the rest of a workflow's results. */

const collectionOf = (id) => String(id).split("/")[0];

/** Flattens every phase's links into one deduplicated edge list. */
export function buildEdgePool(phaseResults) {
  const seen = new Set();
  const pool = [];
  for (const result of Object.values(phaseResults || {})) {
    for (const link of result?.links || []) {
      if (!link?._from || !link?._to) continue;
      const key = link._id || `${link._from}|${link.Label}|${link._to}`;
      if (seen.has(key)) continue;
      seen.add(key);
      pool.push({ id: link._id, from: link._from, to: link._to, label: link.Label });
    }
  }
  return pool;
}

/** Builds a node-id keyed adjacency map, recording both directions of each edge. */
export function buildAdjacency(edgePool) {
  const adjacency = new Map();
  const add = (id, entry) => {
    if (!adjacency.has(id)) adjacency.set(id, []);
    adjacency.get(id).push(entry);
  };
  for (const { from, to, label } of edgePool) {
    add(from, { label, neighborId: to, direction: "out" });
    add(to, { label, neighborId: from, direction: "in" });
  }
  return adjacency;
}

/** Indexes nodes from every phase and the node-detail cache by id. */
export function buildNodeIndex(phaseResults, nodeDetails) {
  const index = new Map();
  for (const node of Object.values(nodeDetails || {})) {
    if (node?._id) index.set(node._id, node);
  }
  for (const result of Object.values(phaseResults || {})) {
    for (const node of result?.nodes || []) {
      if (node?._id) index.set(node._id, node);
    }
  }
  return index;
}

const hop = (ids, step, adjacency) => {
  const next = new Set();
  for (const id of ids) {
    for (const e of adjacency.get(id) || []) {
      if (e.label === step.label && collectionOf(e.neighborId) === step.collection) {
        next.add(e.neighborId);
      }
    }
  }
  return next;
};

/** Node ids at the end of `path` from a row, keeping the row if the path returns to it. */
const walk = (rowId, path, adjacency) =>
  path.reduce((ids, step) => hop(ids, step, adjacency), new Set([rowId]));

/** Distinct node ids reached by following `path` from a row, excluding the row itself. */
export function resolvePath(rowId, path, adjacency) {
  const reached = walk(rowId, path, adjacency);
  reached.delete(rowId);
  return [...reached];
}

/** Hops available after `prefix`, with how many rows can take each, most common first. */
export function listLinkOptions(rowIds, adjacency, prefix = []) {
  const counts = new Map();
  for (const rowId of rowIds) {
    const options = new Set();
    for (const id of walk(rowId, prefix, adjacency)) {
      for (const e of adjacency.get(id) || []) {
        if (e.neighborId !== rowId) {
          options.add(JSON.stringify([e.label, collectionOf(e.neighborId)]));
        }
      }
    }
    for (const key of options) counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts]
    .map(([key, count]) => {
      const [label, collection] = JSON.parse(key);
      return { label, collection, count };
    })
    .sort((a, b) => b.count - a.count);
}
