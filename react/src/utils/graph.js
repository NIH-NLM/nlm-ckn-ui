/**
 * Graph and tree data structure utilities.
 */

import { DEFAULT_LABEL_STATES } from "constants/graph";

/**
 * Resolve the label states a preset asks for, layered over the defaults.
 *
 * Presets declare only what they want to change — a dense preset such as the
 * Big Dipper explorer turns off "link-label", because rendering an edge label
 * on each of its ~150 edges buries the graph it is trying to show.
 *
 * A declaration that overrides nothing resolves to null rather than to the
 * bare defaults, so loading such a preset leaves the user's current labels
 * alone instead of dispatching a no-op that resets them.
 *
 * @param {object} preset - Workflow preset, possibly with a labelStates key.
 * @returns {object|null} Merged label states, or null if the preset overrides nothing.
 */
export function resolvePresetLabelStates(preset) {
  const declared = preset?.labelStates;
  if (!declared || typeof declared !== "object") return null;

  const resolved = { ...DEFAULT_LABEL_STATES };
  let overrides = 0;
  for (const labelClass of Object.keys(DEFAULT_LABEL_STATES)) {
    // Booleans only — Boolean("false") is true, so coercing a string-valued
    // override would apply the opposite of what the preset author wrote.
    if (Object.hasOwn(declared, labelClass) && typeof declared[labelClass] === "boolean") {
      overrides += 1;
      resolved[labelClass] = declared[labelClass];
    }
  }
  return overrides > 0 ? resolved : null;
}

/**
 * Check if raw API graph response has any nodes.
 * @param {object} data - Raw API response data.
 * @returns {boolean} True if data contains nodes.
 */
export const hasNodesInRawData = (data) => {
  if (!data || typeof data !== "object") return false;

  // Shortest-path shape: { nodes: Array, links: Array }
  if (Array.isArray(data.nodes)) {
    return data.nodes.length > 0;
  }

  // Per-origin shape: { [originId]: { nodes: Array, links: Array }, ... }
  // Check each origin's nodes array
  for (const value of Object.values(data)) {
    if (
      value &&
      typeof value === "object" &&
      Array.isArray(value.nodes) &&
      value.nodes.length > 0
    ) {
      return true;
    }
  }

  return false;
};

/**
 * Find every node by ID in a tree structure.
 *
 * A single ontology term can appear at more than one position in the tree:
 * the Cell Ontology's SUB_CLASS_OF relation is a DAG, so a term with more
 * than one parent shows up once under each parent once the DAG is flattened
 * into a displayable tree. Callers that mutate a node found by ID (such as
 * mergeChildren) need every occurrence, not just the first.
 * @param {object} node - Root node to search from.
 * @param {string} id - ID to find.
 * @param {Array} [acc] - Accumulator (internal use).
 * @returns {Array} All nodes matching the ID.
 */
export function findAllNodesById(node, id, acc = []) {
  if (node._id === id) {
    acc.push(node);
  }
  if (node.children) {
    for (const child of node.children) {
      findAllNodesById(child, id, acc);
    }
  }
  return acc;
}

/**
 * Merge children into every occurrence of a parent node in graph data.
 * @param {object} graphData - Graph data structure.
 * @param {string} parentId - Parent node ID.
 * @param {Array} childrenWithGrandchildren - Children to merge.
 * @returns {object} New graph data with merged children.
 */
export function mergeChildren(graphData, parentId, childrenWithGrandchildren) {
  const newData = JSON.parse(JSON.stringify(graphData)); // Deep copy
  const parentNodes = findAllNodesById(newData, parentId);

  if (parentNodes.length > 0) {
    for (const parentNode of parentNodes) {
      parentNode.children = JSON.parse(JSON.stringify(childrenWithGrandchildren));
      parentNode._childrenLoaded = true;
    }
  } else {
    console.warn(`Parent node ${parentId} not found for merging children.`);
  }
  return newData;
}

/**
 * Parse document ID. For edge documents, returns both endpoints.
 * @param {object} document - Document object.
 * @returns {Array<string>} Array of IDs.
 */
export function parseId(document) {
  if (document._from && document._to) {
    return [document._from, document._to];
  }
  return [document._id];
}
