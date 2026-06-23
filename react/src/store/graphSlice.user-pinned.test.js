import { configureStore } from "@reduxjs/toolkit";

jest.mock("../services", () => ({
  fetchEdgeFilterOptions: jest.fn(),
  fetchGraphData: jest.fn(),
  fetchNodeExpansion: jest.fn(),
}));

const slice = require("./graphSlice");
const {
  default: graphReducer,
  clearAllPins,
  setGraphData,
  updateNodePosition,
  updateNodePositions,
} = slice;

const makeStore = () => configureStore({ reducer: { graph: graphReducer } });
const present = (store) => store.getState().graph.present;
const findNode = (store, id) => present(store).graphData.nodes.find((n) => n.id === id);

const seed = (store) =>
  store.dispatch(
    setGraphData({
      nodes: [
        { id: "a", x: 0, y: 0 },
        { id: "b", x: 10, y: 10 },
        { id: "c", x: 20, y: 20 },
      ],
      links: [],
      skipUndo: true,
    }),
  );

describe("updateNodePosition propagates userPinned when present", () => {
  it("sets userPinned=true on the matched node when payload includes it", () => {
    const store = makeStore();
    seed(store);

    store.dispatch(updateNodePosition({ nodeId: "b", x: 50, y: 60, userPinned: true }));

    const b = findNode(store, "b");
    expect(b.x).toBe(50);
    expect(b.y).toBe(60);
    expect(b.userPinned).toBe(true);
  });

  it("clears userPinned when payload includes userPinned=false", () => {
    const store = makeStore();
    seed(store);

    // Pin first.
    store.dispatch(updateNodePosition({ nodeId: "a", x: 1, y: 1, userPinned: true }));
    expect(findNode(store, "a").userPinned).toBe(true);

    // Then unpin.
    store.dispatch(updateNodePosition({ nodeId: "a", x: 2, y: 2, userPinned: false }));
    expect(findNode(store, "a").userPinned).toBe(false);
  });

  it("leaves existing userPinned untouched when payload omits the field", () => {
    const store = makeStore();
    seed(store);

    // Set userPinned via an explicit dispatch.
    store.dispatch(updateNodePosition({ nodeId: "c", x: 5, y: 5, userPinned: true }));

    // A position-only update (no userPinned) must not erase the pin.
    store.dispatch(updateNodePosition({ nodeId: "c", x: 7, y: 8 }));

    const c = findNode(store, "c");
    expect(c.x).toBe(7);
    expect(c.y).toBe(8);
    expect(c.userPinned).toBe(true);
  });

  it("does nothing when the nodeId is not in graphData", () => {
    const store = makeStore();
    seed(store);

    const before = present(store).graphData.nodes.map((n) => ({ ...n }));
    store.dispatch(updateNodePosition({ nodeId: "missing", x: 99, y: 99, userPinned: true }));
    const after = present(store).graphData.nodes;
    expect(after).toEqual(before);
  });
});

describe("updateNodePositions (bulk) propagates userPinned per entry", () => {
  it("sets userPinned on the matching nodes when present in entries", () => {
    const store = makeStore();
    seed(store);

    store.dispatch(
      updateNodePositions([
        { nodeId: "a", x: 100, y: 100, userPinned: true },
        { nodeId: "b", x: 200, y: 200, userPinned: true },
      ]),
    );

    expect(findNode(store, "a").userPinned).toBe(true);
    expect(findNode(store, "b").userPinned).toBe(true);
    // Untouched node retains no pin flag.
    expect(findNode(store, "c").userPinned).toBeUndefined();
  });

  it("leaves userPinned untouched when an entry omits the field", () => {
    const store = makeStore();
    seed(store);

    // Pin "a" first.
    store.dispatch(updateNodePosition({ nodeId: "a", x: 1, y: 1, userPinned: true }));

    // Bulk update reposition without userPinned in the entry.
    store.dispatch(updateNodePositions([{ nodeId: "a", x: 9, y: 9 }]));

    const a = findNode(store, "a");
    expect(a.x).toBe(9);
    expect(a.y).toBe(9);
    expect(a.userPinned).toBe(true);
  });

  it("tolerates an empty or missing payload", () => {
    const store = makeStore();
    seed(store);
    expect(() => store.dispatch(updateNodePositions([]))).not.toThrow();
    expect(() => store.dispatch(updateNodePositions())).not.toThrow();
  });
});

describe("clearAllPins clears userPinned across every node", () => {
  it("flips userPinned to false on every node, leaves x/y untouched", () => {
    const store = makeStore();
    seed(store);

    // Pin two of the three.
    store.dispatch(updateNodePosition({ nodeId: "a", x: 0, y: 0, userPinned: true }));
    store.dispatch(updateNodePosition({ nodeId: "b", x: 10, y: 10, userPinned: true }));
    expect(findNode(store, "a").userPinned).toBe(true);
    expect(findNode(store, "b").userPinned).toBe(true);

    const beforePositions = present(store).graphData.nodes.map((n) => ({
      id: n.id,
      x: n.x,
      y: n.y,
    }));

    store.dispatch(clearAllPins());

    for (const node of present(store).graphData.nodes) {
      expect(node.userPinned).toBe(false);
    }
    const afterPositions = present(store).graphData.nodes.map((n) => ({
      id: n.id,
      x: n.x,
      y: n.y,
    }));
    expect(afterPositions).toEqual(beforePositions);
  });
});
