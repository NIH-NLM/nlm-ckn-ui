import { configureStore } from "@reduxjs/toolkit";
import graphReducer, { setGraphData } from "./graphSlice";
import savedGraphsReducer, {
  deleteGraph,
  renameGraph,
  restoreSavedGraph,
  saveGraph,
  setActiveGraph,
  snapshotCurrentGraph,
} from "./savedGraphsSlice";

const makeStore = () => configureStore({ reducer: { savedGraphs: savedGraphsReducer } });
const makeFullStore = () =>
  configureStore({ reducer: { graph: graphReducer, savedGraphs: savedGraphsReducer } });
const state = (s) => s.getState().savedGraphs;

describe("savedGraphsSlice extensions", () => {
  it("saveGraph stores thumbnail and marks the new graph active", () => {
    const store = makeStore();
    store.dispatch(
      saveGraph({
        name: "G1",
        originNodeIds: ["CS/a"],
        settings: {},
        graphData: {},
        thumbnail: "data:x",
      }),
    );
    const { savedGraphs, activeGraphId } = state(store);
    expect(savedGraphs).toHaveLength(1);
    expect(savedGraphs[0].thumbnail).toBe("data:x");
    expect(activeGraphId).toBe(savedGraphs[0].id);
  });

  it("renameGraph updates the name by id", () => {
    const store = makeStore();
    store.dispatch(saveGraph({ name: "G1", originNodeIds: [], settings: {}, graphData: {} }));
    const id = state(store).savedGraphs[0].id;
    store.dispatch(renameGraph({ id, name: "Renamed" }));
    expect(state(store).savedGraphs[0].name).toBe("Renamed");
  });

  it("setActiveGraph sets the active id", () => {
    const store = makeStore();
    store.dispatch(setActiveGraph("xyz"));
    expect(state(store).activeGraphId).toBe("xyz");
  });

  it("deleteGraph clears activeGraphId when the active graph is removed", () => {
    const store = makeStore();
    store.dispatch(saveGraph({ name: "G1", originNodeIds: [], settings: {}, graphData: {} }));
    const id = state(store).savedGraphs[0].id;
    store.dispatch(setActiveGraph(id));
    store.dispatch(deleteGraph(id));
    expect(state(store).activeGraphId).toBeNull();
  });
});

describe("restoreSavedGraph thunk", () => {
  it("loads the saved graph's data and marks it active", () => {
    const store = makeFullStore();
    store.dispatch(
      saveGraph({
        name: "G1",
        originNodeIds: ["CS/a"],
        settings: {},
        graphData: { nodes: [{ id: "CS/a" }], links: [] },
      }),
    );
    const id = store.getState().savedGraphs.savedGraphs[0].id;
    store.dispatch(restoreSavedGraph(id));
    expect(store.getState().savedGraphs.activeGraphId).toBe(id);
    expect(store.getState().graph.present.graphData.nodes).toEqual([{ id: "CS/a" }]);
  });

  it("restores the saved display settings alongside the graph data", () => {
    const store = makeFullStore();
    store.dispatch(
      saveGraph({
        name: "G1",
        originNodeIds: ["CS/a"],
        settings: { collapseOnStart: true, nodeLabelFilters: ["CS"] },
        graphData: { nodes: [{ id: "CS/a" }], links: [] },
      }),
    );
    const id = store.getState().savedGraphs.savedGraphs[0].id;
    store.dispatch(restoreSavedGraph(id));
    const { settings } = store.getState().graph.present;
    expect(settings.collapseOnStart).toBe(true);
    expect(settings.nodeLabelFilters).toEqual(["CS"]);
    // Query-affecting fields stay disabled because the data is already resolved.
    expect(settings.depth).toBe(0);
    expect(settings.useFocusNodes).toBe(false);
  });

  it("is a no-op for an unknown id", () => {
    const store = makeFullStore();
    expect(() => store.dispatch(restoreSavedGraph("nope"))).not.toThrow();
  });
});

describe("snapshotCurrentGraph thunk", () => {
  it("snapshots the current live graph to the shelf", () => {
    const store = makeFullStore();
    store.dispatch(setGraphData({ nodes: [{ id: "CS/a" }], links: [], skipUndo: true }));
    store.dispatch(snapshotCurrentGraph({ name: "Snap", thumbnail: "data:x" }));
    const shelf = store.getState().savedGraphs.savedGraphs;
    expect(shelf).toHaveLength(1);
    expect(shelf[0].name).toBe("Snap");
    expect(shelf[0].thumbnail).toBe("data:x");
  });

  it("does not snapshot an empty graph", () => {
    const store = makeFullStore();
    store.dispatch(snapshotCurrentGraph({ name: "Snap" }));
    expect(store.getState().savedGraphs.savedGraphs).toHaveLength(0);
  });
});
