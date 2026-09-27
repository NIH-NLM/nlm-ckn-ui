/**
 * Leaf-node collapsing shared by every surface that reports a phase result.
 *
 * The results table and the phase's own result summary both describe the same
 * execution, so they have to apply the same collapse before counting. Keeping
 * this in one place is what stops them disagreeing.
 */

import { findLeafNodes } from "components/ForceGraphConstructor/graphDataProcessing";

/**
 * Removes collapsed leaf nodes and any edges attached to them.
 *
 * @param {{nodes: Array, links: Array}} graphData - The raw phase result.
 * @param {string} collapseMode - "off", "standard", or "all".
 * @param {Array<string>} originNodeIds - Origins, which are never collapsed.
 * @returns {{nodes: Array, links: Array}} The collapsed graph, or the original
 *   object unchanged when collapsing is off or there is nothing to collapse.
 */
export const applyCollapse = (graphData, collapseMode, originNodeIds = []) => {
  if (!graphData?.nodes?.length || !collapseMode || collapseMode === "off") {
    return graphData;
  }
  const allNodeIds = graphData.nodes.map((n) => n._id);
  const collapseNodeIds = allNodeIds.filter((id) => !originNodeIds.includes(id));
  const leafIds = findLeafNodes(
    graphData.nodes.map((n) => ({ id: n._id, ...n })),
    graphData.links.map((l) => ({
      source: l._from || (typeof l.source === "string" ? l.source : l.source?._id),
      target: l._to || (typeof l.target === "string" ? l.target : l.target?._id),
      ...l,
    })),
    collapseNodeIds,
    originNodeIds,
    collapseMode,
  );
  const leafSet = new Set(leafIds);
  return {
    nodes: graphData.nodes.filter((n) => !leafSet.has(n._id)),
    links: graphData.links.filter((l) => {
      const fromId = l._from || (typeof l.source === "string" ? l.source : l.source?._id);
      const toId = l._to || (typeof l.target === "string" ? l.target : l.target?._id);
      return !leafSet.has(fromId) && !leafSet.has(toId);
    }),
  };
};
