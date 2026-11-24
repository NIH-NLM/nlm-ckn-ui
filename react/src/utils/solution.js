/** Utilities for relating answer rows to the rest of a workflow's results. */

const collectionOf = (id) => String(id).split("/")[0];

/** Flattens every phase's links into one deduplicated edge list. */
export function buildEdgePool(phaseResults) {
  const seen = new Set();
  const pool = [];
  for (const result of Object.values(phaseResults || {})) {
    for (const link of result?.links || []) {
      if (!link?._from || !link?._to) continue;
      const key = link._id || `${link._from}|${typeof link.Label}|${link.Label}|${link._to}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const score = Number.parseFloat(link.Score);
      pool.push({
        id: link._id,
        from: link._from,
        to: link._to,
        label: link.Label,
        ...(Number.isFinite(score) && { score }),
      });
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
  for (const { from, to, label, score } of edgePool) {
    add(from, { label, neighborId: to, direction: "out", score });
    add(to, { label, neighborId: from, direction: "in", score });
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

/**
 * Nodes reached by following `path` from a row, excluding the row itself, with
 * how strongly each is linked: `routes` counts the distinct paths that reach it,
 * and `score` is the highest numeric Score on a last-hop edge (null when none).
 * @returns {{id: string, routes: number, score: number|null}[]} in traversal order
 */
export function rankLinked(rowId, path, adjacency) {
  let frontier = new Map([[rowId, { routes: 1, score: null }]]);
  for (const step of path) {
    const next = new Map();
    for (const [id, { routes }] of frontier) {
      for (const e of adjacency.get(id) || []) {
        if (e.label !== step.label || collectionOf(e.neighborId) !== step.collection) continue;
        // A self-loop is listed both out and in; count it once.
        if (e.direction === "in" && e.neighborId === id) continue;
        const reached = next.get(e.neighborId) || { routes: 0, score: null };
        reached.routes += routes;
        if (e.score !== undefined && (reached.score === null || e.score > reached.score)) {
          reached.score = e.score;
        }
        next.set(e.neighborId, reached);
      }
    }
    frontier = next;
  }
  frontier.delete(rowId);
  return [...frontier].map(([id, strength]) => ({ id, ...strength }));
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
  return rankLinked(rowId, path, adjacency).map((n) => n.id);
}

/** Orders linked nodes strongest first: by score, then routes, then label. */
export const byStrength = (a, b) =>
  (b.score ?? -Infinity) - (a.score ?? -Infinity) ||
  b.routes - a.routes ||
  String(a.label).localeCompare(String(b.label));

/** Hops available after `prefix`, with how many rows can take each, most common first. */
export function listLinkOptions(rowIds, adjacency, prefix = []) {
  const counts = new Map();
  for (const rowId of rowIds) {
    const options = new Map(); // keyed by label type too, so a missing label stays undefined
    for (const id of walk(rowId, prefix, adjacency)) {
      for (const { label, neighborId } of adjacency.get(id) || []) {
        if (neighborId === rowId) continue;
        const collection = collectionOf(neighborId);
        options.set(`${typeof label}|${label}|${collection}`, { label, collection });
      }
    }
    for (const [key, option] of options) {
      counts.set(key, { ...option, count: (counts.get(key)?.count || 0) + 1 });
    }
  }
  return [...counts.values()].sort((a, b) => b.count - a.count);
}

/**
 * Groups a node's neighbors by edge label and direction.
 */
export function neighborsByRelationship(nodeId, adjacency) {
  const groups = new Map();
  for (const { label, direction, neighborId } of adjacency.get(nodeId) || []) {
    const key = `${direction}|${typeof label}|${label}`; // a missing label is not "undefined"
    if (!groups.has(key)) groups.set(key, { label, direction, nodeIds: [] });
    const group = groups.get(key);
    if (!group.nodeIds.includes(neighborId)) group.nodeIds.push(neighborId);
  }
  return [...groups.values()].sort((a, b) =>
    String(a.label ?? "").localeCompare(String(b.label ?? "")),
  );
}

/**
 * Chooses which collection's nodes make up the answer rows.
 * @returns {string|null} requested if present, else the most common collection (ties alphabetical)
 */
export function pickRowCollection(nodes, requested) {
  const counts = new Map();
  for (const n of nodes || []) {
    const c = collectionOf(n._id);
    counts.set(c, (counts.get(c) || 0) + 1);
  }
  if (requested && counts.has(requested)) return requested;
  const ranked = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return ranked.length ? ranked[0][0] : null;
}

/**
 * Joins labels for a table cell, truncating after `max`.
 * @returns {string} e.g. "a, b, c +2"; an en dash when empty
 */
export function formatLinkedLabels(labels, max = 3) {
  if (!labels.length) return "–";
  const shown = labels.slice(0, max).join(", ");
  return labels.length > max ? `${shown} +${labels.length - max}` : shown;
}

/**
 * Turns an edge predicate into readable text.
 */
export function humanizeEdgeLabel(label) {
  const text = String(label).replace(/_/g, " ").toLowerCase();
  return text.charAt(0).toUpperCase() + text.slice(1);
}
