import * as d3 from "d3";
import { getColorForCollection, getLabel } from "../../utils";

function sumAccessor(d) {
  return d.children?.length ? 0 : (d.subtree_size ?? d.value ?? 1);
}

function buildHierarchy(data) {
  const h = d3
    .hierarchy(data)
    .sum(sumAccessor)
    .sort((a, b) => (b.value || 1) - (a.value || 1));
  // Assign a tree-position-unique key to each node. A gene (GS) can appear
  // under multiple cell types, so _id alone isn't unique in the tree.
  let idx = 0;
  h.each((d) => {
    d._uid = `${d.data._id}__${idx++}`;
  });
  return h;
}

function nodeKey(d) {
  return d._uid;
}

function SunburstConstructor(
  data,
  size,
  handleSunburstClickRef,
  handleNodeClickRef,
  handleCenterClickRef,
  zoomedNodeId,
) {
  const width = size;
  const radius = width / 6;
  const zoomDuration = 750;

  if (!data || typeof data !== "object" || Object.keys(data).length === 0) {
    return { svgNode: null, hierarchyRoot: null, d3Clicked: () => {}, update: () => {} };
  }

  // --- Mutable state shared between initial render, clicked(), and update() ---
  let root;
  let pathGroup;
  let labelGroup;
  let pathUpdate;
  let labelUpdate;
  let parentCircle;
  let centerText;

  // --- Helpers ---
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

  // --- Arc generator (reads d.current) ---
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

  // --- Initial build ---
  try {
    root = d3.partition().size([2 * Math.PI, buildHierarchy(data).height + 1])(
      buildHierarchy(data),
    );
  } catch (error) {
    console.error("Constructor Error: hierarchy/partition setup failed:", error);
    return { svgNode: null, hierarchyRoot: null, d3Clicked: () => {}, update: () => {} };
  }

  const pNode = zoomedNodeId ? root.find((d) => d.data._id === zoomedNodeId) : null;
  const initialCenter = pNode || root;

  root.each((d) => {
    const ref = initialCenter;
    const x0 = Math.max(0, Math.min(1, (d.x0 - ref.x0) / (ref.x1 - ref.x0))) * 2 * Math.PI;
    const x1 = Math.max(0, Math.min(1, (d.x1 - ref.x0) / (ref.x1 - ref.x0))) * 2 * Math.PI;
    const y0 = Math.max(0, d.y0 - ref.depth);
    const y1 = Math.max(0, d.y1 - ref.depth);
    d.current = {
      x0: Number.isNaN(x0) ? 0 : x0,
      x1: Number.isNaN(x1) ? 0 : x1,
      y0: Number.isNaN(y0) ? 0 : y0,
      y1: Number.isNaN(y1) ? 0 : y1,
    };
  });

  // --- SVG ---
  const svg = d3
    .create("svg")
    .attr("viewBox", [-width / 2, -width / 2, width, width])
    .style("font", "12px sans-serif")
    .style("max-height", "80vh")
    .style("display", "block")
    .style("margin", "auto");

  const g = svg.append("g");

  // --- Paths ---
  pathGroup = g.append("g").attr("fill-rule", "evenodd");

  function bindPaths() {
    const path = pathGroup.selectAll("path").data(root.descendants(), nodeKey);
    path.exit().remove();
    const pathEnter = path
      .enter()
      .append("path")
      .attr("fill", (d) => {
        if (d.depth === 0 && !pNode) return "none";
        return getColorForCollection(d.data?._id?.split("/")[0] || "unknown");
      })
      .attr("fill-opacity", (d) => {
        if (d.data._id === zoomedNodeId || (d === root && !zoomedNodeId && d.depth === 0)) return 0;
        return arcVisible(d.current) ? (d.children || d.data._hasChildren ? 0.6 : 0.4) : 0;
      })
      .attr("pointer-events", (d) =>
        d.data._id === zoomedNodeId ||
        (d === root && !zoomedNodeId && d.depth === 0) ||
        !arcVisible(d.current)
          ? "none"
          : "auto",
      )
      .style("cursor", (d) => (d.children || d.data._hasChildren ? "pointer" : "default"))
      .attr("d", (d) => arc(d));
    pathEnter.append("title").text((d) => getLabel(d.data) || d.data._key || "Unknown");
    pathUpdate = path.merge(pathEnter);
    pathUpdate
      .on("contextmenu", (event, d_node) => {
        event.preventDefault();
        if (handleSunburstClickRef.current) handleSunburstClickRef.current(event, d_node);
      })
      .on("click", (event, d_node) => {
        if (handleNodeClickRef.current) {
          if (handleNodeClickRef.current(event, d_node)) clicked(event, d_node);
        }
      });
  }

  // --- Labels ---
  labelGroup = g
    .append("g")
    .attr("pointer-events", "none")
    .attr("text-anchor", "middle")
    .style("user-select", "none");

  function bindLabels() {
    const label = labelGroup.selectAll("text").data(root.descendants(), nodeKey);
    label.exit().remove();
    const labelEnter = label
      .enter()
      .append("text")
      .attr("dy", "0.35em")
      .attr("fill-opacity", (d) => {
        if (d.data._id === zoomedNodeId || (d === root && !zoomedNodeId && d.depth === 0)) return 0;
        return +labelVisible(d.current);
      })
      .attr("transform", (d) => labelTransform(d.current))
      .text((d) => {
        if (d.depth === 0 && !pNode) return "";
        const lbl = getLabel(d.data) || "";
        return lbl.length > 10 ? `${lbl.slice(0, 9)}...` : lbl;
      });
    labelUpdate = label.merge(labelEnter);
  }

  // --- Center elements ---
  parentCircle = svg
    .append("circle")
    .attr("r", radius)
    .attr("fill", "white")
    .attr("pointer-events", "all")
    .style("cursor", "pointer")
    .on("click", () => {
      if (handleCenterClickRef.current) handleCenterClickRef.current();
    });

  centerText = svg
    .append("text")
    .attr("text-anchor", "middle")
    .attr("dy", "0.35em")
    .style("font-size", "14px")
    .style("font-weight", "bold")
    .style("cursor", "pointer")
    .text(getLabel(initialCenter.data) || "Root")
    .on("click", () => {
      if (handleCenterClickRef.current) handleCenterClickRef.current();
    });

  // --- Zoom animation ---
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
            ? d_node.children || d_node.data._hasChildren
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

  // --- update(newData): incremental data-join that transitions to new positions ---
  function update(newData) {
    if (!newData) return;

    // 1. Save old animation state keyed by _id.
    //    Build from DOM-bound data (not root.descendants()) so that when a
    //    node _id appears under multiple parents (e.g. same CL cell-type in
    //    several organs) we capture the *first* match — the same element D3's
    //    keyed join will reuse.  Snapshot each position to avoid holding a
    //    mutable reference from d3.interpolateObject.
    const oldMap = new Map();
    pathGroup.selectAll("path").each(function () {
      const d = d3.select(this).datum();
      if (d?._uid && d.current) {
        oldMap.set(d._uid, {
          x0: d.current.x0,
          x1: d.current.x1,
          y0: d.current.y0,
          y1: d.current.y1,
        });
      }
    });

    // 2. Rebuild hierarchy + partition from new data
    const newHierarchy = buildHierarchy(newData);
    root = d3.partition().size([2 * Math.PI, newHierarchy.height + 1])(newHierarchy);

    // 3. Compute target positions (new partition relative to root center)
    //    AND seed d.current from old state for smooth transitions
    root.each((d) => {
      // Target = natural position in the new layout
      d.target = {
        x0: d.x0,
        x1: d.x1,
        y0: d.y0,
        y1: d.y1,
      };
      // Start from old position if available, else from parent or collapsed
      const old = oldMap.get(d._uid);
      if (old) {
        d.current = old;
      } else {
        // New node: start collapsed at parent's current position
        d.current = d.parent?.current
          ? {
              x0: d.parent.current.x0,
              x1: d.parent.current.x1,
              y0: d.parent.current.y0,
              y1: d.parent.current.y0,
            }
          : { x0: 0, x1: 2 * Math.PI, y0: 0, y1: 0 };
      }
    });

    // 4. Interrupt in-flight transitions
    pathGroup.selectAll("path").interrupt();
    labelGroup.selectAll("text").interrupt();

    // 5. Data join — paths
    const pathJoin = pathGroup.selectAll("path").data(root.descendants(), nodeKey);
    pathJoin.exit().transition().duration(300).attr("fill-opacity", 0).remove();

    const pathEnter = pathJoin
      .enter()
      .append("path")
      .attr("fill", (d) => getColorForCollection(d.data?._id?.split("/")[0] || "unknown"))
      .attr("fill-opacity", 0)
      .attr("pointer-events", "none")
      .style("cursor", (d) => (d.children || d.data._hasChildren ? "pointer" : "default"))
      .attr("d", (d) => arc(d));
    pathEnter.append("title").text((d) => getLabel(d.data) || d.data._key || "Unknown");

    pathUpdate = pathJoin.merge(pathEnter);
    pathUpdate
      .on("contextmenu", (event, d_node) => {
        event.preventDefault();
        if (handleSunburstClickRef.current) handleSunburstClickRef.current(event, d_node);
      })
      .on("click", (event, d_node) => {
        if (handleNodeClickRef.current) {
          if (handleNodeClickRef.current(event, d_node)) clicked(event, d_node);
        }
      });

    // Tween from d.current → d.target (the correct new positions)
    pathUpdate
      .transition()
      .duration(400)
      .tween("data", (d_node) => {
        const i = d3.interpolate(d_node.current, d_node.target);
        return (time) => {
          d_node.current = i(time);
        };
      })
      .attr("fill-opacity", (d) => {
        if (d === root && d.depth === 0) return 0;
        return arcVisible(d.target) ? (d.children || d.data._hasChildren ? 0.6 : 0.4) : 0;
      })
      .attr("pointer-events", (d) => (arcVisible(d.target) ? "auto" : "none"))
      .attrTween("d", (d) => () => arc(d));

    // 6. Data join — labels
    const labelJoin = labelGroup.selectAll("text").data(root.descendants(), nodeKey);
    labelJoin.exit().remove();

    const labelEnter = labelJoin
      .enter()
      .append("text")
      .attr("dy", "0.35em")
      .attr("fill-opacity", 0)
      .attr("transform", (d) => labelTransform(d.current))
      .text((d) => {
        const lbl = getLabel(d.data) || "";
        return lbl.length > 10 ? `${lbl.slice(0, 9)}...` : lbl;
      });

    labelUpdate = labelJoin.merge(labelEnter);
    labelUpdate
      .transition()
      .duration(400)
      .attr("fill-opacity", (d) => {
        if (d === root && d.depth === 0) return 0;
        return +labelVisible(d.target);
      })
      .attrTween("transform", (d) => () => labelTransform(d.current));

    // Update center text
    centerText
      .transition()
      .duration(400)
      .text(getLabel(root.data) || "Root");

    return root;
  }

  // --- bloomIn: arcs grow outward from center ---
  function bloomIn(duration = 500) {
    // Save each node's correct position, keyed by tree-unique _uid
    const targets = new Map();
    root.each((d) => {
      targets.set(d._uid, {
        x0: d.current.x0,
        x1: d.current.x1,
        y0: d.current.y0,
        y1: d.current.y1,
      });
    });

    // Collapse radially (keep angular positions, zero out radius)
    root.each((d) => {
      d.current = { x0: d.current.x0, x1: d.current.x1, y0: 0, y1: 0 };
    });

    // Render collapsed + invisible
    pathUpdate
      .attr("d", (d) => arc(d))
      .attr("fill-opacity", 0)
      .attr("pointer-events", "none");
    labelUpdate.attr("fill-opacity", 0);

    // Animate to real positions
    pathUpdate
      .transition()
      .duration(duration)
      .ease(d3.easeCubicOut)
      .tween("bloom", (d_node) => {
        const target = targets.get(d_node._uid);
        if (!target) return () => {};
        const i = d3.interpolate({ ...d_node.current }, target);
        return (t) => {
          d_node.current = i(t);
        };
      })
      .attrTween("d", (d) => () => arc(d))
      .attr("fill-opacity", (d) => {
        if (d === root && d.depth === 0) return 0;
        const t = targets.get(d._uid);
        return t && arcVisible(t) ? (d.children || d.data._hasChildren ? 0.6 : 0.4) : 0;
      })
      .attr("pointer-events", (d) => {
        const t = targets.get(d._uid);
        return t && arcVisible(t) ? "auto" : "none";
      });

    labelUpdate
      .transition()
      .duration(duration)
      .delay(duration * 0.4)
      .ease(d3.easeCubicOut)
      .attr("fill-opacity", (d) => {
        if (d === root && d.depth === 0) return 0;
        const t = targets.get(d._uid);
        return t ? +labelVisible(t) : 0;
      })
      .attrTween("transform", (d) => () => labelTransform(d.current));
  }

  // Initial bindPaths / bindLabels
  bindPaths();
  bindLabels();
  updateCursor(pNode || root);

  const finalSvgNode = svg ? svg.node() : null;
  return {
    svgNode: finalSvgNode,
    hierarchyRoot: root,
    d3Clicked: clicked,
    update,
    bloomIn,
  };
}

export default SunburstConstructor;
