import * as d3 from "d3";
import { getColorForCollection } from "../../utils";
import { findLeafNodes, processGraphData, processGraphLinks } from "./graphDataProcessing";
import { renderGraph, toggleFocusNodeRendering } from "./graphRendering";
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

  // Setup drag behavior. The constructor owns the handler outright — overrides
  // were removed because any external drag would bypass the activeDrags
  // bookkeeping that resize/settle suppression depends on, silently disabling
  // those guards.
  mergedOptions.drag = d3
    .drag()
    .on("start", (event, _d) => {
      if (!event.active) simulation.alphaTarget(0.1).restart();
      activeDrags += 1;
      event.subject.fx = event.subject.x;
      event.subject.fy = event.subject.y;
      mergedOptions.interactionCallback();
    })
    .on("drag", (event, _d) => {
      event.subject.fx = event.x;
      event.subject.fy = event.y;
    })
    .on("end", (event, _d) => {
      if (!event.active) simulation.alphaTarget(0);
      // Pin the node at the dropped position so it stays put while the
      // simulation continues to settle the rest of the graph. The post-rebuild
      // unpin loop in updateGraph (and restoreGraph) is the existing release
      // path — rebuilding the graph clears all pins.
      event.subject.fx = event.x;
      event.subject.fy = event.y;
      try {
        // Emit the same coords we just pinned (event.x/y), not
        // event.subject.x/y — the latter is the simulation's last-tick
        // position and can lag by a frame, so subscribers (e.g., Redux
        // updateNodePosition) would otherwise receive stale coordinates.
        mergedOptions.onNodeDragEnd({
          nodeId: event.subject.id,
          x: event.x,
          y: event.y,
        });
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
    .attr("style", "width: 100%; height: 100%;");

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

  // Setup zoom and pan behavior.
  const zoomHandler = d3
    .zoom()
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

  // Positions legend in top-left corner of SVG viewbox.
  function placeLegend(svgWidth, svgHeight) {
    legend.attr("transform", `translate(${-(svgWidth / 2) + 20}, ${-(svgHeight / 2) + 20})`);
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
        drag: mergedOptions.drag,
        originNodeIds: mergedOptions.originNodeIds,
        useFocusNodes: mergedOptions.useFocusNodes,
        collectionMaps: mergedOptions.collectionMaps,
      },
    );
    updateLegend(processedNodes);

    // Stop simulation and run one tick to draw graph in correct position.
    simulation.alpha(0);
    ticked();

    // Unfix node positions to allow interaction.
    for (const node of processedNodes) {
      node.fx = null;
      node.fy = null;
    }

    // Use the zoom-aware function to set initial label visibility.
    updateLabelVisibilityOnZoom(d3.zoomTransform(svg.node()).k);
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
    centerNodeId = null,
    resetData = false,
    save = true,
    labelStates = mergedOptions.initialLabelStates,
  } = {}) {
    if (resetData) {
      resetGraph();
    }
    // Sync internal label state with incoming state.
    currentLabelStates = { ...labelStates };

    // Update originNodeIds
    if (mergedOptions.useFocusNodes && newOriginNodeIds.length > 0) {
      mergedOptions.originNodeIds = newOriginNodeIds;
    }

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

    // Update simulation with current data.
    simulation.nodes(processedNodes);
    forceLink.links(processedLinks);

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
        drag: mergedOptions.drag,
        originNodeIds: mergedOptions.originNodeIds,
        useFocusNodes: mergedOptions.useFocusNodes,
        collectionMaps: mergedOptions.collectionMaps,
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
        updateLabelVisibilityOnZoom(d3.zoomTransform(svg.node()).k);
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

      // Perform post-simulation actions.
      if (centerNodeId) {
        centerOnNode(centerNodeId);
      }

      // Use the zoom-aware function to set final label visibility.
      updateLabelVisibilityOnZoom(d3.zoomTransform(svg.node()).k);

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
