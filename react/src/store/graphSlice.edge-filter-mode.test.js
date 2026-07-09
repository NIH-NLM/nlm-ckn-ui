import { configureStore } from "@reduxjs/toolkit";

const mockFetchNodeExpansion = jest.fn();
const mockFetchGraphData = jest.fn();
jest.mock("../services", () => ({
  fetchEdgeFilterOptions: jest.fn(),
  fetchGraphData: (...args) => mockFetchGraphData(...args),
  fetchNodeExpansion: (...args) => mockFetchNodeExpansion(...args),
}));

const slice = require("./graphSlice");
const {
  default: graphReducer,
  setEdgeFilterMode,
  expandNode,
  initializeGraph,
  fetchAndProcessGraph,
} = slice;

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

  it("fetchAndProcessGraph advanced mode routes exclude-mode fields to excludeEdgeFilters per node", async () => {
    mockFetchGraphData.mockResolvedValue({});
    const store = makeStore();
    // Enter advanced mode and seed per-node settings + an exclude-mode field.
    store.dispatch(
      initializeGraph({
        nodeIds: ["CL/1"],
        isAdvancedMode: true,
        perNodeSettings: {
          "CL/1": {
            edgeFilters: { Label: ["DERIVES_FROM"] },
            depth: 1,
            edgeDirection: "ANY",
            allowedCollections: ["CL"],
          },
        },
      }),
    );
    store.dispatch(setEdgeFilterMode({ field: "Label", mode: "exclude" }));
    expect(present(store).isAdvancedMode).toBe(true);
    await store.dispatch(fetchAndProcessGraph());
    const params = mockFetchGraphData.mock.calls[0][0];
    expect(params.advancedSettings["CL/1"].excludeEdgeFilters).toEqual({
      Label: ["DERIVES_FROM"],
    });
    expect(params.advancedSettings["CL/1"].edgeFilters).toEqual({});
  });

  it("fetchAndProcessGraph advanced mode honors each node's own edge filter modes", async () => {
    mockFetchGraphData.mockResolvedValue({});
    const store = makeStore();
    // Two nodes with DIFFERENT per-node modes for the same field, both
    // differing from any global mode (global stays default/include).
    store.dispatch(
      initializeGraph({
        nodeIds: ["A", "B"],
        isAdvancedMode: true,
        perNodeSettings: {
          A: {
            edgeFilters: { Label: ["DERIVES_FROM"] },
            edgeFilterModes: { Label: "exclude" },
            depth: 1,
            edgeDirection: "ANY",
            allowedCollections: ["CL"],
          },
          B: {
            edgeFilters: { Label: ["PART_OF"] },
            edgeFilterModes: { Label: "include" },
            depth: 1,
            edgeDirection: "ANY",
            allowedCollections: ["CL"],
          },
        },
      }),
    );
    // No setEdgeFilterMode dispatch: global modes remain empty (default include).
    await store.dispatch(fetchAndProcessGraph());
    const params = mockFetchGraphData.mock.calls[0][0];
    // Node A's Label is exclude -> routed to excludeEdgeFilters.
    expect(params.advancedSettings["A"].excludeEdgeFilters).toEqual({
      Label: ["DERIVES_FROM"],
    });
    expect(params.advancedSettings["A"].edgeFilters).toEqual({});
    // Node B's Label is include -> routed to edgeFilters.
    expect(params.advancedSettings["B"].edgeFilters).toEqual({
      Label: ["PART_OF"],
    });
    expect(params.advancedSettings["B"].excludeEdgeFilters).toEqual({});
  });

  it("fetchAndProcessGraph advanced mode falls back to global mode per field", async () => {
    mockFetchGraphData.mockResolvedValue({});
    const store = makeStore();
    // Global mode marks Source as exclude.
    store.dispatch(setEdgeFilterMode({ field: "Source", mode: "exclude" }));
    // Node only overrides Label; Source is absent from its per-node modes and
    // must fall back to the GLOBAL mode (exclude) per field.
    store.dispatch(
      initializeGraph({
        nodeIds: ["A"],
        isAdvancedMode: true,
        perNodeSettings: {
          A: {
            edgeFilters: { Label: ["DERIVES_FROM"], Source: ["CL"] },
            edgeFilterModes: { Label: "include" },
            depth: 1,
            edgeDirection: "ANY",
            allowedCollections: ["CL"],
          },
        },
      }),
    );
    await store.dispatch(fetchAndProcessGraph());
    const params = mockFetchGraphData.mock.calls[0][0];
    // Label follows the node's own include mode.
    expect(params.advancedSettings["A"].edgeFilters).toEqual({
      Label: ["DERIVES_FROM"],
    });
    // Source has no per-node mode -> follows GLOBAL exclude.
    expect(params.advancedSettings["A"].excludeEdgeFilters).toEqual({
      Source: ["CL"],
    });
  });
});
