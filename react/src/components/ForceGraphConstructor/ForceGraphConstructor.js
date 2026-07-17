import * as d3 from "d3";
import { getColorForCollection } from "../../utils";
import {
  filterRemovedLink,
  findLeafNodes,
  processGraphData,
  processGraphLinks,
} from "./graphDataProcessing";
import { renderGraph, toggleFocusNodeRendering } from "./graphRendering";
import { attachLasso } from "./lassoSelection";
import {
  applyLayoutMode,
  DEFAULT_GRAPH_OPTIONS,
  isPhaseTransitionActive,
  runSimulation,
  waitForAlpha,
} from "./simulationUtils";

// Re-export data processing functions for backwards compatibility
export { processGraphData, processGraphLinks } from "./graphDataProcessing";

/* ForceGraphConstructor */

// Main constructor for force-directed graph.
// Initializes SVG, D3 simulation, and all related behaviors.
// Returns object with methods to interact with graph.
function ForceGraphConstructor(
  svgElement,
  { nodes: initialNodes, links: initialLinks },
  options = {},
) {
  const combinedColors = [...d3.schemePaired, ...d3.schemeDark2];
  const uniqueColors = Array.from(new Set(combinedColors));

  const mergedOptions = { ...DEFAULT_GRAPH_OPTIONS, ...options };

  // Per-drag state for group-drag mode (when the dragged node is part of the
  // current lasso selection): captures the starting position of the subject
  // and snapshots of every selected node so each frame can apply a uniform
  // delta. Lives in module scope so the handler closure can read/clear it.
  let groupDragSnapshot = null;

  // Pointer position where a single-node drag began, in simulation coordinates.
  // Used at drag-end to tell a real drag from a zero/near-zero-distance click so
  // a plain click (which now selects a node for the inspector) does not pin it.
  let singleDragStart = null;
  // Below this pointer travel (sim units) a "drag" is treated as a click.
  const DRAG_PIN_THRESHOLD = 4;

  const isGroupDragActive = (subjectId) =>
    currentSelectedNodeIds.size > 1 && currentSelectedNodeIds.has(subjectId);

  // Setup drag behavior. The constructor owns the handler outright — overrides
  // were removed because any external drag would bypass the activeDrags
  // bookkeeping that resize/settle suppression depends on, silently disabling
  // those guards.
  mergedOptions.drag = d3
    .drag()
    // Keep d3's own click-vs-drag threshold aligned with DRAG_PIN_THRESHOLD so a
    // sub-threshold movement that we treat as a click for pinning does not get
    // its native "click" (node selection) suppressed by d3.
    .clickDistance(DRAG_PIN_THRESHOLD)
    .on("start", (event, _d) => {
      activeDrags += 1;
      mergedOptions.interactionCallback();

      if (isGroupDragActive(event.subject.id)) {
        // Snapshot every selected node's current position so the drag handler
        // can apply (event.x - subject.startX, event.y - subject.startY) as
        // a uniform delta. Skip the alphaTarget reheat — pinning many nodes
        // simultaneously makes the simulation jitter visibly.
        const nodesById = new Map(simulation.nodes().map((n) => [n.id, n]));
        const snapshot = new Map();
        for (const id of currentSelectedNodeIds) {
          const node = nodesById.get(id);
          if (!node) continue;
          snapshot.set(id, { node, startX: node.x, startY: node.y });
          node.fx = node.x;
          node.fy = node.y;
          // Mark as user-set so the incremental-expand auto-release skips it.
          node.userPinned = true;
        }
        groupDragSnapshot = {
          subjectId: event.subject.id,
          subjectStartX: event.subject.x,
          subjectStartY: event.subject.y,
          nodes: snapshot,
        };
        return;
      }

      // Single-node fallback path — unchanged from the pre-lasso behavior.
      if (!event.active) simulation.alphaTarget(0.1).restart();
      singleDragStart = { x: event.x, y: event.y };
      event.subject.fx = event.subject.x;
      event.subject.fy = event.subject.y;
    })
    .on("drag", (event, _d) => {
      if (groupDragSnapshot && groupDragSnapshot.subjectId === event.subject.id) {
        const dx = event.x - groupDragSnapshot.subjectStartX;
        const dy = event.y - groupDragSnapshot.subjectStartY;
        for (const { node, startX, startY } of groupDragSnapshot.nodes.values()) {
          node.fx = startX + dx;
          node.fy = startY + dy;
          // ticked() paints from node.x/y, not fx/fy — copy through so the
          // group visibly tracks the pointer when the simulation is settled
          // (we deliberately skipped the alphaTarget reheat).
          node.x = node.fx;
          node.y = node.fy;
        }
        ticked();
        return;
      }

      // Single-node fallback path — unchanged.
      event.subject.fx = event.x;
      event.subject.fy = event.y;
    })
    .on("end", (event, _d) => {
      try {
        if (groupDragSnapshot && groupDragSnapshot.subjectId === event.subject.id) {
          const positions = [];
          for (const [id, { node }] of groupDragSnapshot.nodes.entries()) {
            // Mirror fx/fy into x/y for any final-frame correction before the
            // last paint — the drag handler already does this, but be defensive
            // in case "end" fires without a preceding "drag" (zero-distance
            // click on a selected node).
            node.x = node.fx;
            node.y = node.fy;
            // userPinned was set in the drag-start snapshot loop above; mirror
            // it onto the Redux payload so the store reflects the pin.
            positions.push({ nodeId: id, x: node.fx, y: node.fy, userPinned: true });
          }
          mergedOptions.onMultiNodeDragEnd?.(positions);
          // Drag-end mutated userPinned on each selected node but did not
          // touch the DOM — refresh the .pinned class so the pin markers
          // appear immediately. Without this, the icons only appear after a
          // later renderGraph (or a manual Pin action) re-syncs the class.
          applyPinnedHighlight();
          groupDragSnapshot = null;
          // Repaint at final positions. simulation.alpha(...) without restart()
          // won't run a tick once the simulation has cooled, so call ticked()
          // directly — this matches the explicit-render pattern used after the
          // initial settle in updateGraph.
          ticked();
          return;
        }

        if (!event.active) simulation.alphaTarget(0);
        // Distinguish a real drag from a click: a click is a zero-distance drag,
        // and d3-drag still fires start+end for it. This handler used to pin
        // unconditionally, so once left-click began selecting a node for the
        // inspector, every inspect-click also pinned. Only a drag past the
        // threshold pins now; a click leaves the node unpinned.
        const start = singleDragStart;
        singleDragStart = null;
        const moved = start
          ? Math.hypot(event.x - start.x, event.y - start.y)
          : Number.POSITIVE_INFINITY;
        if (moved < DRAG_PIN_THRESHOLD) {
          // Release the hold drag-start placed on an unpinned node so it rejoins
          // the simulation instead of sticking where it was clicked; leave an
          // already-pinned node pinned.
          if (!event.subject.userPinned) {
            event.subject.fx = null;
            event.subject.fy = null;
          }
          applyPinnedHighlight();
          return;
        }
        // Pin the node at the dropped position so it stays put while the
        // simulation continues to settle the rest of the graph. Mark as a
        // user-set pin so the incremental-expand auto-release loop in
        // updateGraph (and the post-load release in restoreGraph) leaves it
        // alone — only auto-set pins are cleared after settle.
        event.subject.fx = event.x;
        event.subject.fy = event.y;
        event.subject.userPinned = true;
        // Emit the same coords we just pinned (event.x/y), not
        // event.subject.x/y — the latter is the simulation's last-tick
        // position and can lag by a frame, so subscribers (e.g., Redux
        // updateNodePosition) would otherwise receive stale coordinates.
        mergedOptions.onNodeDragEnd({
          nodeId: event.subject.id,
          x: event.x,
          y: event.y,
          userPinned: true,
        });
        // Refresh the .pinned class so the marker appears on the just-dropped
        // node without waiting for a renderGraph rebuild.
        applyPinnedHighlight();
      } finally {
        // Decrement after the dispatch so any synchronous subscriber observes
        // isDragging() as still true during its own work. Use finally so a
        // throwing subscriber can't strand activeDrags > 0 — that would leave
        // isDragging() stuck true and silently suppress all future reheats.
        activeDrags -= 1;
      }
    });

  // Setup color scale for node groups if provided.
  if (mergedOptions.nodeGroup && mergedOptions.nodeGroups.length > 0) {
    mergedOptions.color = d3.scaleOrdinal(mergedOptions.nodeGroups, uniqueColors);
  } else {
    mergedOptions.color = () => mergedOptions.nodeColor || "#999";
  }

  // Initialize D3 forces for simulation.
  const forceNode = d3.forceManyBody().strength(mergedOptions.nodeForceStrength);
  const forceCenter = d3.forceCenter().strength(mergedOptions.centerForceStrength);
  const forceLink = d3.forceLink().id((d) => d.id);
  forceLink.distance(mergedOptions.targetLinkDistance);
  const linkForceStrength = forceLink.strength();
  const simulationGeneration = { value: 0 };
  // Initialize from caller-provided layout mode so updateGraph can start in the
  // correct mode on first render — avoids a race with the React layoutMode
  // useEffect, and avoids a visible force-mode warmup before non-force modes.
  let currentLayoutMode = mergedOptions.layoutMode || "force";

  // Counter mirrors d3's event.active: 0 when no drag in flight, > 0 while at
  // least one is active. External code (resize, settle-end callbacks) checks
  // isDragging() to skip full reheats that would override the drag's gentle
  // alphaTarget(0.1) warmup.
  let activeDrags = 0;

  // Create main simulation.
  const simulation = d3
    .forceSimulation()
    .force("link", forceLink)
    .force("charge", forceNode)
    .force("center", forceCenter)
    .on("tick", ticked);

  // Apply the user's current label visibility whenever the sim cools naturally
  // (e.g., after a drag-induced reheat). updateGraph's waitForAlpha callback
  // already does this for full rebuilds; this catches the cases that don't
  // route through there. Namespaced to coexist with other "end" handlers.
  simulation.on("end.labelRestore", () => {
    // Skip during live-simulation mode — toggleSimulation(true) explicitly
    // hides labels for the duration; the natural cooldown after alpha decay
    // would otherwise unhide them mid-session before the user toggles off.
    if (isLiveSimulationRunning) return;
    updateLabelVisibilityOnZoom(d3.zoomTransform(svg.node()).k);
  });

  // Select and configure SVG element.
  // data-sim-settled is a deterministic sentinel for Playwright: "true" means
  // the simulation has cooled and rendered positions are stable; "false" means
  // a layout pass is in flight. Tests gate assertions on
  // svg[data-sim-settled="true"] rather than fixed timeouts. Initialized true
  // because an empty graph has nothing to settle.
  const svg = d3
    .select(svgElement)
    .attr("width", mergedOptions.width)
    .attr("height", mergedOptions.height)
    .attr("viewBox", [
      -mergedOptions.width / 2,
      -mergedOptions.height / 2,
      mergedOptions.width,
      mergedOptions.height,
    ])
    .attr("style", "width: 100%; height: 100%;")
    .attr("data-sim-settled", "true");

  const g = svg.append("g");

  // Create dedicated containers for links and nodes.
  const linkContainer = g.append("g").attr("class", "link-container");
  const nodeContainer = g.append("g").attr("class", "node-container");

  // Internal state to store the user's explicit label visibility choices.
  let currentLabelStates = { ...mergedOptions.initialLabelStates };

  // Centralized function to manage label visibility based on zoom and user settings.
  function updateLabelVisibilityOnZoom(k) {
    // Invariant: while the sim is not settled, all labels are hidden.
    // Repositioning visible labels every tick destroys framerate on dense
    // graphs. Callers (zoom, toggleLabels, font-size changes, layout-phase
    // onComplete) don't need to know whether the sim is hot — this guard
    // collapses every hot-sim caller to a force-hide. Restoration happens
    // via the on("end") handler when the sim cools naturally, or via the
    // explicit post-settle calls after runSimulation(false) drains alpha.
    if (simulation.alpha() > simulation.alphaMin()) {
      nodeContainer.selectAll("text").style("display", "none");
      linkContainer.selectAll("text").style("display", "none");
      return;
    }

    // Calculate the zoom threshold needed to meet the minimum visible font size.
    const nodeLabelThreshold = mergedOptions.minVisibleFontSize / mergedOptions.nodeFontSize;
    const linkLabelThreshold = mergedOptions.minVisibleFontSize / mergedOptions.linkFontSize;

    // Helper function to apply visibility to the DOM.
    const setVisibility = (selector, container, shouldShow) => {
      container.selectAll(selector).style("display", shouldShow ? "block" : "none");
    };

    // A label is shown only if its user-toggle is on and the zoom scale is above its threshold.
    setVisibility(
      ".node-label",
      nodeContainer,
      currentLabelStates["node-label"] && k >= nodeLabelThreshold,
    );
    setVisibility(
      ".collection-label",
      nodeContainer,
      currentLabelStates["collection-label"] && k >= nodeLabelThreshold,
    );
    setVisibility(
      ".link-label",
      linkContainer,
      currentLabelStates["link-label"] && k >= linkLabelThreshold,
    );
    setVisibility(
      ".link-source",
      linkContainer,
      currentLabelStates["link-source"] && k >= linkLabelThreshold,
    );
  }

  // Lasso-mode flag — flipped via the public setLassoMode method. Used by
  // the zoom filter (to suppress pan/zoom while drawing) and by the lasso
  // attachment itself (to gate pointerdown).
  let lassoEnabled = false;

  // Refresh the .pinned class on every node group from each node's userPinned
  // field. State lives on the node objects themselves (processGraphData
  // preserves it by reference across rebuilds), so this is a pure read —
  // no auxiliary set to keep in sync. Called after public state-changing
  // operations (setNodePinned, unpinAll) and after every renderGraph.
  const applyPinnedHighlight = () => {
    nodeContainer.selectAll("g.node").classed("pinned", (d) => !!d.userPinned);
  };

  // The current set of lasso-selected node IDs. Used by renderGraph to apply
  // the .selected class on the parent <g> and by the drag handler to detect
  // group-drag mode. Updated via the public setSelectedNodeIds method.
  let currentSelectedNodeIds = new Set();
  const applySelectionHighlight = () => {
    nodeContainer.selectAll("g.node").classed("selected", (d) => currentSelectedNodeIds.has(d.id));
  };

  // Setup zoom and pan behavior.
  const zoomHandler = d3
    .zoom()
    .filter((event) => {
      // Suppress all pan/zoom gestures while the lasso tool is active.
      if (lassoEnabled) return false;
      // Otherwise preserve d3's default filter: ignore non-primary buttons
      // and ignore ctrl-modified events that aren't wheel events.
      return (!event.ctrlKey || event.type === "wheel") && !event.button;
    })
    .on("zoom", (event) => {
      g.attr("transform", event.transform);
      updateLabelVisibilityOnZoom(event.transform.k);
    })
    .on("start", mergedOptions.interactionCallback);

  // Attach the zoom handler and set the initial transform.
  svg.call(zoomHandler);
  svg.call(
    zoomHandler.transform,
    d3.zoomIdentity.translate(0, 0).scale(mergedOptions.initialScale),
  );

  // Attach the lasso pointer behavior. The polygon is drawn inside `g` so it
  // moves with the current zoom transform, and `getNodes` reads the live
  // simulation array so it always reflects the rendered graph.
  // We capture the returned `detach` so a future teardown method can remove
  // the pointer listeners and any in-flight `.lasso-path` element.
  const _detachLasso = attachLasso({
    svg,
    g,
    getNodes: () => simulation.nodes(),
    onSelectionComplete: (ids, modifiers) => {
      mergedOptions.onLassoSelection?.(ids, modifiers);
    },
    isEnabled: () => lassoEnabled,
  });

  // Define arrow markers for link directions.
  const defs = g.append("defs");
  // Standard arrow for directed links.
  defs
    .append("marker")
    .attr("id", "arrow")
    .attr("viewBox", "0 0 10 10")
    .attr("refX", 11)
    .attr("refY", 5)
    .attr("markerWidth", 20)
    .attr("markerHeight", 20)
    .attr("orient", "auto")
    .append("polygon")
    .attr("points", "0,3.5 6,5 0,6.5 1,5")
    .style(
      "fill",
      typeof mergedOptions.linkStroke !== "function" ? mergedOptions.linkStroke : null,
    );
  // Arrow for self-referencing links.
  defs
    .append("marker")
    .attr("id", "self-arrow")
    .attr("viewBox", "0 0 10 10")
    .attr("refX", 3)
    .attr("refY", 5)
    .attr("markerWidth", 20)
    .attr("markerHeight", 20)
    .attr("orient", "auto")
    .append("polygon")
    .attr("points", "0,3.5 6,5 0,6.5 1,5")
    .style(
      "fill",
      typeof mergedOptions.linkStroke !== "function" ? mergedOptions.linkStroke : null,
    );

  // Create container for legend.
  const legend = svg
    .append("g")
    .attr("class", "legend")
    .style("font-family", "sans-serif")
    .style("font-size", "10px");

  const legendSize = 12;
  const legendSpacing = 4;
  let legendItemCount = 0;

  // Positions legend in bottom-left corner of SVG viewbox.
  function placeLegend(svgWidth, svgHeight) {
    const legendHeight = legendItemCount * (legendSize + legendSpacing);
    legend.attr(
      "transform",
      `translate(${-(svgWidth / 2) + 20}, ${svgHeight / 2 - 20 - legendHeight})`,
    );
  }

  // Handles resizing of SVG container.
  // Recalculates viewbox and zoom to keep graph centered.
  function resize(newWidth, newHeight) {
    const oldWidth = mergedOptions.width;
    const oldHeight = mergedOptions.height;
    const currentTransform = d3.zoomTransform(svg.node());
    const centerPoint = currentTransform.invert([oldWidth / 2, oldHeight / 2]);

    mergedOptions.width = newWidth;
    mergedOptions.height = newHeight;

    svg
      .attr("width", newWidth)
      .attr("height", newHeight)
      .attr("viewBox", [-newWidth / 2, -newHeight / 2, newWidth, newHeight]);

    zoomHandler.extent([
      [0, 0],
      [newWidth, newHeight],
    ]);

    placeLegend(newWidth, newHeight);

    // Recalculate translation to keep view centered after resize.
    const newTranslateX = newWidth / 2 - centerPoint[0] * currentTransform.k;
    const newTranslateY = newHeight / 2 - centerPoint[1] * currentTransform.k;
    const newTransform = d3.zoomIdentity
      .translate(newTranslateX, newTranslateY)
      .scale(currentTransform.k);

    svg.call(zoomHandler.transform, newTransform);
    // Only restart simulation in force mode when no phase transition is active
    // and no drag is in flight. In clustered/radial modes the layout is already
    // settled or transitioning — restarting would disrupt it. During a drag, a
    // full alpha(1) reheat would clobber the drag handler's gentle
    // alphaTarget(0.1) warmup and visibly jolt the graph.
    if (currentLayoutMode === "force" && !isPhaseTransitionActive() && activeDrags === 0) {
      simulation.alpha(1).restart();
    }
  }

  // Updates legend based on collections present in current nodes.
  function updateLegend(currentNodes) {
    const presentCollectionIds = [...new Set(currentNodes.map((n) => n.id?.split("/")[0]))].filter(
      (id) => id && id !== "edges" && mergedOptions.collectionMaps.has(id),
    );
    presentCollectionIds.sort();

    legendItemCount = presentCollectionIds.length;
    placeLegend(mergedOptions.width, mergedOptions.height);

    const legendItems = legend.selectAll(".legend-item").data(presentCollectionIds, (d) => d);

    legendItems.exit().remove();

    const legendEnter = legendItems
      .enter()
      .append("g")
      .attr("class", "legend-item")
      .attr("transform", (_d, i) => `translate(0, ${i * (legendSize + legendSpacing)})`);

    legendEnter.append("rect").attr("x", 0).attr("width", legendSize).attr("height", legendSize);

    legendEnter
      .append("text")
      .attr("x", legendSize + 5)
      .attr("y", legendSize / 2)
      .attr("dy", "0.35em");

    // Update positions and content for all legend items.
    const legendUpdate = legendEnter.merge(legendItems);
    legendUpdate
      .transition()
      .duration(200)
      .attr("transform", (_d, i) => `translate(0, ${i * (legendSize + legendSpacing)})`);
    legendUpdate.select("rect").style("fill", (d) => getColorForCollection(d));
    legendUpdate
      .select("text")
      .text(
        (d) =>
          `${mergedOptions.collectionMaps.get(d)?.display_name} (${mergedOptions.collectionMaps.get(d)?.abbreviated_name})` ||
          d,
      );
  }

  // Internal data storage for nodes and links.
  let processedNodes = [];
  let processedLinks = [];
  // Internal state to track if the simulation is in 'live' mode.
  let isLiveSimulationRunning = false;
  // Internal state to store label visibility before starting 'live' mode.
  let labelStatesBeforeLiveSim = null;

  // Initial render on construction.
  updateGraph({
    newNodes: initialNodes,
    newLinks: initialLinks,
    save: mergedOptions.saveInitial,
  });

  // Callback function for each simulation 'tick'.
  // Updates positions of all nodes and links on screen.
  function ticked() {
    const linkElements = linkContainer.selectAll("g.link");

    // Calculate path for self-looping links.
    linkElements.selectAll("path.self-link").attr("d", (d) => {
      if (!d.source) return "";
      const x = d.source.x;
      const y = d.source.y;
      const nodeR = mergedOptions.nodeRadius;
      const loopRadius = nodeR * 1.5;
      const dr = loopRadius * 2;
      return `M${x},${y + nodeR} A${dr / 2},${dr / 2} 0 1,0 ${x + 0.1},${y + nodeR - 0.1}`;
    });

    // Calculate path for standard (non-self) links.
    linkElements.selectAll("path:not(.self-link)").attr("d", (d) => {
      if (!d.source || !d.target) return "";
      const sx = d.source.x;
      const sy = d.source.y;
      const tx = d.target.x;
      const ty = d.target.y;

      // Use curved arc for parallel links.
      if (d.isParallelPair) {
        const dx = tx - sx;
        const dy = ty - sy;
        const dr = Math.sqrt(dx * dx + dy * dy) * (1 / mergedOptions.parallelLinkCurvature);
        return `M${sx},${sy}A${dr},${dr} 0 0,1 ${tx},${ty}`;
      }
      // Use straight line for non-parallel links.
      return `M${sx},${sy}L${tx},${ty}`;
    });

    // Apply new positions to all node groups.
    nodeContainer.selectAll("g.node").attr("transform", (d) => `translate(${d.x},${d.y})`);

    // Update positions and rotation for all link labels.
    linkElements.each(function (d) {
      if (!d.source || !d.target) return;

      let transformString = "";

      if (d.source.id === d.target.id) {
        // Position self-link text below loop.
        const x = d.source.x;
        const y = d.source.y;
        const nodeR = mergedOptions.nodeRadius;
        const loopRadius = nodeR * 1.5;
        transformString = `translate(${x}, ${y + nodeR + loopRadius + mergedOptions.linkFontSize * 0.5 + 5})`;
      } else {
        // Position non-self-link text along link path.
        const sx = d.source.x;
        const sy = d.source.y;
        const tx = d.target.x;
        const ty = d.target.y;
        let midX;
        let midY;
        let angle;

        if (d.isParallelPair) {
          // Calculate midpoint of curved arc.
          const mx = (sx + tx) / 2;
          const my = (sy + ty) / 2;
          const dx = tx - sx;
          const dy = ty - sy;
          angle = Math.atan2(dy, dx) * (180 / Math.PI);
          const dist = Math.sqrt(dx * dx + dy * dy);
          const curvatureOffset = dist * mergedOptions.parallelLinkCurvature * 0.3;
          const normX = dy / dist;
          const normY = -dx / dist;
          midX = mx + curvatureOffset * normX;
          midY = my + curvatureOffset * normY;
        } else {
          // Calculate midpoint of straight line.
          midX = (sx + tx) / 2;
          midY = (sy + ty) / 2;
          angle = Math.atan2(ty - sy, tx - sx) * (180 / Math.PI);
        }

        // Keep text upright.
        if (Math.abs(angle) > 90) {
          angle += 180;
        }

        const textVerticalOffset = 0;
        const offsetX = textVerticalOffset * Math.sin((angle * Math.PI) / 180);
        const offsetY = textVerticalOffset * -Math.cos((angle * Math.PI) / 180);
        transformString = `translate(${midX + offsetX}, ${midY + offsetY}) rotate(${angle})`;
      }
      d3.select(this).selectAll("text").attr("transform", transformString);
    });
  }

  // Pans and zooms view to center on specific node.
  function centerOnNode(nodeId, transitionDuration = 1000) {
    const node = simulation.nodes().find((node) => node._id === nodeId);
    if (!node) {
      console.warn("Node not found for centering:", nodeId);
      return;
    }
    const currentTransform = d3.zoomTransform(svg.node());
    const k = currentTransform.k;
    const newTransform = d3.zoomIdentity.translate(-node.x * k, -node.y * k).scale(k);
    svg.transition().duration(transitionDuration).call(zoomHandler.transform, newTransform);
  }

  // Public function for React to set the user's preference for label visibility.
  function toggleLabels(show, labelClass) {
    if (typeof currentLabelStates[labelClass] !== "undefined") {
      currentLabelStates[labelClass] = show;
    }
    // updateLabelVisibilityOnZoom enforces the alpha-settled invariant.
    updateLabelVisibilityOnZoom(d3.zoomTransform(svg.node()).k);
  }

  // Updates font size for all node labels.
  function updateNodeFontSize(newFontSize) {
    mergedOptions.nodeFontSize = newFontSize;
    nodeContainer
      .selectAll("text.node-label, text.collection-label")
      .style("font-size", `${newFontSize}px`);

    // Re-evaluate label visibility since the threshold has changed.
    updateLabelVisibilityOnZoom(d3.zoomTransform(svg.node()).k);
  }

  // Updates font size for all link labels.
  function updateLinkFontSize(newFontSize) {
    mergedOptions.linkFontSize = newFontSize;
    linkContainer
      .selectAll("text.link-label", "text.link-source")
      .style("font-size", `${newFontSize}px`);

    // Re-evaluate label visibility since the threshold has changed.
    updateLabelVisibilityOnZoom(d3.zoomTransform(svg.node()).k);
  }

  // Clears all nodes and links from graph.
  function resetGraph(resetZoom = true) {
    simulation.stop();
    processedNodes = [];
    processedLinks = [];
    simulation.nodes([]);
    simulation.force("link").links([]);
    nodeContainer.selectAll("*").remove();
    linkContainer.selectAll("*").remove();
    if (resetZoom === true) {
      svg.call(zoomHandler.transform, d3.zoomIdentity);
    }
  }

  // Rebuilds graph from a saved state object.
  // Fixes node positions initially to prevent simulation drift on restore.
  function restoreGraph({ nodes, links, labelStates }) {
    svg.attr("data-sim-settled", "false");
    // Invalidate any in-flight waitForAlpha promises from prior updateGraph
    // calls — without this, a callback resolving after restoreGraph would
    // call onSimulationEnd with stale `processedNodes` and dispatch
    // setGraphData, overwriting the just-restored Redux state.
    simulationGeneration.value++;
    resetGraph(false);
    // Sync internal label state with restored state.
    currentLabelStates = { ...labelStates };

    processedNodes = processGraphData(
      processedNodes,
      nodes,
      mergedOptions.nodeId,
      mergedOptions.label,
      mergedOptions.nodeHover,
    );
    processedLinks = processGraphLinks(
      processedLinks,
      links,
      processedNodes,
      mergedOptions.linkSource,
      mergedOptions.linkTarget,
      mergedOptions.label,
    );

    // Fix nodes to their saved positions.
    for (const node of processedNodes) {
      node.fx = node.x;
      node.fy = node.y;
    }

    simulation.nodes(processedNodes);
    forceLink.links(processedLinks);

    renderGraph(
      simulation,
      processedNodes,
      processedLinks,
      d3,
      { nodeContainer, linkContainer },
      {
        forceLink,
        nodeRadius: mergedOptions.nodeRadius,
        nodeFontSize: mergedOptions.nodeFontSize,
        linkStroke: mergedOptions.linkStroke,
        linkStrokeOpacity: mergedOptions.linkStrokeOpacity,
        linkStrokeWidth: mergedOptions.linkStrokeWidth,
        linkStrokeLinecap: mergedOptions.linkStrokeLinecap,
        linkFontSize: mergedOptions.linkFontSize,
        onNodeClick: mergedOptions.onNodeClick,
        onNodeLeftClick: mergedOptions.onNodeLeftClick,
        onNodeDoubleClick: mergedOptions.onNodeDoubleClick,
        drag: mergedOptions.drag,
        originNodeIds: mergedOptions.originNodeIds,
        useFocusNodes: mergedOptions.useFocusNodes,
        collectionMaps: mergedOptions.collectionMaps,
        selectedNodeIds: currentSelectedNodeIds,
      },
    );
    updateLegend(processedNodes);

    // Stop simulation and run one tick to draw graph in correct position.
    simulation.alpha(0);
    ticked();

    // Unfix node positions to allow interaction — except for nodes the user
    // explicitly pinned before saving. Honoring userPinned here is what makes
    // pin state survive save/load: getCurrentGraph spreads ...rest so
    // userPinned/fx/fy ride along in the saved payload; loadGraph assigns
    // graphData verbatim; renderGraph's merged classed("pinned", ...) makes
    // the marker reappear automatically.
    for (const node of processedNodes) {
      if (node.userPinned) continue;
      node.fx = null;
      node.fy = null;
    }

    // Use the zoom-aware function to set initial label visibility.
    updateLabelVisibilityOnZoom(d3.zoomTransform(svg.node()).k);

    // Restore is a single-tick draw, so positions are stable immediately.
    svg.attr("data-sim-settled", "true");
  }

  // Restore force strengths and apply the current layout mode.
  // Shared between updateGraph (initial render) and setLayoutMode (manual switch).
  function applyCurrentLayoutMode(onComplete) {
    forceNode.strength(mergedOptions.nodeForceStrength);
    forceCenter.strength(mergedOptions.centerForceStrength);
    forceLink.strength(linkForceStrength);
    forceLink.links(processedLinks);
    applyLayoutMode(
      d3,
      simulation,
      currentLayoutMode,
      mergedOptions.width,
      mergedOptions.height,
      linkForceStrength,
      onComplete,
      simulationGeneration,
    );
  }

  // Core function to update graph with new data.
  // Handles data processing, rendering, and simulation lifecycle.
  function updateGraph({
    newOriginNodeIds = [],
    newNodes = [],
    newLinks = [],
    collapseNodes = [],
    collapseMode = "standard",
    removeNode = false,
    removeLink = null,
    centerNodeId = null,
    resetData = false,
    save = true,
    labelStates = mergedOptions.initialLabelStates,
  } = {}) {
    // Mark the sim as unsettled for the duration of this rebuild — tests gate
    // on this attribute to avoid racing the alpha cooldown.
    svg.attr("data-sim-settled", "false");
    if (resetData) {
      resetGraph();
    }
    // Sync internal label state with incoming state.
    currentLabelStates = { ...labelStates };

    // Update originNodeIds
    if (mergedOptions.useFocusNodes && newOriginNodeIds.length > 0) {
      mergedOptions.originNodeIds = newOriginNodeIds;
    }

    // Snapshot the IDs of nodes that exist BEFORE the merge. Used after the
    // merge to auto-pin pre-existing nodes during the post-expand reheat so
    // the existing layout stays put while only the new nodes flow in
    // ("preserve mental map" / incremental layout). Released after settle.
    const prevNodeIds = new Set(processedNodes.map((n) => n.id));

    // Process and merge new data into internal state.
    processedNodes = processGraphData(
      processedNodes,
      newNodes,
      mergedOptions.nodeId,
      mergedOptions.label,
      mergedOptions.nodeHover,
    );
    processedLinks = processGraphLinks(
      processedLinks,
      newLinks,
      processedNodes,
      mergedOptions.linkSource,
      mergedOptions.linkTarget,
      mergedOptions.label,
    );

    // Handle node collapsing/removal logic.
    if (collapseNodes.length > 0) {
      const nodesToRemove = findLeafNodes(
        processedNodes,
        processedLinks,
        collapseNodes,
        mergedOptions.originNodeIds,
        collapseMode,
      );
      processedNodes = processedNodes.filter((n) => !nodesToRemove.includes(n.id));
      processedLinks = processedLinks.filter(
        (l) => !nodesToRemove.includes(l.source.id) && !nodesToRemove.includes(l.target.id),
      );
      if (removeNode) {
        processedNodes = processedNodes.filter((n) => !collapseNodes.includes(n.id));
        processedLinks = processedLinks.filter(
          (l) => !collapseNodes.includes(l.source.id) && !collapseNodes.includes(l.target.id),
        );
      }
    }

    // Remove a single link by _id without touching its endpoint nodes.
    processedLinks = filterRemovedLink(processedLinks, removeLink);

    // Update simulation with current data.
    simulation.nodes(processedNodes);
    forceLink.links(processedLinks);

    // Auto-pin pre-existing nodes before the simulation reheats so their
    // positions stay put during the new-node settle. Skip nodes the user has
    // explicitly pinned (drag-end, Pin action) — those carry their own fx/fy
    // and userPinned=true; we leave them alone. Mark our own auto-pins with
    // _autoPinned so the post-settle release loop only touches what we set.
    // Skipped entirely on resetData (no pre-existing nodes to preserve).
    if (!resetData) {
      for (const node of processedNodes) {
        if (!prevNodeIds.has(node.id)) continue;
        if (node.userPinned) continue;
        if (node.fx != null || node.fy != null) continue;
        node.fx = node.x;
        node.fy = node.y;
        node._autoPinned = true;
      }
    }

    // Re-render DOM with updated data.
    renderGraph(
      simulation,
      processedNodes,
      processedLinks,
      d3,
      { nodeContainer, linkContainer },
      {
        forceLink,
        nodeRadius: mergedOptions.nodeRadius,
        nodeFontSize: mergedOptions.nodeFontSize,
        linkStroke: mergedOptions.linkStroke,
        linkStrokeOpacity: mergedOptions.linkStrokeOpacity,
        linkStrokeWidth: mergedOptions.linkStrokeWidth,
        linkStrokeLinecap: mergedOptions.linkStrokeLinecap,
        linkFontSize: mergedOptions.linkFontSize,
        onNodeClick: mergedOptions.onNodeClick,
        onNodeLeftClick: mergedOptions.onNodeLeftClick,
        onNodeDoubleClick: mergedOptions.onNodeDoubleClick,
        drag: mergedOptions.drag,
        originNodeIds: mergedOptions.originNodeIds,
        useFocusNodes: mergedOptions.useFocusNodes,
        collectionMaps: mergedOptions.collectionMaps,
        selectedNodeIds: currentSelectedNodeIds,
      },
    );
    updateLegend(processedNodes);

    // Hide labels during simulation for performance (alpha check in
    // updateLabelVisibilityOnZoom will keep them hidden while sim is hot)
    nodeContainer.selectAll("text").style("display", "none");
    linkContainer.selectAll("text").style("display", "none");

    // Non-force layout modes manage their own simulation lifecycle via
    // applyLayoutMode's internal phase transitions — start directly in the
    // target mode rather than running a visible force-mode warmup first.
    if (currentLayoutMode && currentLayoutMode !== "force") {
      isLiveSimulationRunning = false;
      applyCurrentLayoutMode(() => {
        // Release auto-pins set above so subsequent interactions (drag,
        // simulation toggle) can move pre-existing nodes again. User-pinned
        // nodes are untouched.
        for (const node of processedNodes) {
          if (node._autoPinned) {
            node.fx = null;
            node.fy = null;
            delete node._autoPinned;
          }
        }
        updateLabelVisibilityOnZoom(d3.zoomTransform(svg.node()).k);
        svg.attr("data-sim-settled", "true");
        if (save === true && typeof mergedOptions.onSimulationEnd === "function") {
          const finalNodes = processedNodes.map(({ x, y, index, vx, vy, ...rest }) => ({
            x,
            y,
            ...rest,
          }));
          const finalLinks = processedLinks.map(({ source, target, ...rest }) => ({
            ...rest,
            source: source.id || source,
            target: target.id || target,
          }));
          mergedOptions.onSimulationEnd(finalNodes, finalLinks);
        }
      });
      return;
    }

    // Start simulation to arrange new elements.
    runSimulation(
      true,
      simulation,
      forceNode,
      forceCenter,
      forceLink,
      processedLinks,
      mergedOptions.nodeForceStrength,
      mergedOptions.centerForceStrength,
      linkForceStrength,
    );

    // Wait for graph layout to stabilize.
    const newThreshold = Math.max(1 / (processedNodes.length || 1), 0.002);
    waitForAlpha(simulation, newThreshold, simulationGeneration).then((stillValid) => {
      if (!stillValid) return;
      // Freeze graph once stable.
      runSimulation(false, simulation, forceNode, forceCenter, forceLink);
      // Ensure the live simulation flag is reset after auto-stabilization.
      isLiveSimulationRunning = false;

      // Release the auto-pins we set before the reheat. Leave user-pinned
      // nodes' fx/fy intact so an explicit Pin (or drag-end pin) survives.
      // runSimulation(false) already drained alpha to 0; no further tick is
      // needed — the rendered positions are the visible ones.
      for (const node of processedNodes) {
        if (node._autoPinned) {
          node.fx = null;
          node.fy = null;
          delete node._autoPinned;
        }
      }

      // Perform post-simulation actions.
      if (centerNodeId) {
        centerOnNode(centerNodeId);
      }

      // Use the zoom-aware function to set final label visibility.
      updateLabelVisibilityOnZoom(d3.zoomTransform(svg.node()).k);

      // Signal to tests that the rendered positions are now stable.
      svg.attr("data-sim-settled", "true");

      // Save final state if required.
      if (save === true && typeof mergedOptions.onSimulationEnd === "function") {
        const finalNodes = processedNodes.map(({ x, y, index, vx, vy, ...rest }) => ({
          x,
          y,
          ...rest,
        }));
        const finalLinks = processedLinks.map(({ source, target, ...rest }) => ({
          ...rest,
          source: source.id || source,
          target: target.id || target,
        }));
        mergedOptions.onSimulationEnd(finalNodes, finalLinks);
      }
    });
  }

  // Toggles donut rendering on origin nodes without recreating graph.
  function toggleFocusNodes(useFocusNodes) {
    mergedOptions.useFocusNodes = useFocusNodes;
    toggleFocusNodeRendering(
      d3,
      nodeContainer,
      useFocusNodes,
      mergedOptions.originNodeIds,
      mergedOptions.nodeRadius,
    );
  }

  // Expose public API for graph manipulation.
  return {
    updateGraph,
    restoreGraph,
    updateNodeFontSize,
    updateLinkFontSize,
    toggleLabels,
    toggleFocusNodes,
    centerOnNode,
    resize,
    isDragging: () => activeDrags > 0,
    // Toggles lasso-selection mode. While enabled, pan/zoom is suppressed
    // and pointer drags inside the SVG draw a freeform selection polygon.
    setLassoMode: (enabled) => {
      lassoEnabled = !!enabled;
      svg.style("cursor", lassoEnabled ? "crosshair" : null);
    },
    // Updates the set of lasso-selected node IDs and applies the visual
    // highlight to the rendered nodes. Cheap — does not trigger a full
    // renderGraph.
    setSelectedNodeIds: (ids) => {
      currentSelectedNodeIds = new Set(ids || []);
      applySelectionHighlight();
    },
    // Reads the current selection. Returns a copy so callers can't mutate
    // the internal Set used by the drag handler and applySelectionHighlight.
    getSelectedNodeIds: () => new Set(currentSelectedNodeIds),
    // Sets or clears a user-pin on a node by id. When pinned, the node's
    // current x/y become fx/fy and userPinned=true, so the incremental-expand
    // auto-release skips it. When unpinned, fx/fy are cleared and the node
    // re-joins the live simulation. Refreshes the visible pin marker.
    setNodePinned: (nodeId, pinned) => {
      const node = simulation.nodes().find((n) => n.id === nodeId);
      if (!node) return;
      if (pinned) {
        node.fx = node.x;
        node.fy = node.y;
        node.userPinned = true;
      } else {
        node.fx = null;
        node.fy = null;
        node.userPinned = false;
        delete node._autoPinned;
      }
      applyPinnedHighlight();
    },
    // Clears every user-pin and reheats the simulation so the layout relaxes
    // from its current positions. Used by the "Reset positions" settings
    // button — analogous to Restart Simulation but also releases pin state.
    // The existing waitForAlpha callback handles the re-cool + the
    // data-sim-settled sentinel flip.
    unpinAll: () => {
      for (const node of simulation.nodes()) {
        node.fx = null;
        node.fy = null;
        node.userPinned = false;
        delete node._autoPinned;
      }
      applyPinnedHighlight();
      svg.attr("data-sim-settled", "false");
      runSimulation(
        true,
        simulation,
        forceNode,
        forceCenter,
        forceLink,
        processedLinks,
        mergedOptions.nodeForceStrength,
        mergedOptions.centerForceStrength,
        linkForceStrength,
      );
      const threshold = Math.max(1 / (processedNodes.length || 1), 0.002);
      waitForAlpha(simulation, threshold, simulationGeneration).then((stillValid) => {
        if (!stillValid) return;
        runSimulation(false, simulation, forceNode, forceCenter, forceLink);
        updateLabelVisibilityOnZoom(d3.zoomTransform(svg.node()).k);
        svg.attr("data-sim-settled", "true");
      });
    },
    // Returns the current node/link state suitable for saving.
    getCurrentGraph: () => {
      const finalNodes = processedNodes.map(({ x, y, index, vx, vy, ...rest }) => ({
        x,
        y,
        ...rest,
      }));
      const finalLinks = processedLinks.map(({ source, target, ...rest }) => ({
        ...rest,
        source: source.id || source,
        target: target.id || target,
      }));
      return { nodes: finalNodes, links: finalLinks };
    },
    setLayoutMode: (mode, labelStates = {}) => {
      currentLayoutMode = mode;
      // Invalidate any pending waitForAlpha promises
      simulationGeneration.value++;

      // Hide all labels during layout transitions for performance
      if (mode !== "force") {
        nodeContainer.selectAll("text").style("display", "none");
        linkContainer.selectAll("text").style("display", "none");
      }

      // Apply layout-specific forces (this also adjusts charge and restarts)
      applyCurrentLayoutMode(() => {
        updateLabelVisibilityOnZoom(d3.zoomTransform(svg.node()).k);
      });
    },
    toggleSimulation: (on, incomingLabelStates = {}) => {
      if (on) {
        // If simulation is already live, do nothing.
        if (isLiveSimulationRunning) return;
        isLiveSimulationRunning = true;

        // Store the current label states before hiding them.
        labelStatesBeforeLiveSim = { ...incomingLabelStates };

        // Hide all labels for performance by directly manipulating the DOM.
        for (const labelClass of Object.keys(labelStatesBeforeLiveSim)) {
          const container = labelClass.includes("node") ? nodeContainer : linkContainer;
          container.selectAll(`.${labelClass}`).style("display", "none");
        }

        // Start the simulation.
        runSimulation(
          true,
          simulation,
          forceNode,
          forceCenter,
          forceLink,
          processedLinks,
          mergedOptions.nodeForceStrength,
          mergedOptions.centerForceStrength,
          linkForceStrength,
        );
      } else {
        // Stop the simulation.
        isLiveSimulationRunning = false;
        runSimulation(
          false,
          simulation,
          forceNode,
          forceCenter,
          forceLink,
          processedLinks,
          mergedOptions.nodeForceStrength,
          mergedOptions.centerForceStrength,
          linkForceStrength,
        );

        // Restore the labels to their previous state if a state was saved.
        if (labelStatesBeforeLiveSim) {
          // Update the main state tracker to what it was before the sim.
          currentLabelStates = { ...labelStatesBeforeLiveSim };
          // Clear the temporary saved state.
          labelStatesBeforeLiveSim = null;
        }

        // After stopping, immediately apply zoom-based visibility rules.
        updateLabelVisibilityOnZoom(d3.zoomTransform(svg.node()).k);
      }
    },
  };
}

export default ForceGraphConstructor;
