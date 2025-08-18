import React, { useEffect, useRef } from "react";
import * as d3 from "d3";
import { useDispatch, useSelector } from "react-redux";
import { getLabel, truncateString } from "../Utils/Utils";
import { getColorForCollection } from "../../services/ColorServices/ColorServices";
import { toggleCartItem } from "../../store/cartSlice";

const TreeConstructor = ({ data }) => {
  const svgRef = useRef(null);
  const dispatch = useDispatch();
  const cartNodeIds = useSelector((state) => state.cart.originNodeIds);

  // Main effect for building and structuring the tree
  useEffect(() => {
    if (!data || !svgRef.current) {
      return;
    }

    d3.select(svgRef.current).selectAll("*").remove();

    const width = 928;
    const marginTop = 10;
    const marginRight = 10;
    const marginBottom = 10;
    const marginLeft = 120;

    const root = d3.hierarchy(data);
    const dx = 10;
    const dy = (width - marginRight - marginLeft) / (1 + root.height);

    const maxLabelLength = 12;

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
      .attr(
        "style",
        "max-width: 100%; height: auto; font: 10px sans-serif; user-select: none;",
      );

    const gLink = svg
      .append("g")
      .attr("class", "link-group")
      .attr("fill", "none")
      .attr("stroke", "#555")
      .attr("stroke-opacity", 0.4)
      .attr("stroke-width", 1.5);

    const gNode = svg
      .append("g")
      .attr("class", "node-container-group")
      .attr("cursor", "pointer")
      .attr("pointer-events", "all");

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
        .attr("viewBox", [-marginLeft, left.x - marginTop, width, height])
        .tween(
          "resize",
          window.ResizeObserver ? null : () => () => svg.dispatch("toggle"),
        );

      const node = gNode.selectAll("g.node-group").data(nodes, (d) => d.id);

      const nodeEnter = node
        .enter()
        .append("g")
        .attr("class", "node-group")
        .attr("transform", (d) => `translate(${source.y0},${source.x0})`)
        .attr("fill-opacity", 0)
        .attr("stroke-opacity", 0)
        .on("click", (event, d) => {
          if (event.target.tagName !== "BUTTON") {
            d.children = d.children ? null : d._children;
            update(event, d);
          }
        });

      nodeEnter
        .append("circle")
        .attr("r", 2.5)
        .attr("fill", (d) => {
          const collectionName = d.data._id.split("/")[0];
          return getColorForCollection(collectionName);
        })
        .attr("stroke-width", 10);

      nodeEnter
        .append("text")
        .attr("dy", "0.31em")
        .attr("x", (d) => (d._children ? -6 : 6))
        .attr("text-anchor", (d) => (d._children ? "end" : "start"))
        .text((d) => truncateString(getLabel(d.data) || d.data._key, maxLabelLength))
        .attr("stroke-linejoin", "round")
        .attr("stroke-width", 3)
        .attr("stroke", "white")
        .attr("paint-order", "stroke")
        .append("title")
        .text((d) => getLabel(d.data) || d.data._key || "Unknown");

      const fo = nodeEnter
        .append("foreignObject")
        .attr("class", "cart-button-fo")
        .attr("width", 90)
        .attr("height", 20)
        .attr("y", -10)
        .attr("x", (d) => {
          const textAnchorOffset = 10;
          const textWidthEstimate = maxLabelLength * 6;
          return d._children
            ? -textAnchorOffset - textWidthEstimate - 90
            : textAnchorOffset;
        });

      fo.append("xhtml:button")
        .style("width", "85px")
        .style("height", "18px")
        .style("font-size", "10px")
        .style("cursor", "pointer")
        .text((d) =>
          cartNodeIds.includes(d.data._id) ? "Remove" : "Add to Cart",
        )
        .on("click", (event, d) => {
          event.stopPropagation();
          dispatch(toggleCartItem(d.data._id));
        });

      const nodeUpdate = node.merge(nodeEnter);
      nodeUpdate
        .transition(transition)
        .attr("transform", (d) => `translate(${d.y},${d.x})`)
        .attr("fill-opacity", 1)
        .attr("stroke-opacity", 1);

      node
        .exit()
        .transition(transition)
        .remove()
        .attr("transform", (d) => `translate(${source.y},${source.x})`)
        .attr("fill-opacity", 0)
        .attr("stroke-opacity", 0);

      const link = gLink.selectAll("path").data(links, (d) => d.target.id);
      const linkEnter = link
        .enter()
        .append("path")
        .attr("d", (d) => {
          const o = { x: source.x0, y: source.y0 };
          return diagonal({ source: o, target: o });
        });
      link.merge(linkEnter).transition(transition).attr("d", diagonal);
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

    root.x0 = dy / 2;
    root.y0 = 0;
    root.descendants().forEach((d, i) => {
      d.id = i;
      d._children = d.children;
      if (d.children) {
        d.children = null;
      }
    });

    update(null, root);
  }, [data, dispatch]);

  // Effect for UI updates
  useEffect(() => {
    if (!svgRef.current) {
      return;
    }

    d3.select(svgRef.current)
      .selectAll("g.node-group")
      .select(".cart-button-fo button")
      .text((d) =>
        cartNodeIds.includes(d.data._id) ? "Remove" : "Add to Cart",
      );
  }, [cartNodeIds]);

  return <div ref={svgRef} className="tree-constructor-container"></div>;
};

export default TreeConstructor;