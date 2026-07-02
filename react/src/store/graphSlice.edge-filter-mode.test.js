import { configureStore } from "@reduxjs/toolkit";

const mockFetchNodeExpansion = jest.fn();
const mockFetchGraphData = jest.fn();
jest.mock("../services", () => ({
  fetchEdgeFilterOptions: jest.fn(),
  fetchGraphData: (...args) => mockFetchGraphData(...args),
  fetchNodeExpansion: (...args) => mockFetchNodeExpansion(...args),
}));

const slice = require("./graphSlice");
const { default: graphReducer, setEdgeFilterMode, expandNode } = slice;

const makeStore = () => configureStore({ reducer: { graph: graphReducer } });
const present = (store) => store.getState().graph.present;

describe("edge filter mode", () => {
  beforeEach(() => {
    mockFetchNodeExpansion.mockClear();
    mockFetchGraphData.mockClear();
  });

  it("setEdgeFilterMode sets a field's mode", () => {
    const store = makeStore();
    store.dispatch(setEdgeFilterMode({ field: "Label", mode: "exclude" }));
    expect(present(store).settings.edgeFilterModes.Label).toBe("exclude");
  });

  it("setEdgeFilterMode coerces unknown values to include", () => {
    const store = makeStore();
    store.dispatch(setEdgeFilterMode({ field: "Label", mode: "exclude" }));
    store.dispatch(setEdgeFilterMode({ field: "Label", mode: "bogus" }));
    expect(present(store).settings.edgeFilterModes.Label).toBe("include");
  });

  it("expandNode sends include/exclude filters split by mode", async () => {
    mockFetchNodeExpansion.mockResolvedValue({ "CL/1": { nodes: [], links: [] } });
    const store = makeStore();
    store.dispatch({
      type: "graph/updateSetting",
      payload: { setting: "edgeFilters", value: { Label: ["DERIVES_FROM"] } },
    });
    store.dispatch(setEdgeFilterMode({ field: "Label", mode: "exclude" }));
    await store.dispatch(expandNode({ nodeId: "CL/1" }));
    const callArgs = mockFetchNodeExpansion.mock.calls[0];
    // args: nodeId, graphType, allowedCollections, includeInterNodeEdges, edgeFilters, excludeEdgeFilters
    expect(callArgs[4]).toEqual({});
    expect(callArgs[5]).toEqual({ Label: ["DERIVES_FROM"] });
  });
});
