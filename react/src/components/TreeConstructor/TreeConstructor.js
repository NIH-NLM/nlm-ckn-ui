import * as d3 from "d3";
import React, { useEffect, useRef } from "react";
import { getColorForCollection } from "../../services/ColorServices/ColorServices";
import { getLabel, truncateString } from "../Utils/Utils";

/**
 * Tree Constructor Component.
 * A presentational component responsible for rendering a D3-based
 * collapsible tree visualization.
 *
 * @param {object} data - The hierarchical data object for the tree.
 * @param {function} onNodeEnter - Callback invoked when a new node's DOM element is created.
 * @param {function} onNodeExit - Callback invoked when a node's DOM element is about to be removed.
 */
const TreeConstructor = ({ data, onNodeEnter, onNodeExit }) => {
  // A ref to the container element where the D3 SVG will be mounted.
  const svgRef = useRef(null);

  // The main effect hook that contains all D3 logic.
  useEffect(() => {
    // Guard against running without necessary data or DOM element.
    if (!data || !svgRef.current) {
      return;
    }

    // --- D3 Setup and Configuration ---
    // Clear any previous SVG to prevent duplicates on data change.
    d3.select(svgRef.current).selectAll("*").remove();

    const width = 928;
    const marginTop = 10;
    const marginRight = 10;
    const marginBottom = 10;
    const marginLeft = 120;
    const maxLabelLength = 12;

    const root = d3.hierarchy(data);
    const dx = 10;
    const dy = (width - marginRight - marginLeft) / (1 + root.height);

    const tree = d3.tree().nodeSize([dx, dy]);
    const diagonal = d3
      .linkHorizontal()
      .x((d) => d.y)
      .y((d) => d.x);

    const svg = d3
      .select(svgRef.current)
      .append("svg")
      .attr("width", width)
      .attr("height", dx)
      .attr("viewBox", [-marginLeft, -marginTop, width, dx])
      .style("max-width", "100%")
      .style("height", "auto")
      .style("font", "10px sans-serif")
      .style("user-select", "none");

    const gLink = svg
      .append("g")
      .attr("fill", "none")
      .attr("stroke", "#555")
      .attr("stroke-opacity", 0.4)
      .attr("stroke-width", 1.5);

    const gNode = svg.append("g").attr("cursor", "pointer").attr("pointer-events", "all");

    /**
     * The core D3 update function that handles the enter, update, and exit
     * selections for nodes and links in the tree.
     */
    function update(event, source) {
      const duration = event?.altKey ? 2500 : 250;
      const nodes = root.descendants().reverse();
      const links = root.links();

      tree(root);

      let left = root;
      let right = root;
      root.eachBefore((node) => {
        if (node.x < left.x) left = node;
        if (node.x > right.x) right = node;
      });

      const height = right.x - left.x + marginTop + marginBottom;
      const transition = svg
        .transition()
        .duration(duration)
        .attr("height", height)
        .attr("viewBox", [-marginLeft, left.x - marginTop, width, height]);

      // --- Node Selection ---
      const node = gNode.selectAll("g.node-group").data(nodes, (d) => d.id);

      // Create new DOM elements for new data.
      const nodeEnter = node
        .enter()
        .append("g")
        .attr("class", "node-group")
        .attr("transform", (d) => `translate(${source.y0},${source.x0})`)
        .attr("fill-opacity", 0)
        .attr("stroke-opacity", 0)
        .on("click", (event, d) => {
          // React handles adding to graph
          if (event.target.closest(".add-to-graph-button")) {
            return;
          } else {
            // Toggle children
            d.children = d.children ? null : d._children;
            update(event, d);
          }
        });

      // Append circle
      nodeEnter
        .append("circle")
        .attr("r", 2.5)
        .attr("fill", (d) => getColorForCollection(d.data._id.split("/")[0]))
        .attr("stroke-width", 10);

      // Append text
      nodeEnter
        .append("text", "node-label-text")
        .attr("dy", "0.31em")
        .attr("x", (d) => (d._children ? -6 : 6))
        .attr("text-anchor", (d) => (d._children ? "end" : "start"))
        .text((d) => truncateString(getLabel(d.data) || d.data._key, maxLabelLength))
        .clone(true)
        .lower()
        .attr("stroke-linejoin", "round")
        .attr("stroke-width", 3)
        .attr("stroke", "white");

      // For each new node, create a foreignObject as a placeholder.
      nodeEnter
        .append("foreignObject")
        .attr("width", 16)
        .attr("height", 16)
        .attr("y", -8)
        .attr("x", (d) => {
          const gap = 15;
          // Estimate label size
          const label = truncateString(getLabel(d.data) || d.data._key, maxLabelLength);
          const textWidthEstimate = label.length * 6;
          if (d._children) {
            const textEndX = -6;
            return textEndX - textWidthEstimate - gap;
          } else {
            return textWidthEstimate + gap;
          }
        })
        .attr("pointer-events", "all")
        .each(function (d) {
          // Create a div for React to mount into.
          const placeholder = document.createElement("div");
          this.appendChild(placeholder);
          onNodeEnter(d.data._id, placeholder);
        });

      // Transition existing nodes to their new positions.
      node
        .merge(nodeEnter)
        .transition(transition)
        .attr("transform", (d) => `translate(${d.y},${d.x})`)
        .attr("fill-opacity", 1)
        .attr("stroke-opacity", 1);

      // Remove and transition out old nodes.
      node
        .exit()
        .each((d) => {
          // Notify the parent component that this node is being removed.
          onNodeExit(d.data._id);
        })
        .transition(transition)
        .remove()
        .attr("transform", (d) => `translate(${source.y},${source.x})`)
        .attr("fill-opacity", 0)
        .attr("stroke-opacity", 0);

      // --- Link Selection ---
      const link = gLink.selectAll("path").data(links, (d) => d.target.id);

      link
        .enter()
        .append("path")
        .attr("d", (d) => {
          const o = { x: source.x0, y: source.y0 };
          return diagonal({ source: o, target: o });
        })
        .merge(link)
        .transition(transition)
        .attr("d", diagonal);

      link
        .exit()
        .transition(transition)
        .remove()
        .attr("d", (d) => {
          const o = { x: source.x, y: source.y };
          return diagonal({ source: o, target: o });
        });

      root.eachBefore((d) => {
        d.x0 = d.x;
        d.y0 = d.y;
      });
    }

    // --- Initial Tree Setup ---
    root.x0 = dy / 2;
    root.y0 = 0;
    root.descendants().forEach((d, i) => {
      d.id = i;
      d._children = d.children;
      // Collapse all nodes by default on initial render.
      if (d.children) {
        d.children = null;
      }
    });

    // Start the initial render.
    update(null, root);
  }, [data, onNodeEnter, onNodeExit]);

  // Return container.
  return <div ref={svgRef} className="tree-constructor-container" />;
};

export default TreeConstructor;
