/**
 * D3 simulation utility functions for force graph.
 * Handles simulation state management and lifecycle.
 */

/**
 * Returns promise that resolves when simulation 'cools down'.
 * Used to wait for layout to stabilize before performing actions.
 * @param {Object} simulation - D3 force simulation
 * @param {number} threshold - Alpha threshold to wait for
 * @returns {Promise} Resolves when simulation reaches threshold
 */
export function waitForAlpha(simulation, threshold) {
  return new Promise((resolve) => {
    if (simulation.alpha() < threshold) {
      resolve();
    } else {
      simulation.on("tick.alphaCheck", () => {
        if (simulation.alpha() < threshold) {
          simulation.on("tick.alphaCheck", null);
          resolve();
        }
      });
    }
  });
}

/**
 * Starts or stops D3 simulation forces.
 * Setting strengths to zero effectively freezes graph layout.
 * @param {boolean} on - Whether to run or stop simulation
 * @param {Object} simulation - D3 force simulation
 * @param {Object} forceNode - D3 force for node repulsion
 * @param {Object} forceCenter - D3 force for centering
 * @param {Object} forceLink - D3 force for link distances
 * @param {Array} links - Links to apply to forceLink
 * @param {number} nodeForceStrength - Strength for node repulsion
 * @param {number} centerForceStrength - Strength for centering
 * @param {number} linkForceStrength - Strength for link distances
 */
export function runSimulation(
  on,
  simulation,
  forceNode,
  forceCenter,
  forceLink,
  links,
  nodeForceStrength,
  centerForceStrength,
  linkForceStrength,
) {
  if (on) {
    simulation.alpha(1).restart();
    forceNode.strength(nodeForceStrength);
    forceCenter.strength(centerForceStrength);
    forceLink.strength(linkForceStrength);
    forceLink.links(links);
  } else {
    simulation.stop();
    forceNode.strength(0);
    forceCenter.strength(0);
    forceLink.strength(0);
    forceLink.links([]);
  }
}

/**
 * Default graph configuration options.
 * Provides sensible defaults for all graph properties.
 */
export const DEFAULT_GRAPH_OPTIONS = {
  nodeId: (d) => d._id,
  label: (d) => d.label || d._id,
  nodeGroup: undefined,
  nodeGroups: [],
  collectionMaps: new Map(),
  originNodeIds: [],
  nodeHover: (d) => d.label || d._id,
  nodeFontSize: 10,
  linkFontSize: 10,
  minVisibleFontSize: 7,
  onNodeClick: () => {},
  onNodeDragEnd: () => {},
  interactionCallback: () => {},
  nodeRadius: 16,
  linkSource: ({ _from }) => _from,
  linkTarget: ({ _to }) => _to,
  linkStroke: "#999",
  linkStrokeOpacity: 0.6,
  linkStrokeWidth: 1.5,
  linkStrokeLinecap: "round",
  initialScale: 1,
  width: 640,
  height: 640,
  nodeForceStrength: -1000,
  targetLinkDistance: 175,
  centerForceStrength: 1,
  initialLabelStates: {},
  color: null,
  parallelLinkCurvature: 0.25,
};
