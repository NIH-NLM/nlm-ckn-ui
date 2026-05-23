import * as d3 from "d3";

// Attaches a lasso selection behavior to the given SVG.
//
// The lasso draws a freeform polygon following the pointer while a drag is
// active inside `svg` (gated by `isEnabled()`). On release, every node
// returned by `getNodes()` whose `[x, y]` falls inside the polygon is reported
// to `onSelectionComplete` along with the modifier keys held at release time
// (currently `{ shift }`; alt is intentionally ignored).
//
// Coordinates are taken in the world space of `g` — i.e. `g` is the
// zoom/pan-transformed group that contains the rendered nodes — so the lasso
// matches what the user sees regardless of the current zoom transform.
//
// Returns a `detach()` cleanup function.
export function attachLasso({ svg, g, getNodes, onSelectionComplete, isEnabled }) {
  const svgNode = svg.node ? svg.node() : svg;
  const gSel = g.append ? g : d3.select(g);

  let points = null;
  let pathSel = null;
  let pointerId = null;

  const toWorld = (event) => d3.pointer(event, gSel.node());

  const pathString = (pts) => {
    if (!pts || pts.length === 0) return "";
    const [first, ...rest] = pts;
    const tail = rest.map(([x, y]) => `L${x},${y}`).join("");
    return `M${first[0]},${first[1]}${tail}Z`;
  };

  const handlePointerDown = (event) => {
    // Only respond when lasso mode is on, only react to primary button.
    if (!isEnabled || !isEnabled()) return;
    if (event.button !== 0) return;

    points = [toWorld(event)];
    pointerId = event.pointerId;

    pathSel = gSel.append("path").attr("class", "lasso-path").attr("d", pathString(points));

    // Capture so we keep getting move/up events even if the pointer leaves.
    if (event.target?.setPointerCapture) {
      try {
        event.target.setPointerCapture(pointerId);
      } catch (_) {
        // Ignore — capture is a best-effort enhancement.
      }
    }

    event.preventDefault();
    event.stopPropagation();
  };

  const handlePointerMove = (event) => {
    if (!points) return;
    if (pointerId != null && event.pointerId !== pointerId) return;
    points.push(toWorld(event));
    pathSel?.attr("d", pathString(points));
  };

  const handlePointerUp = (event) => {
    if (!points) return;
    if (pointerId != null && event.pointerId !== pointerId) return;

    const polygon = points;
    const path = pathSel;
    points = null;
    pathSel = null;
    pointerId = null;

    path?.remove();

    if (polygon.length >= 3) {
      const nodes = getNodes?.() || [];
      const selectedIds = nodes
        .filter((n) => Number.isFinite(n.x) && Number.isFinite(n.y))
        .filter((n) => d3.polygonContains(polygon, [n.x, n.y]))
        .map((n) => n.id);
      onSelectionComplete?.(selectedIds, { shift: !!event.shiftKey });
    }
  };

  svgNode.addEventListener("pointerdown", handlePointerDown);
  svgNode.addEventListener("pointermove", handlePointerMove);
  svgNode.addEventListener("pointerup", handlePointerUp);
  svgNode.addEventListener("pointercancel", handlePointerUp);

  return function detach() {
    svgNode.removeEventListener("pointerdown", handlePointerDown);
    svgNode.removeEventListener("pointermove", handlePointerMove);
    svgNode.removeEventListener("pointerup", handlePointerUp);
    svgNode.removeEventListener("pointercancel", handlePointerUp);
    pathSel?.remove();
    points = null;
    pathSel = null;
    pointerId = null;
  };
}
