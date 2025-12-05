import * as d3 from "d3";
import { getColorForCollection } from "../../services/ColorServices/ColorServices";
import { getLabel } from "../../utils";

/**
 * Creates or updates a D3 Sunburst chart.
 * Initializes view based on zoomedNodeId, hiding the center node's arc/label.
 * Handles arc click zoom animation. Center click triggers React callback.
 * Includes fade-in for new elements.
 *
 * @param {object} data The hierarchical data object.
 * @param {number} size The outer diameter.
 * @param {object} handleSunburstClickRef Ref to callback for right-click.
 * @param {object} handleNodeClickRef Ref to callback for left-click on arcs (event, d3Node) -> bool.
 * @param {object} handleCenterClickRef Ref to callback for left-click on center circle/text.
 * @param {string|null} [zoomedNodeId] Optional: The ID of the node to be centered initially.
 * @returns {object} { svgNode, hierarchyRoot, d3Clicked }.
 */
function SunburstConstructor(
  data,
  size,
  handleSunburstClickRef,
  handleNodeClickRef,
  handleCenterClickRef,
  zoomedNodeId,
) {
  // --- Configuration ---
  const width = size;
  const height = width;
  const radius = width / 6;
  const zoomDuration = 750; // Duration for zoom animation
  const fadeInDelay = 0; // Delay for initial fade-in
  const fadeInDuration = 0; // Duration for initial fade-in

  // --- Basic Data Check ---
  if (!data || typeof data !== "object" || Object.keys(data).length === 0) {
    console.error("Constructor Error: Invalid or missing data received!", data);
    return { svgNode: null, hierarchyRoot: null, d3Clicked: () => {} }; // Return dummy d3Clicked
  }

  // --- D3 Setup ---
  let hierarchy;
  let root;
  let pNode = null; // pNode is the node to be initially at the center

  try {
    hierarchy = d3
      .hierarchy(data)
      .sum((d) => d.value || 1)
      .sort((a, b) => (b.value || 1) - (a.value || 1));
    root = d3.partition().size([2 * Math.PI, hierarchy.height + 1])(hierarchy);

    pNode = zoomedNodeId ? root.find((d) => d.data._id === zoomedNodeId) : null;
    if (zoomedNodeId && !pNode) {
      console.warn(
        `Constructor Warning: Could not find zoomedNodeId "${zoomedNodeId}". Falling back to root.`,
      );
    }
    const initialCenterReferenceNode = pNode || root;

    root.each((d) => {
      const ref = initialCenterReferenceNode;
      const targetX0 = Math.max(0, Math.min(1, (d.x0 - ref.x0) / (ref.x1 - ref.x0))) * 2 * Math.PI;
      const targetX1 = Math.max(0, Math.min(1, (d.x1 - ref.x0) / (ref.x1 - ref.x0))) * 2 * Math.PI;
      const targetY0 = Math.max(0, d.y0 - ref.depth);
      const targetY1 = Math.max(0, d.y1 - ref.depth);
      d.current = {
        x0: Number.isNaN(targetX0) ? 0 : targetX0,
        x1: Number.isNaN(targetX1) ? 0 : targetX1,
        y0: Number.isNaN(targetY0) ? 0 : targetY0,
        y1: Number.isNaN(targetY1) ? 0 : targetY1,
      };
    });
  } catch (error) {
    console.error("Constructor Error: Failed during D3 hierarchy/partition/position setup:", error);
    return { svgNode: null, hierarchyRoot: null, d3Clicked: () => {} };
  }

  // --- Arc Generator ---
  const arc = d3
    .arc()
    .startAngle((d) => (d.current ? d.current.x0 : 0))
    .endAngle((d) => (d.current ? d.current.x1 : 0))
    .padAngle((d) => (d.current ? Math.min((d.current.x1 - d.current.x0) / 2, 0.005) : 0))
    .padRadius(radius * 1.5)
    .innerRadius((d) => (d.current ? d.current.y0 * radius : 0))
    .outerRadius((d) =>
      d.current ? Math.max(d.current.y0 * radius, d.current.y1 * radius - 1) : 0,
    );

  // --- SVG Setup ---
  let svg;
  try {
    svg = d3
      .create("svg")
      .attr("viewBox", [-width / 2, -height / 2, width, width])
      .style("font", "12px sans-serif")
      .style("max-height", "80vh")
      .style("display", "block")
      .style("margin", "auto");
  } catch (error) {
    console.error("Constructor Error: Failed creating SVG:", error);
    return { svgNode: null, hierarchyRoot: root, d3Clicked: () => {} };
  }
  const g = svg.append("g");

  // --- Path Elements ---
  let pathUpdate;
  try {
    const pathGroup = g.append("g").attr("fill-rule", "evenodd");
    const pathData = root.descendants();
    const path = pathGroup.selectAll("path").data(pathData, (d) => d.data._id);

    path.exit().remove();

    const pathEnter = path
      .enter()
      .append("path")
      .attr("fill", (d) => {
        if (d.depth === 0 && !pNode) return "none";
        const collectionId = d.data?._id?.split("/")[0] || d.data?._key || "unknown";
        return getColorForCollection(collectionId);
      })
      .attr("fill-opacity", 0)
      .attr("pointer-events", "none")
      .style("cursor", (d) => (d.children ? "pointer" : "default"))
      .attr("d", (d) => arc(d)); // Use arc with d.current for initial state

    pathEnter.append("title").text((d) => getLabel(d.data) || d.data._key || "Unknown");

    pathUpdate = path.merge(pathEnter);

    pathUpdate
      .on("contextmenu", (event, d_node) => {
        event.preventDefault();
        if (handleSunburstClickRef.current) {
          handleSunburstClickRef.current(event, d_node);
        }
      })
      .on("click", (event, d_node) => {
        if (handleNodeClickRef.current) {
          const shouldCallD3Animation = handleNodeClickRef.current(event, d_node);
          if (shouldCallD3Animation) {
            clicked(event, d_node);
          }
        }
      });
  } catch (error) {
    console.error("Constructor Error: Failed processing Paths:", error);
    return {
      svgNode: svg ? svg.node() : null,
      hierarchyRoot: root,
      d3Clicked: () => {},
    };
  }

  // --- Label Elements ---
  let labelUpdate;
  try {
    const labelGroup = g
      .append("g")
      .attr("pointer-events", "none")
      .attr("text-anchor", "middle")
      .style("user-select", "none");

    const labelData = root.descendants();
    const label = labelGroup.selectAll("text").data(labelData, (d) => d.data._id);

    label.exit().remove();

    const labelEnter = label
      .enter()
      .append("text")
      .attr("dy", "0.35em")
      .attr("fill-opacity", 0)
      .attr("transform", (d) => labelTransform(d.current))
      .text((d) => {
        if (d.depth === 0 && !pNode) return "";
        const lbl = getLabel(d.data) || "";
        return lbl.length > 10 ? `${lbl.slice(0, 9)}...` : lbl;
      });

    labelUpdate = label.merge(labelEnter);
  } catch (error) {
    console.error("Constructor Error: Failed processing Labels:", error);
    return {
      svgNode: svg ? svg.node() : null,
      hierarchyRoot: root,
      d3Clicked: () => {},
    };
  }

  // --- Center Elements ---
  const currentVisualCenterNode = pNode || root;
  let parentCircle;
  let centerText;
  try {
    parentCircle = svg // Assign to parentCircle
      .append("circle")
      .attr("r", radius)
      .attr("fill", "none")
      .attr("pointer-events", "all")
      .style("cursor", "pointer")
      .on("click", (_event) => {
        if (handleCenterClickRef.current) {
          handleCenterClickRef.current();
        }
      });
    centerText = svg
      .append("text")
      .attr("text-anchor", "middle")
      .attr("dy", "0.35em")
      .style("font-size", "14px")
      .style("font-weight", "bold")
      .style("cursor", "pointer")
      .text(getLabel(currentVisualCenterNode.data) || "Root")
      .on("click", (_event) => {
        if (handleCenterClickRef.current) {
          handleCenterClickRef.current();
        }
      });
  } catch (error) {
    console.error("Constructor Error: Failed creating Center elements:", error);
    return {
      svgNode: svg ? svg.node() : null,
      hierarchyRoot: root,
      d3Clicked: () => {},
    };
  }

  // --- The `clicked` function ---
  function clicked(event, pClicked) {
    root.each((d_node) => {
      d_node.target = {
        x0:
          Math.max(0, Math.min(1, (d_node.x0 - pClicked.x0) / (pClicked.x1 - pClicked.x0))) *
          2 *
          Math.PI,
        x1:
          Math.max(0, Math.min(1, (d_node.x1 - pClicked.x0) / (pClicked.x1 - pClicked.x0))) *
          2 *
          Math.PI,
        y0: Math.max(0, d_node.y0 - pClicked.depth),
        y1: Math.max(0, d_node.y1 - pClicked.depth),
      };
      if (Number.isNaN(d_node.target.x0)) d_node.target.x0 = 0;
      if (Number.isNaN(d_node.target.x1)) d_node.target.x1 = 0;
    });

    const t = svg.transition().duration(event?.altKey ? 7500 : zoomDuration);

    pathUpdate
      .transition(t)
      .tween("data", (d_node) => {
        const i = d3.interpolate(d_node.current, d_node.target);
        return (time) => {
          d_node.current = i(time);
        };
      })
      .attr("fill-opacity", (d_node) =>
        d_node.data._id === pClicked.data._id
          ? 0
          : arcVisible(d_node.target)
            ? d_node.children
              ? 0.6
              : 0.4
            : 0,
      )
      .attr("pointer-events", (d_node) =>
        d_node.data._id === pClicked.data._id || !arcVisible(d_node.target) ? "none" : "auto",
      )
      .attrTween("d", (d_node) => () => arc(d_node));

    labelUpdate
      .transition(t)
      .attr("fill-opacity", (d_node) =>
        d_node.data._id === pClicked.data._id ? 0 : +labelVisible(d_node.target),
      )
      .attrTween("transform", (d_node) => () => labelTransform(d_node.current));

    centerText.transition(t).text(getLabel(pClicked.data) || pClicked.data._key || "Unknown");
    updateCursor(pClicked);
  }

  // --- Helper Functions ---
  function arcVisible(pos) {
    if (
      !pos ||
      typeof pos.y1 === "undefined" ||
      typeof pos.y0 === "undefined" ||
      typeof pos.x1 === "undefined" ||
      typeof pos.x0 === "undefined"
    )
      return false;
    return pos.y1 <= 3 && pos.y0 >= 0 && pos.x1 > pos.x0;
  }
  function labelVisible(pos) {
    if (
      !pos ||
      typeof pos.y1 === "undefined" ||
      typeof pos.y0 === "undefined" ||
      typeof pos.x1 === "undefined" ||
      typeof pos.x0 === "undefined"
    )
      return false;
    return arcVisible(pos) && (pos.y1 - pos.y0) * (pos.x1 - pos.x0) > 0.03;
  }
  function labelTransform(pos) {
    if (
      !pos ||
      typeof pos.x0 === "undefined" ||
      typeof pos.x1 === "undefined" ||
      typeof pos.y0 === "undefined" ||
      typeof pos.y1 === "undefined"
    )
      return "translate(0,0)";
    const xAngle = (((pos.x0 + pos.x1) / 2) * 180) / Math.PI;
    const yRadius = ((pos.y0 + pos.y1) / 2) * radius;
    if (Number.isNaN(xAngle) || Number.isNaN(yRadius)) return "translate(0,0)";
    return `rotate(${xAngle - 90}) translate(${yRadius},0) rotate(${xAngle < 180 ? 0 : 180})`;
  }
  function updateCursor(pCenter) {
    const cursorStyle = pCenter?.parent ? "pointer" : "default";
    if (parentCircle) parentCircle.style("cursor", cursorStyle);
    if (centerText) centerText.style("cursor", cursorStyle);
  }

  // --- Apply Initial State & Fade-In ---
  try {
    pathUpdate // Use pathUpdate which includes entered elements
      .attr("d", (d) => arc(d))
      .attr("fill-opacity", (d) => {
        if (d.data._id === zoomedNodeId || (d === root && !zoomedNodeId && d.depth === 0)) return 0;
        return arcVisible(d.current) ? (d.children ? 0.6 : 0.4) : 0;
      })
      .attr("pointer-events", (d) =>
        d.data._id === zoomedNodeId ||
        (d === root && !zoomedNodeId && d.depth === 0) ||
        !arcVisible(d.current)
          ? "none"
          : "auto",
      );

    if (fadeInDuration > 0 && pathUpdate.enter && !pathUpdate.enter().empty()) {
      pathUpdate
        .enter()
        .transition("fadein_path_explicit")
        .delay(fadeInDelay)
        .duration(fadeInDuration)
        .attr("fill-opacity", (d) => {
          if (d.data._id === zoomedNodeId || (d === root && !zoomedNodeId && d.depth === 0))
            return 0;
          return arcVisible(d.current) ? (d.children ? 0.6 : 0.4) : 0;
        })
        .attr("pointer-events", (d) =>
          d.data._id === zoomedNodeId ||
          (d === root && !zoomedNodeId && d.depth === 0) ||
          !arcVisible(d.current)
            ? "none"
            : "auto",
        );
    }

    labelUpdate
      .attr("transform", (d) => labelTransform(d.current))
      .attr("fill-opacity", (d) => {
        if (d.data._id === zoomedNodeId || (d === root && !zoomedNodeId && d.depth === 0)) return 0;
        return +labelVisible(d.current);
      });

    if (fadeInDuration > 0 && labelUpdate.enter && !labelUpdate.enter().empty()) {
      labelUpdate
        .enter()
        .transition("fadein_label_explicit")
        .delay(fadeInDelay)
        .duration(fadeInDuration)
        .attr("fill-opacity", (d) => {
          if (d.data._id === zoomedNodeId || (d === root && !zoomedNodeId && d.depth === 0))
            return 0;
          return +labelVisible(d.current);
        });
    }
    updateCursor(pNode || root);
  } catch (error) {
    console.error("Constructor Error: Failed applying final state/fade-in:", error);
  }

  // --- Return ---
  const finalSvgNode = svg ? svg.node() : null;
  if (!finalSvgNode) {
    console.error("Constructor Error: Returning null SVG node!");
  }
  return {
    svgNode: finalSvgNode,
    hierarchyRoot: root,
    d3Clicked: clicked,
  };
}

export default SunburstConstructor;
