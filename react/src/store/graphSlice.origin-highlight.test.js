import { configureStore } from "@reduxjs/toolkit";
import graphReducer, { collapseNode, setGraphData } from "./graphSlice";
import savedGraphsReducer, { addHistoryEntry, restoreHistoryEntry } from "./savedGraphsSlice";

const makeStore = () =>
  configureStore({ reducer: { graph: graphReducer, savedGraphs: savedGraphsReducer } });
const graphState = (s) => s.getState().graph.present;

const workflowResult = {
  graphData: {
    nodes: [{ _id: "UBERON/0001004" }, { _id: "CL/0000066" }, { _id: "CL/other" }],
    links: [],
  },
  originNodeIds: ["UBERON/0001004", "CL/0000066"],
  source: "workflow",
};

describe("origin highlighting on pre-resolved workflow results", () => {
  it("keeps focus-node rendering on so the origins are marked in the graph", () => {
    const store = makeStore();

    store.dispatch(setGraphData(workflowResult));

    expect(graphState(store).settings.useFocusNodes).toBe(true);
  });

  it("still pins depth to 0, since the result is already resolved", () => {
    const store = makeStore();

    store.dispatch(setGraphData(workflowResult));

    expect(graphState(store).settings.depth).toBe(0);
  });

  it("records the origins the panel lists", () => {
    const store = makeStore();

    store.dispatch(setGraphData(workflowResult));

    expect(graphState(store).originNodeIds).toEqual(["UBERON/0001004", "CL/0000066"]);
  });
});

describe("origins survive a history restore", () => {
  const entry = {
    id: "h1",
    originId: "UBERON/0001004",
    originNodeIds: ["UBERON/0001004", "CL/0000066"],
    label: "bronchus",
    subgraph: { nodes: [{ _id: "UBERON/0001004" }, { _id: "CL/0000066" }], links: [] },
    timestamp: "2026-09-10T00:00:00.000Z",
  };

  it("reinstates the composition's origins instead of clearing them", () => {
    const store = makeStore();
    store.dispatch(setGraphData(workflowResult));
    store.dispatch(addHistoryEntry(entry));

    store.dispatch(restoreHistoryEntry("h1"));

    expect(graphState(store).originNodeIds).toEqual(["UBERON/0001004", "CL/0000066"]);
  });

  it("falls back to the entry's single origin when no origin set was captured", () => {
    const store = makeStore();
    store.dispatch(setGraphData(workflowResult));
    const { originNodeIds: _omitted, ...legacyEntry } = entry;
    store.dispatch(addHistoryEntry(legacyEntry));

    store.dispatch(restoreHistoryEntry("h1"));

    expect(graphState(store).originNodeIds).toEqual(["UBERON/0001004"]);
  });

  it("clears origins on a restore that carries none at all", () => {
    const store = makeStore();
    store.dispatch(setGraphData(workflowResult));

    store.dispatch(setGraphData({ graphData: { nodes: [], links: [] }, isRestore: true }));

    expect(graphState(store).originNodeIds).toEqual([]);
  });
});

describe("a history restore leaves display state alone", () => {
  const entry = {
    id: "h1",
    originId: "UBERON/0001004",
    originNodeIds: ["UBERON/0001004"],
    label: "bronchus",
    subgraph: { nodes: [{ _id: "UBERON/0001004" }], links: [] },
    timestamp: "2026-09-10T00:00:00.000Z",
  };

  it("does not reset the collapsed sets a restore is meant to preserve", () => {
    const store = makeStore();
    store.dispatch(
      setGraphData({
        graphData: { nodes: [{ _id: "UBERON/0001004" }], links: [] },
        originNodeIds: ["UBERON/0001004"],
      }),
    );
    store.dispatch(collapseNode("CL/other"));
    const collapsedBefore = graphState(store).collapsed.userDefined;
    store.dispatch(addHistoryEntry(entry));

    store.dispatch(restoreHistoryEntry("h1"));

    expect(graphState(store).collapsed.userDefined).toEqual(collapsedBefore);
  });
});
