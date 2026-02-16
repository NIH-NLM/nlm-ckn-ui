/**
 * D3 rendering functions for force graph visualization.
 * Handles creating and updating SVG elements for nodes and links.
 */

import { truncateString } from "../../utils";

/**
 * Toggles donut appearance on origin nodes without recreating the graph.
 * Adds or removes the inner white circle on origin nodes.
 * @param {Object} d3 - D3 library reference
 * @param {Object} nodeContainer - D3 selection for node container
 * @param {boolean} useFocusNodes - Whether to show donuts
 * @param {Array} originNodeIds - IDs of origin nodes
 * @param {number} nodeRadius - Node radius for sizing inner circle
 */
export function toggleFocusNodeRendering(d3, nodeContainer, useFocusNodes, originNodeIds, nodeRadius) {
  const originSet = new Set(originNodeIds || []);

  nodeContainer.selectAll("g.node").each(function (d) {
    const nodeG = d3.select(this);
    const innerCircle = nodeG.select("circle.donut-inner");

    if (useFocusNodes && originSet.has(d.id)) {
      // Add inner circle if not present
      if (innerCircle.empty()) {
        // Insert before text elements so it renders under labels
        const firstText = nodeG.select("title");
        nodeG
          .insert("circle", firstText.empty() ? null : "title")
          .attr("class", "donut-inner")
          .attr("r", nodeRadius * 0.7)
          .attr("fill", "white")
          .on("contextmenu", (event, d) => {
            event.preventDefault();
          });
      }
    } else {
      // Remove inner circle if present
      if (!innerCircle.empty()) {
        innerCircle.remove();
      }
    }
  });
}

/**
 * Renders graph nodes and links using D3 data join pattern.
 * Handles enter, update, and exit selections for dynamic updates.
 * @param {Object} _simulation - D3 force simulation (unused but kept for API consistency)
 * @param {Array} nodes - Node data array
 * @param {Array} links - Link data array
 * @param {Object} d3 - D3 library reference
 * @param {Object} containers - Object with nodeContainer and linkContainer selections
 * @param {Object} options - Rendering options
 */
export function renderGraph(_simulation, nodes, links, d3, containers, options) {
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
        .attr("class", "donut-inner")
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
