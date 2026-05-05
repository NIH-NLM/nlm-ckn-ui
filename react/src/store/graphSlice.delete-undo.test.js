import { configureStore } from "@reduxjs/toolkit";
import { ActionCreators } from "redux-undo";

jest.mock("../services", () => ({
  fetchEdgeFilterOptions: jest.fn(),
  fetchGraphData: jest.fn(),
  fetchNodeExpansion: jest.fn(),
}));

const slice = require("./graphSlice");
const { default: graphReducer, collapseNode, collapseNodes, setGraphData } = slice;

const makeStore = () => configureStore({ reducer: { graph: graphReducer } });
const present = (store) => store.getState().graph.present;

// Mirrors the dispatch sequence used by handleRemove / handleBulkDelete in
// ForceGraph.js: setGraphData (filter-accepted, creates undo checkpoint) →
// collapseNode/s (filter-rejected) → simulation-end setGraphData with
// skipUndo (filter-rejected, syncs final positions). Ctrl+Z must restore
// both the deleted nodes AND the clean collapsed.userDefined.

describe("delete-then-undo restores graphData and collapsed.userDefined", () => {
  it("single-node delete: undo brings back the node and clears userDefined", () => {
    const store = makeStore();
    // Seed the graph with three nodes and one link.
    store.dispatch(
      setGraphData({
        nodes: [{ id: "a" }, { id: "b" }, { id: "c" }],
        links: [{ _id: "ab", source: "a", target: "b" }],
        skipUndo: true,
      }),
    );
    expect(present(store).graphData.nodes).toHaveLength(3);

    // handleRemove sequence for node "b":
    // 1. snapshot post-delete (filter-accepted → past[] gets pre-delete)
    store.dispatch(
      setGraphData({
        nodes: [{ id: "a" }, { id: "c" }],
        links: [],
      }),
    );
    // 2. collapseNode (filter-rejected, advances present.collapsed.userDefined)
    store.dispatch(collapseNode("b"));
    // 3. simulation-end sync (filter-rejected via skipUndo)
    store.dispatch(
      setGraphData({
        nodes: [{ id: "a" }, { id: "c" }],
        links: [],
        skipUndo: true,
      }),
    );

    // Sanity: node is gone and recorded in userDefined.
    expect(
      present(store)
        .graphData.nodes.map((n) => n.id)
        .sort(),
    ).toEqual(["a", "c"]);
    expect(present(store).collapsed.userDefined).toContain("b");

    // Ctrl+Z: should fully restore.
    store.dispatch(ActionCreators.undo());
    expect(
      present(store)
        .graphData.nodes.map((n) => n.id)
        .sort(),
    ).toEqual(["a", "b", "c"]);
    expect(present(store).graphData.links).toHaveLength(1);
    expect(present(store).collapsed.userDefined).not.toContain("b");
  });

  it("bulk delete: undo brings back all selected nodes and clears userDefined for each", () => {
    const store = makeStore();
    store.dispatch(
      setGraphData({
        nodes: [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }],
        links: [
          { _id: "ab", source: "a", target: "b" },
          { _id: "bc", source: "b", target: "c" },
          { _id: "cd", source: "c", target: "d" },
        ],
        skipUndo: true,
      }),
    );

    // handleBulkDelete sequence for nodes [b, c]:
    store.dispatch(
      setGraphData({
        nodes: [{ id: "a" }, { id: "d" }],
        links: [],
      }),
    );
    store.dispatch(collapseNodes(["b", "c"]));
    store.dispatch(
      setGraphData({
        nodes: [{ id: "a" }, { id: "d" }],
        links: [],
        skipUndo: true,
      }),
    );

    expect(
      present(store)
        .graphData.nodes.map((n) => n.id)
        .sort(),
    ).toEqual(["a", "d"]);
    expect([...present(store).collapsed.userDefined].sort()).toEqual(["b", "c"]);

    store.dispatch(ActionCreators.undo());
    expect(
      present(store)
        .graphData.nodes.map((n) => n.id)
        .sort(),
    ).toEqual(["a", "b", "c", "d"]);
    expect(present(store).graphData.links).toHaveLength(3);
    expect(present(store).collapsed.userDefined).not.toContain("b");
    expect(present(store).collapsed.userDefined).not.toContain("c");
  });

  it("two sequential deletes: each undo reverses one delete", () => {
    const store = makeStore();
    store.dispatch(
      setGraphData({
        nodes: [{ id: "a" }, { id: "b" }, { id: "c" }],
        links: [],
        skipUndo: true,
      }),
    );

    // First delete: remove "c"
    store.dispatch(setGraphData({ nodes: [{ id: "a" }, { id: "b" }], links: [] }));
    store.dispatch(collapseNode("c"));
    store.dispatch(setGraphData({ nodes: [{ id: "a" }, { id: "b" }], links: [], skipUndo: true }));

    // Second delete: remove "b"
    store.dispatch(setGraphData({ nodes: [{ id: "a" }], links: [] }));
    store.dispatch(collapseNode("b"));
    store.dispatch(setGraphData({ nodes: [{ id: "a" }], links: [], skipUndo: true }));

    expect(present(store).graphData.nodes.map((n) => n.id)).toEqual(["a"]);

    // First undo restores "b".
    store.dispatch(ActionCreators.undo());
    expect(
      present(store)
        .graphData.nodes.map((n) => n.id)
        .sort(),
    ).toEqual(["a", "b"]);
    expect(present(store).collapsed.userDefined).not.toContain("b");

    // Second undo restores "c".
    store.dispatch(ActionCreators.undo());
    expect(
      present(store)
        .graphData.nodes.map((n) => n.id)
        .sort(),
    ).toEqual(["a", "b", "c"]);
    expect(present(store).collapsed.userDefined).not.toContain("c");
  });
});
