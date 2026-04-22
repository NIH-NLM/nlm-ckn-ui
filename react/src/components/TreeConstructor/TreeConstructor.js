import * as d3 from "d3";
import { useEffect, useRef } from "react";
import { getColorForCollection, getLabel, truncateString } from "../../utils";

/**
 * Tree Constructor Component.
 * A presentational component responsible for rendering a D3-based
 * collapsible tree visualization.
 *
 * @param {object} data - The hierarchical data object for the tree.
 * @param {function} onNodeEnter - Callback invoked when a new node's DOM element is created.
 * @param {function} onNodeExit - Callback invoked when a node's DOM element is about to be removed.
 * @param {function} fetchChildren - Async callback(parentId) that returns an array of child data objects.
 */
const TreeConstructor = ({ data, onNodeEnter, onNodeExit, fetchChildren }) => {
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

    const marginTop = 10;
    const marginRight = 10;
    const marginBottom = 10;
    const marginLeft = 120;
    const maxLabelLength = 24;

    const root = d3.hierarchy(data);
    const dx = 28; // Vertical spacing between nodes
    const dy = 200; // Horizontal spacing between depth levels

    const tree = d3.tree().nodeSize([dx, dy]);
    tree(root);

    // Fixed width: enough for the deepest possible chain
    const maxDepthLevels = 7;
    const rightPadding = 220;
    const width = maxDepthLevels * dy + marginLeft + marginRight + rightPadding;

    const diagonal = d3
      .linkHorizontal()
      .x((d) => d.y)
      .y((d) => d.x);

    // No viewBox — use actual pixel dimensions so the container scrolls.
    // min-width/min-height prevent the SVG from being squished by flex/grid parents.
    const svg = d3
      .select(svgRef.current)
      .append("svg")
      .attr("width", width)
      .attr("height", dx)
      .attr("class", "tree-svg")
      .style("min-width", `${width}px`)
      .style("flex-shrink", "0");

    const g = svg.append("g");

    const gLink = g
      .append("g")
      .attr("fill", "none")
      .attr("stroke", "#555")
      .attr("stroke-opacity", 0.4)
      .attr("stroke-width", 1.5);

    const gNode = g.append("g").attr("cursor", "pointer").attr("pointer-events", "all");

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

      const containerHeight = svgRef.current?.clientHeight || 500;
      const contentHeight = right.x - left.x + marginTop + marginBottom;
      const height = Math.max(contentHeight, containerHeight);
      // Center content vertically when it's smaller than the container
      const verticalPad = contentHeight < containerHeight
        ? (containerHeight - contentHeight) / 2
        : 0;
      const offsetY = -left.x + marginTop + verticalPad;

      const transition = svg
        .transition()
        .duration(duration)
        .attr("height", height)
        .style("min-height", `${height}px`);

      g.transition()
        .duration(duration)
        .attr("transform", `translate(${marginLeft}, ${offsetY})`);

      // --- Node Selection ---
      const node = gNode.selectAll("g.node-group").data(nodes, (d) => d.id);

      // Create new DOM elements for new data.
      const nodeEnter = node
        .enter()
        .append("g")
        .attr("class", "node-group")
        .attr("transform", (_d) => `translate(${source.y0},${source.x0})`)
        .attr("fill-opacity", 0)
        .attr("stroke-opacity", 0)
        .on("click", async (event, d) => {
          if (event.target.closest(".add-to-graph-button")) return;

          // If already expanded, collapse
          if (d.children) {
            d._children = d.children;
            d.children = null;
            update(event, d);
            return;
          }

          // If collapsed with cached children, expand
          if (d._children) {
            d.children = d._children;
            update(event, d);
            return;
          }

          // Lazy load: has children on server but none loaded yet
          if (d.data._hasChildren && fetchChildren) {
            try {
              const childrenData = await fetchChildren(d.data._id);
              if (!Array.isArray(childrenData) || childrenData.length === 0) return;

              // Attach fetched data and build hierarchy nodes
              d.data.children = childrenData;
              let nextId = root.descendants().length;
              for (const childData of childrenData) {
                const childNode = d3.hierarchy(childData);
                childNode.parent = d;
                childNode.depth = d.depth + 1;
                childNode.each((n) => {
                  n.id = nextId++;
                  n.depth = n.parent ? n.parent.depth + 1 : d.depth + 1;
                  n.x0 = d.x0;
                  n.y0 = d.y0;
                  // Collapse loaded grandchildren by default
                  if (n.children) {
                    n._children = n.children;
                    n.children = null;
                  }
                });
                if (!d.children) d.children = [];
                d.children.push(childNode);
              }
              d._children = d.children;
              update(event, d);
            } catch (err) {
              console.error(`Failed to fetch children for ${d.data._id}:`, err);
            }
          }
        });

      // Append circle
      nodeEnter
        .append("circle")
        .attr("class", "node-circle")
        .attr("fill", (d) => getColorForCollection(d.data._id.split("/")[0]));

      // Append text
      nodeEnter
        .append("text")
        .attr("class", "node-text")
        .attr("dy", "0.31em")
        .attr("x", (d) => (d._children ? -8 : 8))
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
        .attr("width", 24)
        .attr("height", 24)
        .attr("y", -12)
        .attr("x", (d) => {
          const gap = 8;
          // Estimate label size
          const label = truncateString(getLabel(d.data) || d.data._key, maxLabelLength);
          const textWidthEstimate = label.length * 8; // Adjusted for 12px font size
          if (d._children) {
            const textEndX = -6;
            return textEndX - textWidthEstimate - gap;
          }
          return textWidthEstimate + gap;
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
        .attr("transform", (_d) => `translate(${source.y},${source.x})`)
        .attr("fill-opacity", 0)
        .attr("stroke-opacity", 0);

      // --- Link Selection ---
      const link = gLink.selectAll("path").data(links, (d) => d.target.id);

      link
        .enter()
        .append("path")
        .attr("d", (_d) => {
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
        .attr("d", (_d) => {
          const o = { x: source.x, y: source.y };
          return diagonal({ source: o, target: o });
        });

      root.eachBefore((d) => {
        d.x0 = d.x;
        d.y0 = d.y;
      });
    }

    // --- Initial Tree Setup ---
    // Position root at the vertical center of the container
    const containerHeight = svgRef.current?.clientHeight || 500;
    root.x0 = containerHeight / 2;
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
  }, [data, onNodeEnter, onNodeExit, fetchChildren]);

  // Return container.
  return <div ref={svgRef} className="tree-constructor-container" />;
};

export default TreeConstructor;
