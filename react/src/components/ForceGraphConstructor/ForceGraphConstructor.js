import * as d3 from "d3";
import { getColorForCollection } from "../../services/ColorServices/ColorServices";
import { truncateString } from "../Utils/Utils";

/* Pure Functions */

// Merges new nodes into existing node list.
// Filters duplicates and formats new nodes for D3 simulation.
export function processGraphData(
  existingNodes,
  newNodes,
  nodeHover,
  nodeId = (d) => d._id,
  labelFn = (d) => d.label,
) {
  // Filter out any new nodes that already exist in the graph.
  const filteredNewNodes = newNodes.filter(
    (newNode) => !existingNodes.some((existing) => existing._id === nodeId(newNode)),
  );

  // Map new nodes to required structure for rendering.
  const processedNewNodes = filteredNewNodes.map((newNode) => {
    const collection = nodeId(newNode).split("/")[0];

    return {
      ...newNode,
      id: nodeId(newNode),
      nodeHover: labelFn(newNode),
      color: getColorForCollection(collection),
      nodeLabel: labelFn(newNode),
    };
  });

  return existingNodes.concat(processedNewNodes);
}

// Integrates new links into existing link list.
// Resolves source/target objects and flags parallel links for curved rendering.
export function processGraphLinks(
  existingLinks,
  newLinks,
  nodes,
  linkSource = ({ _from }) => _from,
  linkTarget = ({ _to }) => _to,
  labelFn = (d) => d.label,
) {
  const updatedExistingLinks = [...existingLinks]; // Work on a mutable copy

  for (const newLink of newLinks) {
    const sourceNodeId = linkSource(newLink);
    const targetNodeId = linkTarget(newLink);

    // Find full node objects for source and target.
    const sourceNode = nodes.find((node) => node.id === sourceNodeId);
    const targetNode = nodes.find((node) => node.id === targetNodeId);

    // Skip link if either node is not found.
    if (!sourceNode || !targetNode) {
      return;
    }

    // Skip if link with same _id already exists.
    if (updatedExistingLinks.some((existing) => existing._id === newLink._id)) {
      return;
    }

    // Prepare new link object with resolved nodes.
    const processedNewLink = {
      ...newLink,
      sourceText: newLink.source ?? newLink.Source,
      source: sourceNode,
      target: targetNode,
      label: labelFn(newLink),
      isParallelPair: false,
    };

    // Check for a reverse link to identify a parallel pair.
    const keyParts = processedNewLink._key.split("-");
    if (keyParts.length === 2) {
      const reverseKey = `${keyParts[1]}-${keyParts[0]}`;
      const reversePartner = updatedExistingLinks.find(
        (existingLink) =>
          existingLink._key === reverseKey &&
          existingLink.source.id === targetNodeId &&
          existingLink.target.id === sourceNodeId,
      );

      // If reverse partner found, flag both links.
      if (reversePartner) {
        processedNewLink.isParallelPair = true;
        reversePartner.isParallelPair = true;
      }
    }
    updatedExistingLinks.push(processedNewLink);
  }

  return updatedExistingLinks;
}

/* Rendering Functions */

// Renders graph nodes and links using D3 data join pattern.
// Handles enter, update, and exit selections for dynamic updates.
function renderGraph(simulation, nodes, links, d3, containers, options) {
  // Handle node enter/exit/update.
  const nodeSelection = containers.nodeContainer.selectAll("g.node").data(nodes, (d) => d.id);

  // Remove nodes that are no longer present.
  nodeSelection.exit().remove();

  // Create group for each new node.
  const nodeEnter = nodeSelection.enter().append("g").attr("class", "node").call(options.drag);

  // For each new node, create visual representation.
  nodeEnter.each(function (d) {
    const nodeG = d3.select(this);
    // Render as donut if using focus nodes and node is an origin node.
    if (options.useFocusNodes && options.originNodeIds && options.originNodeIds.includes(d.id)) {
      // Outer circle.
      nodeG
        .append("circle")
        .attr("r", options.nodeRadius)
        .attr("fill", d.color)
        .on("contextmenu", (event, d) => {
          event.preventDefault();
          options.onNodeClick(event, d);
        });
      // Inner circle for donut effect.
      nodeG
        .append("circle")
        .attr("r", options.nodeRadius * 0.7)
        .attr("fill", "white")
        .on("contextmenu", (event, d) => {
          event.preventDefault();
          options.onNodeClick(event, d);
        });
    } else {
      // Render as standard circle.
      nodeG
        .append("circle")
        .attr("r", options.nodeRadius)
        .attr("fill", d.color)
        .on("contextmenu", (event, d) => {
          event.preventDefault();
          options.onNodeClick(event, d);
        });
    }
    // Append tooltip title and hidden labels.
    nodeG.append("title").text((d) => d.nodeHover);
    nodeG
      .append("text")
      .attr("class", "node-label")
      .attr("text-anchor", "middle")
      .attr("y", options.nodeRadius + options.nodeFontSize)
      .style("font-size", `${options.nodeFontSize}px`)
      .style("display", "none")
      .text((d) => truncateString(d.nodeLabel, 15));
    nodeG
      .append("text")
      .attr("class", "collection-label")
      .attr("text-anchor", "middle")
      .attr("y", -(options.nodeRadius + options.nodeFontSize))
      .style("font-size", `${options.nodeFontSize}px`)
      .style("display", "none")
      .text((d) =>
        options.collectionMaps.has(d._id.split("/")[0])
          ? options.collectionMaps.get(d._id.split("/")[0]).abbreviated_name
          : d._id.split("/")[0],
      );
  });

  // Handle link enter/exit/update.
  const linkSelection = containers.linkContainer.selectAll("g.link").data(links, (d) => d._id);

  // Remove links no longer in data.
  linkSelection.exit().remove();

  // Create group for each new link.
  const linkEnter = linkSelection.enter().append("g").attr("class", "link");

  // --- Manages links connecting two different nodes. ---
  const nonSelfLinkEnter = linkEnter.filter((d) => d.source.id !== d.target.id);

  // Append wide, invisible path for easier context menu clicking.
  nonSelfLinkEnter
    .append("path")
    .attr("class", "link-hit-area")
    .attr("fill", "none")
    .attr("stroke", "transparent")
    .attr("stroke-width", 25)
    .attr("stroke-linecap", options.linkStrokeLinecap)
    .on("contextmenu", (event, d) => {
      event.preventDefault();
      options.onNodeClick(event, d);
    });

  // Append visible path for link.
  nonSelfLinkEnter
    .append("path")
    .attr("class", "link-visible")
    .attr("fill", "none")
    .attr("stroke", typeof options.linkStroke !== "function" ? options.linkStroke : null)
    .attr("stroke-opacity", options.linkStrokeOpacity)
    .attr(
      "stroke-width",
      typeof options.linkStrokeWidth !== "function" ? options.linkStrokeWidth : null,
    )
    .attr("stroke-linecap", options.linkStrokeLinecap)
    .attr("marker-end", "url(#arrow)")
    .style("pointer-events", "none");

  // Append primary and source labels for link.
  nonSelfLinkEnter
    .append("text")
    .attr("class", "link-label")
    .text((d) => (d.name ? d.name : d.label))
    .style("font-size", `${options.linkFontSize}px`)
    .style("fill", "black")
    .style("display", "none")
    .attr("text-anchor", "middle")
    .style("pointer-events", "none");
  nonSelfLinkEnter
    .append("text")
    .attr("class", "link-source")
    .text((d) => `${d.sourceText}` || "Source Unknown")
    .style("font-size", `${options.linkFontSize}px`)
    .style("fill", "black")
    .style("display", "none")
    .attr("text-anchor", "middle")
    .attr("dy", "1.2em")
    .style("pointer-events", "none");

  // --- Manages links connecting node to itself. ---
  const selfLinkEnter = linkEnter.filter((d) => d.source.id === d.target.id);

  // Append invisible path for click handling.
  selfLinkEnter
    .append("path")
    .attr("class", "self-link-hit-area")
    .attr("fill", "none")
    .attr("stroke", "transparent")
    .attr("stroke-width", 15)
    .on("contextmenu", (event, d) => {
      event.preventDefault();
      options.onNodeClick(event, d);
    });

  // Append visible path for self-link loop.
  selfLinkEnter
    .append("path")
    .attr("class", "self-link")
    .attr("fill", "none")
    .attr("stroke", typeof options.linkStroke !== "function" ? options.linkStroke : null)
    .attr("stroke-opacity", options.linkStrokeOpacity)
    .attr(
      "stroke-width",
      typeof options.linkStrokeWidth !== "function" ? options.linkStrokeWidth : null,
    )
    .attr("stroke-linecap", options.linkStrokeLinecap)
    .attr("marker-mid", "url(#self-arrow)")
    .style("pointer-events", "none");

  // Append labels for self-link.
  selfLinkEnter
    .append("text")
    .attr("class", "link-label")
    .text((d) => (d.name ? d.name : d.label))
    .style("font-size", `${options.linkFontSize}px`)
    .style("fill", "black")
    .style("display", "none")
    .attr("text-anchor", "middle")
    .style("pointer-events", "none");
  selfLinkEnter
    .append("text")
    .attr("class", "link-source")
    .text((d) => `${d.sourceText}` || "Source Unknown")
    .style("font-size", `${options.linkFontSize}px`)
    .style("fill", "black")
    .style("display", "none")
    .attr("text-anchor", "middle")
    .attr("dy", "1.2em")
    .style("pointer-events", "none");

  // Merge new links into existing selection.
  linkSelection.merge(linkEnter);
}

/* Utility Functions */

// Returns promise that resolves when simulation 'cools down'.
// Used to wait for layout to stabilize before performing actions.
function waitForAlpha(simulation, threshold) {
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

// Starts or stops D3 simulation forces.
// Setting strengths to zero effectively freezes graph layout.
function runSimulation(
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

  // Default configuration for graph properties.
  const defaultOptions = {
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

  const mergedOptions = { ...defaultOptions, ...options };

  // Setup default drag behavior.
  mergedOptions.drag =
    options.drag ||
    d3
      .drag()
      .on("start", (event, d) => {
        if (!event.active) simulation.alphaTarget(0.1).restart();
        event.subject.fx = event.subject.x;
        event.subject.fy = event.subject.y;
        mergedOptions.interactionCallback();
      })
      .on("drag", (event, d) => {
        event.subject.fx = event.x;
        event.subject.fy = event.y;
      })
      .on("end", (event, d) => {
        if (!event.active) simulation.alphaTarget(0);
        event.subject.fx = null;
        event.subject.fy = null;
        mergedOptions.onNodeDragEnd({
          nodeId: event.subject.id,
          x: event.subject.x,
          y: event.subject.y,
        });
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

  // Create main simulation.
  const simulation = d3
    .forceSimulation()
    .force("link", forceLink)
    .force("charge", forceNode)
    .force("center", forceCenter)
    .on("tick", ticked);

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
      // Update label visibility every time zoom changes.
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
    simulation.alpha(1).restart();
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
      .attr("transform", (d, i) => `translate(0, ${i * (legendSize + legendSpacing)})`);

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
      .attr("transform", (d, i) => `translate(0, ${i * (legendSize + legendSpacing)})`);
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
      } else {
        // Use straight line for non-parallel links.
        return `M${sx},${sy}L${tx},${ty}`;
      }
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
        let midX, midY, angle;

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
    // Immediately apply the new visibility rule based on the current zoom.
    updateLabelVisibilityOnZoom(d3.zoomTransform(svg.node()).k);
  }

  // Updates font size for all node labels.
  function updateNodeFontSize(newFontSize) {
    mergedOptions.nodeFontSize = newFontSize;
    nodeContainer
      .selectAll("text.node-label, text.collection-label")
      .style("font-size", newFontSize + "px");

    // Re-evaluate label visibility since the threshold has changed.
    updateLabelVisibilityOnZoom(d3.zoomTransform(svg.node()).k);
  }

  // Updates font size for all link labels.
  function updateLinkFontSize(newFontSize) {
    mergedOptions.linkFontSize = newFontSize;
    linkContainer
      .selectAll("text.link-label", "text.link-source")
      .style("font-size", newFontSize + "px");

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
    if (resetZoom == true) {
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
    processedNodes.forEach((node) => {
      node.fx = node.x;
      node.fy = node.y;
    });

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
    processedNodes.forEach((node) => {
      node.fx = null;
      node.fy = null;
    });

    // Use the zoom-aware function to set initial label visibility.
    updateLabelVisibilityOnZoom(d3.zoomTransform(svg.node()).k);
  }

  // Identifies leaf nodes connected only to a single neighbor from collapse list.
  function findLeafNodes(collapseNodes) {
    const leafNodes = [];
    processedNodes.forEach((node) => {
      // Origin nodes cannot be leaves.
      if (mergedOptions.originNodeIds.includes(node.id)) return;
      // Filter for links connected to current node.
      const nodeLinks = processedLinks.filter(
        (l) => (l.source.id || l.source) === node.id || (l.target.id || l.target) === node.id,
      );
      if (nodeLinks.length > 0) {
        // Check if all links connect to the same neighbor.
        const firstNeighborId =
          (nodeLinks[0].source.id || nodeLinks[0].source) === node.id
            ? nodeLinks[0].target.id || nodeLinks[0].target
            : nodeLinks[0].source.id || nodeLinks[0].source;
        const allLinksToSameNeighbor = nodeLinks.every(
          (l) =>
            ((l.source.id || l.source) === node.id &&
              (l.target.id || l.target) === firstNeighborId) ||
            ((l.target.id || l.target) === node.id &&
              (l.source.id || l.source) === firstNeighborId),
        );
        // If so, and neighbor is in collapse list, mark as leaf.
        if (allLinksToSameNeighbor && collapseNodes.includes(firstNeighborId)) {
          leafNodes.push(node.id);
        }
      }
    });
    return leafNodes;
  }

  // Core function to update graph with new data.
  // Handles data processing, rendering, and simulation lifecycle.
  function updateGraph({
    newOriginNodeIds = [],
    newNodes = [],
    newLinks = [],
    collapseNodes = [],
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
      const nodesToRemove = findLeafNodes(collapseNodes);
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
    waitForAlpha(simulation, newThreshold).then(() => {
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

  // Expose public API for graph manipulation.
  return {
    updateGraph,
    restoreGraph,
    updateNodeFontSize,
    updateLinkFontSize,
    toggleLabels,
    centerOnNode,
    resize,
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
    toggleSimulation: (on, incomingLabelStates = {}) => {
      if (on) {
        // If simulation is already live, do nothing.
        if (isLiveSimulationRunning) return;
        isLiveSimulationRunning = true;

        // Store the current label states before hiding them.
        labelStatesBeforeLiveSim = { ...incomingLabelStates };

        // Hide all labels for performance by directly manipulating the DOM.
        Object.keys(labelStatesBeforeLiveSim).forEach((labelClass) => {
          const container = labelClass.includes("node") ? nodeContainer : linkContainer;
          container.selectAll(`.${labelClass}`).style("display", "none");
        });

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
