import { configureStore } from "@reduxjs/toolkit";
import savedGraphsReducer, {
  deleteGraph,
  saveGraph,
  selectSavedGraphs,
  setActiveGraph,
} from "./savedGraphsSlice";

const makeStore = () => configureStore({ reducer: { savedGraphs: savedGraphsReducer } });
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

  it("selectSavedGraphs normalizes an undefined array to an empty array", () => {
    expect(selectSavedGraphs({ savedGraphs: { activeGraphId: null } })).toEqual([]);
    // Stable reference so it doesn't churn selector identity across calls.
    expect(selectSavedGraphs({ savedGraphs: {} })).toBe(
      selectSavedGraphs({ savedGraphs: { savedGraphs: undefined } }),
    );
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
