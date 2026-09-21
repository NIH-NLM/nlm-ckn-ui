import * as d3 from "d3";
import { useEffect, useRef } from "react";
import { getColorForCollection, getLabel, pathKey, truncateString } from "../../utils";

/**
 * Tree Constructor Component.
 * A presentational component responsible for rendering a D3-based
 * collapsible tree visualization.
 *
 * The SVG chrome (the <svg>/<g> scaffold) is built exactly once, on mount,
 * and never torn down while this component stays mounted. Every later
 * change -- a new `data` root (a lazy fetch merged in more children) or a
 * new `expandedPaths` (a click) -- rebuilds the d3 hierarchy and hands it to
 * the same persistent `update()`, which reconciles it against the live DOM
 * via D3's own enter/exit selections, keyed by each node's root-to-node id
 * path (stable across rebuilds, unlike a per-mount counter). That's what
 * lets `onNodeEnter`/`onNodeExit` fire only for nodes actually
 * entering/leaving -- wiping and rebuilding the whole SVG on every change
 * (an earlier version of this component did exactly that) tears out
 * foreignObjects that still hold a mounted React portal without ever
 * calling `onNodeExit` for them, which crashes the moment React itself
 * later tries to reconcile the now-orphaned portal target.
 *
 * @param {object} data - The hierarchical data object for the tree.
 * @param {function} onNodeEnter - Callback(path, element) invoked with the node's
 *   root-to-node id path when its DOM element is created. The path -- not the
 *   bare node id -- identifies which DAG occurrence this is, since one id can
 *   be visible at more than one position at once.
 * @param {function} onNodeExit - Callback(path) invoked with the node's path when
 *   its DOM element is about to be removed.
 * @param {Array<Array<string>>} expandedPaths - Root-to-node id paths whose children should render.
 * @param {function} onToggle - Callback(path) invoked when a node is clicked.
 */
const TreeConstructor = ({ data, onNodeEnter, onNodeExit, expandedPaths, onToggle }) => {
  // A ref to the container element where the D3 SVG will be mounted.
  const svgRef = useRef(null);

  // Latest callbacks, read from inside D3 closures that outlive any single
  // render -- so reconciling doesn't need these in its dependency array.
  const onNodeEnterRef = useRef(onNodeEnter);
  const onNodeExitRef = useRef(onNodeExit);
  const onToggleRef = useRef(onToggle);
  useEffect(() => {
    onNodeEnterRef.current = onNodeEnter;
    onNodeExitRef.current = onNodeExit;
    onToggleRef.current = onToggle;
  }, [onNodeEnter, onNodeExit, onToggle]);

  // The persistent SVG chrome, built once, plus the key of the node most
  // recently clicked (used as the next transition's animation anchor).
  const chromeRef = useRef(null);
  const lastToggledKeyRef = useRef(null);

  // --- MOUNT: build the SVG chrome once. ---
  useEffect(() => {
    if (!svgRef.current) return;

    const marginTop = 10;
    const marginRight = 10;
    const marginBottom = 10;
    const marginLeft = 120;
    const dx = 28; // Vertical spacing between nodes
    const dy = 200; // Horizontal spacing between depth levels

    // Fixed width: enough for the deepest possible chain
    const maxDepthLevels = 7;
    const rightPadding = 220;
    const width = maxDepthLevels * dy + marginLeft + marginRight + rightPadding;

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

    const diagonal = d3
      .linkHorizontal()
      .x((d) => d.y)
      .y((d) => d.x);

    chromeRef.current = {
      svg,
      g,
      gLink,
      gNode,
      diagonal,
      tree: d3.tree().nodeSize([dx, dy]),
      marginTop,
      marginBottom,
      marginLeft,
    };

    return () => {
      d3.select(svgRef.current).selectAll("*").remove();
      chromeRef.current = null;
    };
  }, []);

  // --- RECONCILE: rebuild the hierarchy and patch the live SVG whenever the
  // data or the set of expanded paths changes. ---
  useEffect(() => {
    const chrome = chromeRef.current;
    if (!data || !chrome) return;

    const { svg, g, gLink, gNode, diagonal, tree, marginTop, marginBottom, marginLeft } = chrome;
    const maxLabelLength = 24;

    /**
     * Walk a hierarchy node's ancestors to build the root-to-node id path
     * that identifies this exact DAG occurrence.
     */
    function pathFor(d) {
      const path = [];
      for (let node = d; node; node = node.parent) {
        path.unshift(node.data._id);
      }
      return path;
    }
    const keyFor = (d) => pathKey(pathFor(d));

    // Build fresh from `data` every time, hiding a node's children right as
    // each node is visited (breadth-first, per d3.hierarchy.each) so hidden
    // subtrees are never even walked -- this is also what keeps
    // `root.descendants()` below limited to exactly the currently-visible
    // nodes.
    const expandedKeys = new Set((expandedPaths ?? []).map(pathKey));
    const root = d3.hierarchy(data);
    root.each((d) => {
      if (!expandedKeys.has(keyFor(d))) d.children = undefined;
    });

    function update(event, source) {
      const duration = event?.altKey ? 2500 : 250;
      const nodes = root.descendants().reverse();
      const links = root.links();

      tree(root);

      source = source ?? root;
      if (source.x0 == null) {
        source.x0 = source.x;
        source.y0 = source.y;
      }

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
      const verticalPad =
        contentHeight < containerHeight ? (containerHeight - contentHeight) / 2 : 0;
      const offsetY = -left.x + marginTop + verticalPad;

      const transition = svg
        .transition()
        .duration(duration)
        .attr("height", height)
        .style("min-height", `${height}px`);

      g.transition().duration(duration).attr("transform", `translate(${marginLeft}, ${offsetY})`);

      // --- Node Selection ---
      const node = gNode.selectAll("g.node-group").data(nodes, keyFor);

      // Create new DOM elements for new data.
      const nodeEnter = node
        .enter()
        .append("g")
        .attr("class", "node-group")
        .attr("transform", (_d) => `translate(${source.y0},${source.x0})`)
        .attr("fill-opacity", 0)
        .attr("stroke-opacity", 0)
        .on("click", (event, d) => {
          if (event.target.closest(".add-to-graph-button")) return;
          lastToggledKeyRef.current = keyFor(d);
          onToggleRef.current(pathFor(d));
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
        .attr("x", (d) => (d.data._hasChildren ? -8 : 8))
        .attr("text-anchor", (d) => (d.data._hasChildren ? "end" : "start"))
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
          if (d.data._hasChildren) {
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
          onNodeEnterRef.current(pathFor(d), placeholder);
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
          onNodeExitRef.current(pathFor(d));
        })
        .transition(transition)
        .remove()
        .attr("transform", (_d) => `translate(${source.y},${source.x})`)
        .attr("fill-opacity", 0)
        .attr("stroke-opacity", 0);

      // --- Link Selection ---
      const link = gLink.selectAll("path").data(links, (d) => keyFor(d.target));

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
    }

    const containerHeight = svgRef.current?.clientHeight || 500;
    root.x0 = containerHeight / 2;
    root.y0 = 0;

    const source = lastToggledKeyRef.current
      ? (root.descendants().find((d) => keyFor(d) === lastToggledKeyRef.current) ?? root)
      : root;

    update(null, source);
  }, [data, expandedPaths]);

  // Return container.
  return <div ref={svgRef} className="tree-constructor-container" />;
};

export default TreeConstructor;
