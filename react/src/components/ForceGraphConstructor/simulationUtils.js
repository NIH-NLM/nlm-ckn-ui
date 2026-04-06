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
 * Apply a layout mode to the simulation by adding/removing clustering forces.
 *
 * - "force": standard force-directed (no clustering forces)
 * - "clustered": forceX/forceY pull nodes toward collection-specific positions
 * - "radial": forceRadial arranges collections in concentric rings
 *
 * @param {Object} d3 - The d3 module (needed for forceX/forceY/forceRadial)
 * @param {Object} simulation - D3 force simulation
 * @param {string} mode - Layout mode: "force", "clustered", or "radial"
 * @param {number} width - SVG width
 * @param {number} height - SVG height
 */
export function applyLayoutMode(d3, simulation, mode, width, height) {
  const nodes = simulation.nodes();

  // Determine which collections are present and their node counts
  const collectionCounts = {};
  for (const node of nodes) {
    const coll = (node._id || node.id || "").split("/")[0];
    if (coll) collectionCounts[coll] = (collectionCounts[coll] || 0) + 1;
  }
  const collections = Object.keys(collectionCounts);

  // Remove any existing layout forces
  simulation.force("cluster-x", null);
  simulation.force("cluster-y", null);
  simulation.force("radial", null);

  if (mode === "clustered" && collections.length > 0) {
    // Arrange collection targets in a circle
    const radius = Math.min(width, height) * 0.5;
    const targets = {};
    collections.forEach((coll, i) => {
      const angle = (2 * Math.PI * i) / collections.length - Math.PI / 2;
      targets[coll] = {
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius,
      };
    });

    const getCollection = (d) => (d._id || d.id || "").split("/")[0];

    simulation.force(
      "cluster-x",
      d3.forceX((d) => targets[getCollection(d)]?.x ?? 0).strength(0.35),
    );
    simulation.force(
      "cluster-y",
      d3.forceY((d) => targets[getCollection(d)]?.y ?? 0).strength(0.35),
    );

    simulation.force("charge")?.strength(-1000);
  } else if (mode === "radial" && collections.length > 0) {
    // Find the "hub" collection (most nodes, prefer CL)
    const hub = collections.includes("CL")
      ? "CL"
      : collections.reduce((a, b) =>
          (collectionCounts[a] || 0) >= (collectionCounts[b] || 0) ? a : b,
        );

    // Assign rings: hub at center (small radius), others in expanding rings
    const nonHub = collections.filter((c) => c !== hub);
    const ringSpacing = Math.min(width, height) * 0.12;
    const rings = { [hub]: 50 };
    nonHub.forEach((coll, i) => {
      rings[coll] = 120 + i * ringSpacing;
    });

    const getCollection = (d) => (d._id || d.id || "").split("/")[0];

    simulation.force(
      "radial",
      d3.forceRadial((d) => rings[getCollection(d)] ?? 200, 0, 0).strength(0.4),
    );

    simulation.force("charge")?.strength(-1000);
  } else {
    // "force" mode — restore default charge
    simulation.force("charge")?.strength(-1000);
  }

  simulation.alpha(0.5).restart();
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
