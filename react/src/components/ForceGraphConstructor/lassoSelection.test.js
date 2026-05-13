// d3.pointer in JSDOM relies on getScreenCTM() which isn't implemented.
// Mock it to use the raw clientX/Y so the lasso receives world coordinates
// equal to the synthesized pointer-event coordinates.
jest.mock("d3", () => {
  const actual = jest.requireActual("d3");
  return {
    ...actual,
    pointer: (event) => [event.clientX || 0, event.clientY || 0],
  };
});

const d3 = require("d3");
const { attachLasso } = require("./lassoSelection");

// Helper: build an isolated SVG with a child <g> that we can pass to
// attachLasso. Returns d3 selections and the underlying nodes.
const makeStage = () => {
  const svgEl = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svgEl.setAttribute("width", "200");
  svgEl.setAttribute("height", "200");
  const gEl = document.createElementNS("http://www.w3.org/2000/svg", "g");
  svgEl.appendChild(gEl);
  document.body.appendChild(svgEl);
  return { svg: d3.select(svgEl), g: d3.select(gEl), svgEl, gEl };
};

// JSDOM ships PointerEvent in recent versions, but fall back to a MouseEvent
// shaped like a pointer event when needed.
const fire = (target, type, init = {}) => {
  const Ctor = typeof PointerEvent === "function" ? PointerEvent : MouseEvent;
  const event = new Ctor(type, {
    bubbles: true,
    cancelable: true,
    button: 0,
    pointerId: 1,
    ...init,
  });
  // jsdom's MouseEvent fallback ignores clientX/Y in init — copy them back.
  if (init.clientX != null) Object.defineProperty(event, "clientX", { value: init.clientX });
  if (init.clientY != null) Object.defineProperty(event, "clientY", { value: init.clientY });
  if (init.shiftKey != null) Object.defineProperty(event, "shiftKey", { value: init.shiftKey });
  if (init.button != null) Object.defineProperty(event, "button", { value: init.button });
  if (init.pointerId != null) Object.defineProperty(event, "pointerId", { value: init.pointerId });
  target.dispatchEvent(event);
  return event;
};

describe("attachLasso", () => {
  let stage;

  beforeEach(() => {
    stage = makeStage();
  });

  afterEach(() => {
    stage.svgEl.remove();
  });

  it("does nothing when isEnabled returns false", () => {
    const onSelectionComplete = jest.fn();
    const detach = attachLasso({
      svg: stage.svg,
      g: stage.g,
      getNodes: () => [{ id: "a", x: 10, y: 10 }],
      onSelectionComplete,
      isEnabled: () => false,
    });

    fire(stage.svgEl, "pointerdown", { clientX: 0, clientY: 0 });
    fire(stage.svgEl, "pointermove", { clientX: 100, clientY: 100 });
    fire(stage.svgEl, "pointerup", { clientX: 100, clientY: 0 });

    expect(onSelectionComplete).not.toHaveBeenCalled();
    detach();
  });

  it("selects only nodes inside the polygon when enabled", () => {
    const onSelectionComplete = jest.fn();
    const nodes = [
      { id: "inside", x: 50, y: 50 },
      { id: "outside", x: 500, y: 500 },
      { id: "on-edge-out", x: -10, y: -10 },
    ];

    const detach = attachLasso({
      svg: stage.svg,
      g: stage.g,
      getNodes: () => nodes,
      onSelectionComplete,
      isEnabled: () => true,
    });

    // Draw a 100x100 box around (0,0)-(100,100).
    fire(stage.svgEl, "pointerdown", { clientX: 0, clientY: 0 });
    fire(stage.svgEl, "pointermove", { clientX: 100, clientY: 0 });
    fire(stage.svgEl, "pointermove", { clientX: 100, clientY: 100 });
    fire(stage.svgEl, "pointermove", { clientX: 0, clientY: 100 });
    fire(stage.svgEl, "pointerup", { clientX: 0, clientY: 0 });

    expect(onSelectionComplete).toHaveBeenCalledTimes(1);
    const [ids, modifiers] = onSelectionComplete.mock.calls[0];
    expect(ids).toEqual(["inside"]);
    expect(modifiers).toEqual({ shift: false });
    detach();
  });

  it("reports shift modifier from the final pointerup event", () => {
    const onSelectionComplete = jest.fn();
    const detach = attachLasso({
      svg: stage.svg,
      g: stage.g,
      getNodes: () => [{ id: "n", x: 10, y: 10 }],
      onSelectionComplete,
      isEnabled: () => true,
    });

    fire(stage.svgEl, "pointerdown", { clientX: 0, clientY: 0 });
    fire(stage.svgEl, "pointermove", { clientX: 50, clientY: 0 });
    fire(stage.svgEl, "pointermove", { clientX: 50, clientY: 50 });
    fire(stage.svgEl, "pointerup", { clientX: 0, clientY: 50, shiftKey: true });

    expect(onSelectionComplete).toHaveBeenCalledWith(["n"], { shift: true });
    detach();
  });

  it("removes its in-flight path on detach", () => {
    const detach = attachLasso({
      svg: stage.svg,
      g: stage.g,
      getNodes: () => [],
      onSelectionComplete: jest.fn(),
      isEnabled: () => true,
    });

    fire(stage.svgEl, "pointerdown", { clientX: 0, clientY: 0 });
    fire(stage.svgEl, "pointermove", { clientX: 30, clientY: 30 });
    expect(stage.gEl.querySelector(".lasso-path")).not.toBeNull();

    detach();
    expect(stage.gEl.querySelector(".lasso-path")).toBeNull();
  });

  it("ignores secondary mouse buttons", () => {
    const onSelectionComplete = jest.fn();
    const detach = attachLasso({
      svg: stage.svg,
      g: stage.g,
      getNodes: () => [{ id: "n", x: 10, y: 10 }],
      onSelectionComplete,
      isEnabled: () => true,
    });

    fire(stage.svgEl, "pointerdown", { clientX: 0, clientY: 0, button: 2 });
    fire(stage.svgEl, "pointermove", { clientX: 50, clientY: 50 });
    fire(stage.svgEl, "pointerup", { clientX: 50, clientY: 0 });

    expect(onSelectionComplete).not.toHaveBeenCalled();
    detach();
  });
});
