/**
 * D3 simulation utility functions for force graph.
 * Handles simulation state management and lifecycle.
 */

/**
 * Returns promise that resolves when simulation 'cools down'.
 * Uses a generation counter to support cancellation — if the generation
 * changes before the threshold is reached, the promise resolves as a no-op.
 * @param {Object} simulation - D3 force simulation
 * @param {number} threshold - Alpha threshold to wait for
 * @param {Object} generation - Mutable { value: number } counter for cancellation
 * @returns {Promise} Resolves when simulation reaches threshold (or is cancelled)
 */
export function waitForAlpha(simulation, threshold, generation = { value: 0 }) {
  const capturedGen = generation.value;
  return new Promise((resolve) => {
    if (simulation.alpha() < threshold) {
      resolve(capturedGen === generation.value);
    } else {
      simulation.on("tick.alphaCheck", () => {
        if (capturedGen !== generation.value) {
          simulation.on("tick.alphaCheck", null);
          resolve(false);
          return;
        }
        if (simulation.alpha() < threshold) {
          simulation.on("tick.alphaCheck", null);
          resolve(true);
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
    // Drain alpha so callers that read simulation.alpha() after stopping see
    // a settled value. Without this, alpha retains whatever it was when the
    // timer stopped (typically 0.002–0.05), and the alpha-based invariant in
    // updateLabelVisibilityOnZoom would treat the sim as still hot.
    simulation.alpha(0);
    forceNode.strength(0);
    forceCenter.strength(0);
    forceLink.strength(0);
    forceLink.links([]);
  }
}

// Module-level timeout ID for phase transitions, accessible by the constructor
// for cleanup in resize() and setLayoutMode().
let phaseTimeout = null;

/**
 * Apply a layout mode to the simulation using a two-phase approach:
 *   Phase 1 (dispersal): Force-like physics with charge + links, no clustering.
 *   Phase 2 (constraint): Apply clustering/radial forces on dispersed nodes.
 *
 * This produces the same quality layout as the natural Force → Clustered
 * transition by simulating the dispersal phase that Force mode provides.
 *
 * @param {Object} d3 - The d3 module (needed for forceX/forceY/forceRadial)
 * @param {Object} simulation - D3 force simulation
 * @param {string} mode - Layout mode: "force", "clustered", or "radial"
 * @param {number} width - SVG width
 * @param {number} height - SVG height
 * @param {number} linkForceStrength - Captured link force strength to restore after phases
 * @param {Function} onComplete - Called when layout phases finish (e.g., to restore labels)
 * @param {Object} generation - Mutable { value: number } counter shared with waitForAlpha,
 *   used to cancel in-flight phase transitions if the caller changes modes mid-flight.
 */
export function applyLayoutMode(
  d3,
  simulation,
  mode,
  width,
  height,
  linkForceStrength,
  onComplete,
  generation = { value: 0 },
) {
  const nodes = simulation.nodes();

  // Cancel any in-progress phase transition from a previous call
  if (phaseTimeout !== null) {
    clearTimeout(phaseTimeout);
    phaseTimeout = null;
  }

  // Determine which collections are present and their node counts
  const collectionCounts = {};
  for (const node of nodes) {
    const coll = (node._id || node.id || "").split("/")[0];
    if (coll) collectionCounts[coll] = (collectionCounts[coll] || 0) + 1;
  }
  const collections = Object.keys(collectionCounts);

  // Remove any existing layout forces and phase listeners
  simulation.force("cluster-x", null);
  simulation.force("cluster-y", null);
  simulation.force("radial", null);
  simulation.force("position-x", null);
  simulation.force("position-y", null);
  simulation.force("collide", null);
  simulation.on("tick.phaseRestore", null);

  // Release any fixed positions from previous layout modes
  for (const node of nodes) {
    delete node.fx;
    delete node.fy;
  }

  const getCollection = (d) => (d._id || d.id || "").split("/")[0];
  const linkForce = simulation.force("link");

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

    const phase2Clustered = () => {
      simulation.force(
        "cluster-x",
        d3.forceX((d) => targets[getCollection(d)]?.x ?? 0).strength(0.25),
      );
      simulation.force(
        "cluster-y",
        d3.forceY((d) => targets[getCollection(d)]?.y ?? 0).strength(0.25),
      );
      // Collision (short-range) keeps nodes from stacking inside a cluster
      // without the long-range explosion that strong charge causes.
      simulation.force("collide", d3.forceCollide(14).strength(0.9));
      simulation.force("charge")?.strength(-60);
      simulation.alpha(0.5).restart();
      onComplete?.();
    };

    // Phase 1: Force-like dispersal — charge + links active, no clustering.
    // Wait for actual convergence (alpha threshold) rather than a wall-clock
    // timer, so Phase 1 runs long enough regardless of node count / hardware.
    simulation.force("charge")?.strength(-1000);
    if (linkForce) linkForce.strength(linkForceStrength);
    simulation.alpha(1).restart();
    waitForAlpha(simulation, 0.3, generation).then((stillValid) => {
      if (!stillValid) return;
      phase2Clustered();
    });
    return;
  }

  if (mode === "strict-cluster" && collections.length > 0) {
    // Two-phase strict clustering:
    //   Phase 1: ONLY cluster force — no charge, no links, no center.
    //            Nodes collapse tightly onto their collection targets.
    //   Phase 2: Very gentle forces so nodes separate within clusters
    //            without exploding apart.
    const radius = Math.min(width, height) * 0.5;
    const targets = {};
    collections.forEach((coll, i) => {
      const angle = (2 * Math.PI * i) / collections.length - Math.PI / 2;
      targets[coll] = {
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius,
      };
    });

    // Note: waitForAlpha is not used for strict-cluster Phase 1. That phase is
    // not dispersal — it's the actual collapse-onto-cluster-targets step, and
    // benefits from a bounded time window rather than waiting for full settle
    // (which with only cluster forces active would collapse nodes to a single
    // point per target).
    const phase2StrictCluster = () => {
      // Keep cluster pull strong so groups hold together
      simulation.force("cluster-x")?.strength(0.5);
      simulation.force("cluster-y")?.strength(0.5);
      // Collision separates nodes within each cluster without exploding
      // the cluster apart (short-range only, unlike charge).
      simulation.force("collide", d3.forceCollide(14).strength(1));
      // Charge stays at zero — collide handles separation
      simulation.force("charge")?.strength(0);
      simulation.alpha(0.3).restart();
      onComplete?.();
    };

    // Phase 1: ONLY cluster pull — everything else off
    simulation.force(
      "cluster-x",
      d3.forceX((d) => targets[getCollection(d)]?.x ?? 0).strength(0.6),
    );
    simulation.force(
      "cluster-y",
      d3.forceY((d) => targets[getCollection(d)]?.y ?? 0).strength(0.6),
    );
    simulation.force("charge")?.strength(0);
    simulation.force("center")?.strength(0);
    if (linkForce) linkForce.strength(0);
    simulation.alpha(1).restart();

    // Phase 2: very gentle forces to separate nodes within clusters
    phaseTimeout = setTimeout(() => {
      phaseTimeout = null;
      phase2StrictCluster();
    }, 1500);
    return;
  }

  if (mode === "radial" && collections.length > 0) {
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

    const phase2Radial = () => {
      simulation.force(
        "radial",
        d3.forceRadial((d) => rings[getCollection(d)] ?? 200, 0, 0).strength(0.15),
      );
      simulation.force("charge")?.strength(-300);
      simulation.alpha(0.5).restart();
      onComplete?.();
    };

    // Phase 1: Force-like dispersal — wait for actual convergence rather than
    // a wall-clock timer.
    simulation.force("charge")?.strength(-1000);
    if (linkForce) linkForce.strength(linkForceStrength);
    simulation.alpha(1).restart();
    waitForAlpha(simulation, 0.3, generation).then((stillValid) => {
      if (!stillValid) return;
      phase2Radial();
    });
    return;
  }

  if (mode === "circular") {
    // Arrange nodes on a circle, grouped by collection into arc segments.
    // Each collection occupies a proportional arc segment.
    const totalNodes = nodes.length;
    if (totalNodes === 0) return;
    const circleRadius = Math.min(width, height) * 0.4;

    // Build ordered list: nodes grouped by collection
    const nodesByCollection = {};
    for (const node of nodes) {
      const coll = getCollection(node);
      if (!nodesByCollection[coll]) nodesByCollection[coll] = [];
      nodesByCollection[coll].push(node);
    }

    // Assign each node a position on the circle
    let angleOffset = -Math.PI / 2;
    for (const coll of collections) {
      const collNodes = nodesByCollection[coll] || [];
      const arcLength = (collNodes.length / totalNodes) * 2 * Math.PI;
      collNodes.forEach((node, i) => {
        const angle = angleOffset + (i / Math.max(collNodes.length - 1, 1)) * arcLength;
        node.fx = Math.cos(angle) * circleRadius;
        node.fy = Math.sin(angle) * circleRadius;
      });
      angleOffset += arcLength;
    }

    // Brief simulation to draw links, then release fixed positions
    simulation.force("charge")?.strength(0);
    if (linkForce) linkForce.strength(0);
    simulation.alpha(0.1).restart();

    phaseTimeout = setTimeout(() => {
      phaseTimeout = null;
      // Release fixed positions, apply gentle forces to maintain shape
      for (const node of nodes) {
        const tx = node.fx;
        const ty = node.fy;
        node._circleX = tx;
        node._circleY = ty;
        delete node.fx;
        delete node.fy;
        node.x = tx;
        node.y = ty;
      }
      simulation.force("position-x", d3.forceX((d) => d._circleX ?? 0).strength(0.3));
      simulation.force("position-y", d3.forceY((d) => d._circleY ?? 0).strength(0.3));
      simulation.force("charge")?.strength(-30);
      simulation.alpha(0.3).restart();
      onComplete?.();
    }, 300);
    return;
  }

  if (mode === "grid") {
    // Arrange nodes in a grid, grouped by collection into rows/blocks.
    const totalNodes = nodes.length;
    if (totalNodes === 0) return;

    const cols = Math.ceil(Math.sqrt(totalNodes));
    const spacing = Math.min(width, height) / (cols + 1);
    const startX = -(cols * spacing) / 2;
    const startY = -(Math.ceil(totalNodes / cols) * spacing) / 2;

    // Build ordered list: nodes grouped by collection
    const orderedNodes = [];
    for (const coll of collections) {
      for (const node of nodes) {
        if (getCollection(node) === coll) orderedNodes.push(node);
      }
    }

    // Assign grid positions
    orderedNodes.forEach((node, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      node.fx = startX + col * spacing;
      node.fy = startY + row * spacing;
    });

    // Brief simulation to draw links, then release
    simulation.force("charge")?.strength(0);
    if (linkForce) linkForce.strength(0);
    simulation.alpha(0.1).restart();

    phaseTimeout = setTimeout(() => {
      phaseTimeout = null;
      for (const node of orderedNodes) {
        const tx = node.fx;
        const ty = node.fy;
        node._gridX = tx;
        node._gridY = ty;
        delete node.fx;
        delete node.fy;
        node.x = tx;
        node.y = ty;
      }
      simulation.force("position-x", d3.forceX((d) => d._gridX ?? 0).strength(0.5));
      simulation.force("position-y", d3.forceY((d) => d._gridY ?? 0).strength(0.5));
      simulation.force("charge")?.strength(-20);
      simulation.alpha(0.2).restart();
      onComplete?.();
    }, 300);
    return;
  }

  if (mode === "hierarchical") {
    // Tree layout using d3.tree(). Derives a spanning tree from the graph
    // by BFS from the most-connected node, then computes tree positions.
    if (nodes.length === 0) return;

    // Build adjacency list from simulation links
    const adj = {};
    const simLinks = linkForce ? linkForce.links() : [];
    for (const node of nodes) adj[node.id] = [];
    for (const link of simLinks) {
      const sid = typeof link.source === "object" ? link.source.id : link.source;
      const tid = typeof link.target === "object" ? link.target.id : link.target;
      if (adj[sid]) adj[sid].push(tid);
      if (adj[tid]) adj[tid].push(sid);
    }

    // Find root: most-connected node
    let root = nodes[0].id;
    let maxDeg = 0;
    for (const node of nodes) {
      const deg = (adj[node.id] || []).length;
      if (deg > maxDeg) {
        maxDeg = deg;
        root = node.id;
      }
    }

    // BFS to build spanning tree
    const visited = new Set([root]);
    const treeChildren = {};
    const queue = [root];
    while (queue.length > 0) {
      const current = queue.shift();
      treeChildren[current] = [];
      for (const neighbor of adj[current] || []) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          treeChildren[current].push(neighbor);
          queue.push(neighbor);
        }
      }
    }
    // Add any disconnected nodes as children of root
    for (const node of nodes) {
      if (!visited.has(node.id)) {
        visited.add(node.id);
        treeChildren[root].push(node.id);
        treeChildren[node.id] = [];
      }
    }

    // Build d3 hierarchy
    function buildHierarchy(id) {
      return {
        id,
        children: (treeChildren[id] || []).map(buildHierarchy),
      };
    }
    const hierarchyRoot = d3.hierarchy(buildHierarchy(root));
    const treeLayout = d3.tree().size([width * 0.8, height * 0.8]);
    treeLayout(hierarchyRoot);

    // Map tree positions to nodes
    const posMap = {};
    hierarchyRoot.each((d) => {
      posMap[d.data.id] = { x: d.x - width * 0.4, y: d.y - height * 0.4 };
    });

    // Set fixed positions
    for (const node of nodes) {
      const pos = posMap[node.id];
      if (pos) {
        node.fx = pos.x;
        node.fy = pos.y;
      }
    }

    // Phase 1: pin nodes via fx/fy with a brief settle so the renderer
    // picks up the new positions. Same structure as the original working
    // version, but Phase 2 keeps nodes pinned (no release, no drift).
    simulation.force("charge")?.strength(0);
    simulation.force("center")?.strength(0);
    if (linkForce) linkForce.strength(0);
    simulation.alpha(0.5).restart();

    phaseTimeout = setTimeout(() => {
      phaseTimeout = null;
      // Lock in place: zero velocities, keep fx/fy set, low alpha.
      // fx/fy makes the positions immovable regardless of any residual
      // simulation activity, so there is no drift after the snap.
      for (const node of nodes) {
        node.vx = 0;
        node.vy = 0;
      }
      simulation.alpha(0.05).restart();
      onComplete?.();
    }, 300);
    return;
  }

  // "force" mode — restore all standard forces and restart
  simulation.force("charge")?.strength(-1000);
  simulation.force("center")?.strength(1);
  if (linkForce) linkForce.strength(linkForceStrength);
  simulation.alpha(1).restart();
  onComplete?.();
}

/**
 * Returns whether a layout phase transition is currently in progress.
 */
export function isPhaseTransitionActive() {
  return phaseTimeout !== null;
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
