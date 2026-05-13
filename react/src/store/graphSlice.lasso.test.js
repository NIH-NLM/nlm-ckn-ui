import { configureStore } from "@reduxjs/toolkit";

jest.mock("../services", () => ({
  fetchEdgeFilterOptions: jest.fn(),
  fetchGraphData: jest.fn(),
  fetchNodeExpansion: jest.fn(),
}));

const slice = require("./graphSlice");
const {
  default: graphReducer,
  setLassoSelection,
  addToLassoSelection,
  clearLassoSelection,
  collapseNodes,
  updateNodePositions,
  setGraphData,
  loadGraph,
  loadGraphFromJson,
  initializeGraph,
  clearGraphData,
} = slice;

const makeStore = () => configureStore({ reducer: { graph: graphReducer } });
const present = (store) => store.getState().graph.present;

describe("lasso selection reducers", () => {
  it("setLassoSelection replaces the selection", () => {
    const store = makeStore();
    store.dispatch(setLassoSelection(["a", "b"]));
    expect(present(store).lassoSelectedNodeIds).toEqual(["a", "b"]);
    store.dispatch(setLassoSelection(["c"]));
    expect(present(store).lassoSelectedNodeIds).toEqual(["c"]);
  });

  it("setLassoSelection deduplicates input", () => {
    const store = makeStore();
    store.dispatch(setLassoSelection(["a", "a", "b"]));
    expect(present(store).lassoSelectedNodeIds).toEqual(["a", "b"]);
  });

  it("addToLassoSelection unions with existing selection", () => {
    const store = makeStore();
    store.dispatch(setLassoSelection(["a", "b"]));
    store.dispatch(addToLassoSelection(["b", "c"]));
    expect([...present(store).lassoSelectedNodeIds].sort()).toEqual(["a", "b", "c"]);
  });

  it("clearLassoSelection empties the selection", () => {
    const store = makeStore();
    store.dispatch(setLassoSelection(["a", "b"]));
    store.dispatch(clearLassoSelection());
    expect(present(store).lassoSelectedNodeIds).toEqual([]);
  });
});

describe("bulk graph reducers", () => {
  it("collapseNodes adds all ids to userDefined and clears them from userIgnored", () => {
    const store = makeStore();
    store.dispatch(
      setGraphData({
        nodes: [{ id: "x" }, { id: "y" }, { id: "z" }],
        links: [],
      }),
    );
    store.dispatch(collapseNodes(["x", "y"]));
    const { collapsed } = present(store);
    expect([...collapsed.userDefined].sort()).toEqual(["x", "y"]);
  });

  it("updateNodePositions writes positions for each provided id", () => {
    const store = makeStore();
    store.dispatch(
      setGraphData({
        nodes: [
          { id: "a", x: 0, y: 0 },
          { id: "b", x: 0, y: 0 },
          { id: "c", x: 5, y: 5 },
        ],
        links: [],
      }),
    );
    store.dispatch(
      updateNodePositions([
        { nodeId: "a", x: 10, y: 20 },
        { nodeId: "b", x: 30, y: 40 },
      ]),
    );
    const nodes = present(store).graphData.nodes;
    expect(nodes.find((n) => n.id === "a")).toMatchObject({ x: 10, y: 20 });
    expect(nodes.find((n) => n.id === "b")).toMatchObject({ x: 30, y: 40 });
    expect(nodes.find((n) => n.id === "c")).toMatchObject({ x: 5, y: 5 });
  });
});

describe("lasso selection resets on graph reload", () => {
  const seedSelection = (store) => {
    store.dispatch(setLassoSelection(["a", "b"]));
    expect(present(store).lassoSelectedNodeIds).toEqual(["a", "b"]);
  };

  it("clearGraphData resets lassoSelectedNodeIds", () => {
    const store = makeStore();
    seedSelection(store);
    store.dispatch(clearGraphData());
    expect(present(store).lassoSelectedNodeIds).toEqual([]);
  });

  it("initializeGraph resets lassoSelectedNodeIds", () => {
    const store = makeStore();
    seedSelection(store);
    store.dispatch(initializeGraph({ nodeIds: ["x"], isAdvancedMode: false, perNodeSettings: {} }));
    expect(present(store).lassoSelectedNodeIds).toEqual([]);
  });

  it("loadGraph resets lassoSelectedNodeIds", () => {
    const store = makeStore();
    seedSelection(store);
    store.dispatch(
      loadGraph({
        originNodeIds: ["x"],
        settings: present(store).settings,
        graphData: { nodes: [], links: [] },
      }),
    );
    expect(present(store).lassoSelectedNodeIds).toEqual([]);
  });

  it("loadGraphFromJson resets lassoSelectedNodeIds", () => {
    const store = makeStore();
    seedSelection(store);
    store.dispatch(loadGraphFromJson({ nodes: [], links: [] }));
    expect(present(store).lassoSelectedNodeIds).toEqual([]);
  });
});
