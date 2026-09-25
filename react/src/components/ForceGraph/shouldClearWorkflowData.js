/**
 * Whether a mounting ForceGraph should discard workflow results already in the
 * graph slice.
 *
 * Workflow results are written to the graph slice with source "workflow". A
 * graph page mounting over them has to clear them, or it renders the previous
 * page's results instead of running its own query. The Workflow Builder's own
 * canvas is the exception: there the workflow data *is* the subject, and
 * clearing it drops originNodeIds, which empties the Origins panel and unmarks
 * the origin nodes on a graph that still visibly contains them.
 *
 * @param {Object} params
 * @param {boolean} params.hasNodes - Whether the slice currently holds nodes.
 * @param {string} params.source - What produced the current graph data.
 * @param {boolean} params.isWorkflowHost - Whether the workflow builder hosts
 *   this canvas.
 * @returns {boolean}
 */
export const shouldClearWorkflowData = ({ hasNodes, source, isWorkflowHost }) =>
  Boolean(hasNodes) && source === "workflow" && !isWorkflowHost;
