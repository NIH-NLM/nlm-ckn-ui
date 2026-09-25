import { configureStore } from "@reduxjs/toolkit";

jest.mock("../services", () => ({
  fetchCollectionDocuments: jest.fn(),
  fetchConnectingPaths: jest.fn(),
  fetchEdgesBetween: jest.fn(),
  fetchGraphData: jest.fn(),
  fetchNodeDetailsByIds: jest.fn(),
}));

const services = require("../services");
const slice = require("./workflowBuilderSlice");
const { default: workflowBuilderReducer, executePhase, loadWorkflow, initializeWorkflow } = slice;

const makeStore = () => configureStore({ reducer: { workflowBuilder: workflowBuilderReducer } });

describe("executePhase post-merge inter-node edge scan", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("forwards phase.settings.edgeFilters to fetchEdgesBetween", async () => {
    services.fetchGraphData.mockResolvedValue({
      "CL/origin": {
        nodes: [{ _id: "CL/origin" }, { _id: "CL/neighbor" }],
        links: [],
      },
    });
    services.fetchEdgesBetween.mockResolvedValue([]);

    const store = makeStore();
    store.dispatch(
      loadWorkflow({
        phases: [
          {
            id: "p1",
            originSource: "manual",
            originNodeIds: ["CL/origin"],
            previousPhaseId: null,
            settings: {
              graphType: "ontologies",
              depth: 1,
              edgeDirection: "OUTBOUND",
              allowedCollections: ["CL"],
              setOperation: "Union",
              includeInterNodeEdges: true,
              edgeFilters: { Label: ["subClassOf"] },
            },
          },
        ],
      }),
    );

    await store.dispatch(executePhase({ phaseId: "p1" }));

    expect(services.fetchEdgesBetween).toHaveBeenCalledTimes(1);
    const callArgs = services.fetchEdgesBetween.mock.calls[0];
    expect(callArgs[1]).toBe("ontologies");
    expect(callArgs[2]).toEqual({ Label: ["subClassOf"] });
  });

  it("passes an empty object when phase.settings.edgeFilters is undefined", async () => {
    services.fetchGraphData.mockResolvedValue({
      "CL/origin": {
        nodes: [{ _id: "CL/origin" }, { _id: "CL/neighbor" }],
        links: [],
      },
    });
    services.fetchEdgesBetween.mockResolvedValue([]);

    const store = makeStore();
    store.dispatch(
      loadWorkflow({
        phases: [
          {
            id: "p1",
            originSource: "manual",
            originNodeIds: ["CL/origin"],
            previousPhaseId: null,
            settings: {
              graphType: "ontologies",
              depth: 1,
              edgeDirection: "OUTBOUND",
              allowedCollections: ["CL"],
              setOperation: "Union",
              includeInterNodeEdges: true,
            },
          },
        ],
      }),
    );

    await store.dispatch(executePhase({ phaseId: "p1" }));

    expect(services.fetchEdgesBetween).toHaveBeenCalledTimes(1);
    expect(services.fetchEdgesBetween.mock.calls[0][2]).toEqual({});
  });
});

describe("executePhase forwards excludeClosingEdges", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("includes excludeClosingEdges in advanced_settings", async () => {
    services.fetchGraphData.mockResolvedValue({
      "MONDO/d1": { nodes: [{ _id: "MONDO/d1" }, { _id: "GS/g1" }], links: [] },
    });
    if (services.fetchEdgesBetween) services.fetchEdgesBetween.mockResolvedValue([]);

    const store = makeStore();
    store.dispatch(
      loadWorkflow({
        phases: [
          {
            id: "p1",
            originSource: "manual",
            originNodeIds: ["MONDO/d1"],
            previousPhaseId: null,
            settings: {
              graphType: "phenotypes",
              depth: 3,
              edgeDirection: "ANY",
              allowedCollections: ["GS", "PR", "CHEMBL"],
              setOperation: "Union",
              includeInterNodeEdges: false,
              edgeFilters: { Label: ["IS_GENETIC_BASIS_FOR_CONDITION"] },
              excludeClosingEdges: { Label: ["IS_SUBSTANCE_THAT_TREATS"] },
            },
          },
        ],
      }),
    );

    await store.dispatch(executePhase({ phaseId: "p1" }));

    expect(services.fetchGraphData).toHaveBeenCalledTimes(1);
    const params = services.fetchGraphData.mock.calls[0][0];
    expect(params.advancedSettings["MONDO/d1"].excludeClosingEdges).toEqual({
      Label: ["IS_SUBSTANCE_THAT_TREATS"],
    });
  });
});

describe("executePhase forwards requireClosingEdges", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("includes requireClosingEdges in advanced_settings", async () => {
    services.fetchGraphData.mockResolvedValue({
      "MONDO/d1": { nodes: [{ _id: "MONDO/d1" }, { _id: "GS/g1" }], links: [] },
    });
    if (services.fetchEdgesBetween) services.fetchEdgesBetween.mockResolvedValue([]);

    const store = makeStore();
    store.dispatch(
      loadWorkflow({
        phases: [
          {
            id: "p1",
            originSource: "manual",
            originNodeIds: ["MONDO/d1"],
            previousPhaseId: null,
            settings: {
              graphType: "phenotypes",
              depth: 3,
              edgeDirection: "ANY",
              allowedCollections: ["GS", "PR", "CHEMBL"],
              setOperation: "Union",
              includeInterNodeEdges: false,
              requireClosingEdges: { Label: ["IS_SUBSTANCE_THAT_TREATS"] },
            },
          },
        ],
      }),
    );

    await store.dispatch(executePhase({ phaseId: "p1" }));

    expect(services.fetchGraphData).toHaveBeenCalledTimes(1);
    const params = services.fetchGraphData.mock.calls[0][0];
    expect(params.advancedSettings["MONDO/d1"].requireClosingEdges).toEqual({
      Label: ["IS_SUBSTANCE_THAT_TREATS"],
    });
  });

  it("prefers a per-node closing-edge override over the phase default", async () => {
    services.fetchGraphData.mockResolvedValue({
      "MONDO/d1": { nodes: [{ _id: "MONDO/d1" }], links: [] },
      "MONDO/d2": { nodes: [{ _id: "MONDO/d2" }], links: [] },
    });
    if (services.fetchEdgesBetween) services.fetchEdgesBetween.mockResolvedValue([]);

    const store = makeStore();
    store.dispatch(
      loadWorkflow({
        phases: [
          {
            id: "p1",
            originSource: "manual",
            originNodeIds: ["MONDO/d1", "MONDO/d2"],
            previousPhaseId: null,
            perNodeSettings: {
              "MONDO/d2": { excludeClosingEdges: { Label: ["PER_NODE_LABEL"] } },
            },
            settings: {
              graphType: "phenotypes",
              depth: 3,
              edgeDirection: "ANY",
              allowedCollections: ["GS"],
              setOperation: "Union",
              includeInterNodeEdges: false,
              excludeClosingEdges: { Label: ["IS_SUBSTANCE_THAT_TREATS"] },
            },
          },
        ],
      }),
    );

    await store.dispatch(executePhase({ phaseId: "p1" }));

    const params = services.fetchGraphData.mock.calls[0][0];
    // d1 inherits the phase default; d2 uses its per-node override.
    expect(params.advancedSettings["MONDO/d1"].excludeClosingEdges).toEqual({
      Label: ["IS_SUBSTANCE_THAT_TREATS"],
    });
    expect(params.advancedSettings["MONDO/d2"].excludeClosingEdges).toEqual({
      Label: ["PER_NODE_LABEL"],
    });
  });
});

describe("executePhase routes edge filters by include/exclude mode", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("splits an exclude-mode field into excludeEdgeFilters in advanced_settings", async () => {
    services.fetchGraphData.mockResolvedValue({
      "CL/origin": { nodes: [{ _id: "CL/origin" }, { _id: "CL/neighbor" }], links: [] },
    });
    if (services.fetchEdgesBetween) services.fetchEdgesBetween.mockResolvedValue([]);

    const store = makeStore();
    store.dispatch(
      loadWorkflow({
        phases: [
          {
            id: "p1",
            originSource: "manual",
            originNodeIds: ["CL/origin"],
            previousPhaseId: null,
            settings: {
              graphType: "ontologies",
              depth: 1,
              edgeDirection: "OUTBOUND",
              allowedCollections: ["CL"],
              setOperation: "Union",
              includeInterNodeEdges: false,
              edgeFilters: { Label: ["DERIVES_FROM"] },
              edgeFilterModes: { Label: "exclude" },
            },
          },
        ],
      }),
    );

    await store.dispatch(executePhase({ phaseId: "p1" }));

    expect(services.fetchGraphData).toHaveBeenCalledTimes(1);
    const params = services.fetchGraphData.mock.calls[0][0];
    const nodeSettings = params.advancedSettings["CL/origin"];
    expect(nodeSettings.excludeEdgeFilters).toEqual({ Label: ["DERIVES_FROM"] });
    // The excluded field must NOT appear in the (positive) include filters.
    expect(nodeSettings.edgeFilters).toEqual({});
  });

  it("keeps an include-mode field in edgeFilters and out of excludeEdgeFilters", async () => {
    services.fetchGraphData.mockResolvedValue({
      "CL/origin": { nodes: [{ _id: "CL/origin" }, { _id: "CL/neighbor" }], links: [] },
    });
    if (services.fetchEdgesBetween) services.fetchEdgesBetween.mockResolvedValue([]);

    const store = makeStore();
    store.dispatch(
      loadWorkflow({
        phases: [
          {
            id: "p1",
            originSource: "manual",
            originNodeIds: ["CL/origin"],
            previousPhaseId: null,
            settings: {
              graphType: "ontologies",
              depth: 1,
              edgeDirection: "OUTBOUND",
              allowedCollections: ["CL"],
              setOperation: "Union",
              includeInterNodeEdges: false,
              edgeFilters: { Label: ["DERIVES_FROM"] },
              edgeFilterModes: { Label: "include" },
            },
          },
        ],
      }),
    );

    await store.dispatch(executePhase({ phaseId: "p1" }));

    const params = services.fetchGraphData.mock.calls[0][0];
    const nodeSettings = params.advancedSettings["CL/origin"];
    expect(nodeSettings.edgeFilters).toEqual({ Label: ["DERIVES_FROM"] });
    expect(nodeSettings.excludeEdgeFilters).toEqual({});
  });
});

describe("executePhase merges edge filter modes per field for node overrides", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("inherits phase-level mode for fields a node override omits", async () => {
    services.fetchGraphData.mockResolvedValue({
      "CL/origin": { nodes: [{ _id: "CL/origin" }, { _id: "CL/neighbor" }], links: [] },
    });
    if (services.fetchEdgesBetween) services.fetchEdgesBetween.mockResolvedValue([]);

    const store = makeStore();
    store.dispatch(
      loadWorkflow({
        phases: [
          {
            id: "p1",
            originSource: "manual",
            originNodeIds: ["CL/origin"],
            previousPhaseId: null,
            perNodeSettings: {
              // Node overrides only the Label mode; Source is omitted and must
              // fall back to the phase-level mode (exclude).
              "CL/origin": { edgeFilterModes: { Label: "include" } },
            },
            settings: {
              graphType: "ontologies",
              depth: 1,
              edgeDirection: "OUTBOUND",
              allowedCollections: ["CL"],
              setOperation: "Union",
              includeInterNodeEdges: false,
              edgeFilters: { Label: ["DERIVES_FROM"], Source: ["cellxgene"] },
              edgeFilterModes: { Label: "exclude", Source: "exclude" },
            },
          },
        ],
      }),
    );

    await store.dispatch(executePhase({ phaseId: "p1" }));

    const params = services.fetchGraphData.mock.calls[0][0];
    const nodeSettings = params.advancedSettings["CL/origin"];
    // Label follows the node override (include) -> positive filters.
    // Source has no node override, so it inherits the phase mode (exclude).
    expect(nodeSettings.edgeFilters).toEqual({ Label: ["DERIVES_FROM"] });
    expect(nodeSettings.excludeEdgeFilters).toEqual({ Source: ["cellxgene"] });
  });
});

describe("executePhase caps collection origins at originLimit", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("slices collection origin ids down to originLimit", async () => {
    services.fetchCollectionDocuments.mockResolvedValue({
      a: { _id: "MONDO/1" },
      b: { _id: "MONDO/2" },
      c: { _id: "MONDO/3" },
      d: { _id: "MONDO/4" },
      e: { _id: "MONDO/5" },
    });
    services.fetchGraphData.mockResolvedValue({
      "MONDO/1": { nodes: [{ _id: "MONDO/1" }], links: [] },
      "MONDO/2": { nodes: [{ _id: "MONDO/2" }], links: [] },
    });
    if (services.fetchEdgesBetween) services.fetchEdgesBetween.mockResolvedValue([]);

    const store = makeStore();
    store.dispatch(
      loadWorkflow({
        phases: [
          {
            id: "p1",
            originSource: "collection",
            originCollection: "MONDO",
            originLimit: 2,
            previousPhaseId: null,
            settings: {
              graphType: "phenotypes",
              depth: 1,
              edgeDirection: "ANY",
              allowedCollections: ["MONDO"],
              setOperation: "Union",
              includeInterNodeEdges: false,
            },
          },
        ],
      }),
    );

    await store.dispatch(executePhase({ phaseId: "p1" }));

    expect(services.fetchGraphData).toHaveBeenCalledTimes(1);
    // Only the first 2 of the 5 collection docs become traversal origins.
    const params = services.fetchGraphData.mock.calls[0][0];
    expect(Object.keys(params.advancedSettings)).toHaveLength(2);
  });
});

describe("executePhase drops null nodes from server responses", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // A retired origin id makes the backend's DOCUMENT() lookup yield null, and
  // older deployments still ship that null inside the node list. Anything that
  // reads a property off each node (the results table does) dies on it, so the
  // store drops nulls before they reach the reducers.
  it("filters nulls out of the phase result", async () => {
    services.fetchGraphData.mockResolvedValue({
      "CSD/retired": {
        nodes: [null, { _id: "CL/real" }],
        links: [null, { _id: "CL-CL/e1", _from: "CL/real", _to: "CL/real" }],
      },
    });
    services.fetchEdgesBetween.mockResolvedValue([]);

    const store = makeStore();
    store.dispatch(
      loadWorkflow({
        phases: [
          {
            id: "p1",
            originSource: "manual",
            originNodeIds: ["CSD/retired"],
            previousPhaseId: null,
            settings: {
              graphType: "phenotypes",
              depth: 1,
              edgeDirection: "INBOUND",
              allowedCollections: ["CL"],
              setOperation: "Union",
              includeInterNodeEdges: false,
            },
          },
        ],
      }),
    );

    const action = await store.dispatch(executePhase({ phaseId: "p1" }));

    expect(action.payload.result.nodes).not.toContain(null);
    expect(action.payload.result.links).not.toContain(null);
    expect(action.payload.result.nodes).toEqual([{ _id: "CL/real" }]);
  });
});

describe("executePhase sanitizes nulls on the Intersection with Origins path", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // This branch reads the raw server response directly rather than the merged
  // graphs, so it needs the same null handling: scanning for the origin node
  // reads a property off every entry and dies on a null.
  it("does not throw when a response carries a null node", async () => {
    services.fetchGraphData.mockResolvedValue({
      "CL/origin": {
        nodes: [null, { _id: "CL/origin" }, { _id: "CL/shared" }],
        links: [null, { _id: "CL-CL/e1", _from: "CL/origin", _to: "CL/shared" }],
      },
      "CL/other": {
        nodes: [{ _id: "CL/shared" }],
        links: [],
      },
    });
    services.fetchEdgesBetween.mockResolvedValue([]);

    const store = makeStore();
    store.dispatch(
      loadWorkflow({
        phases: [
          {
            id: "p1",
            originSource: "manual",
            originNodeIds: ["CL/origin", "CL/other"],
            previousPhaseId: null,
            settings: {
              graphType: "ontologies",
              depth: 1,
              edgeDirection: "ANY",
              allowedCollections: ["CL"],
              setOperation: "Intersection with Origins",
              includeInterNodeEdges: false,
            },
          },
        ],
      }),
    );

    const action = await store.dispatch(executePhase({ phaseId: "p1" }));

    expect(action.error).toBeUndefined();
    expect(action.payload.result.nodes).not.toContain(null);
    expect(action.payload.result.links).not.toContain(null);
    // The origin is absent from the intersection and must be added back.
    expect(action.payload.result.nodes.map((n) => n._id)).toContain("CL/origin");
  });
});

describe("loadWorkflow unknown labels", () => {
  it("carries unknown_labels onto the workflow state", () => {
    const reducer = workflowBuilderReducer;
    const state = reducer(
      undefined,
      loadWorkflow({ id: "uc4", name: "UC4", phases: [], unknown_labels: ["MEMBER_OF"] }),
    );
    expect(state.unknownLabels).toEqual(["MEMBER_OF"]);
  });

  it("defaults to an empty list when the field is absent", () => {
    const reducer = workflowBuilderReducer;
    const state = reducer(undefined, loadWorkflow({ id: "uc4", name: "UC4", phases: [] }));
    expect(state.unknownLabels).toEqual([]);
  });

  it("clears a previous workflow's flags", () => {
    const reducer = workflowBuilderReducer;
    const flagged = reducer(
      undefined,
      loadWorkflow({ id: "a", phases: [], unknown_labels: ["MEMBER_OF"] }),
    );
    const clean = reducer(flagged, loadWorkflow({ id: "b", phases: [] }));
    expect(clean.unknownLabels).toEqual([]);
  });

  it("clears flags when starting a new workflow from scratch", () => {
    const reducer = workflowBuilderReducer;
    const flagged = reducer(
      undefined,
      loadWorkflow({ id: "a", phases: [], unknown_labels: ["MEMBER_OF"] }),
    );
    const fresh = reducer(flagged, initializeWorkflow());
    expect(fresh.unknownLabels).toEqual([]);
  });
});

describe("executePhase resolves the nonOriginNodes originFilter", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const settings = {
    graphType: "ontologies",
    depth: 1,
    edgeDirection: "ANY",
    allowedCollections: ["CL"],
    setOperation: "Union",
    includeInterNodeEdges: false,
  };

  // Phase 1 starts from CL/1 and discovers CL/2 and CL/3. Phase 2 chains off it,
  // so the filter decides which of those three become phase 2's origins.
  const originsForPhaseTwo = async (originFilter) => {
    services.fetchGraphData
      .mockResolvedValueOnce({
        "CL/1": { nodes: [{ _id: "CL/1" }, { _id: "CL/2" }, { _id: "CL/3" }], links: [] },
      })
      .mockResolvedValueOnce({
        "CL/2": { nodes: [{ _id: "CL/2" }], links: [] },
        "CL/3": { nodes: [{ _id: "CL/3" }], links: [] },
      });
    if (services.fetchEdgesBetween) services.fetchEdgesBetween.mockResolvedValue([]);

    const store = makeStore();
    store.dispatch(
      loadWorkflow({
        phases: [
          {
            id: "p1",
            originSource: "manual",
            originNodeIds: ["CL/1"],
            previousPhaseId: null,
            settings,
          },
          {
            id: "p2",
            originSource: "previousPhase",
            previousPhaseId: "p1",
            originFilter,
            originNodeIds: [],
            settings,
          },
        ],
      }),
    );

    await store.dispatch(executePhase({ phaseId: "p1" }));
    await store.dispatch(executePhase({ phaseId: "p2" }));
    return [...services.fetchGraphData.mock.calls[1][0].nodeIds].sort();
  };

  it("drops the origin node under nonOriginNodes", async () => {
    expect(await originsForPhaseTwo("nonOriginNodes")).toEqual(["CL/2", "CL/3"]);
  });

  it("drops the origin node under the leafNodes alias", async () => {
    // Pinned separately: the two names must not drift apart, and leafNodes is
    // the one the UI actually emits today.
    expect(await originsForPhaseTwo("leafNodes")).toEqual(["CL/2", "CL/3"]);
  });

  it("keeps the origin node under the all filter", async () => {
    // Contrast case: before the alias was handled, "nonOriginNodes" fell through
    // to this branch and silently produced a larger query than asked for.
    expect(await originsForPhaseTwo("all")).toEqual(["CL/1", "CL/2", "CL/3"]);
  });
});

describe("executePhase honours per-node depth on Connected Paths", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const loadConnectedPathsPhase = (store, { depth, perNodeSettings }) =>
    store.dispatch(
      loadWorkflow({
        phases: [
          {
            id: "p1",
            originSource: "manual",
            originNodeIds: ["UBERON/0001004", "CL/0000066"],
            previousPhaseId: null,
            showAdvancedSettings: true,
            perNodeSettings,
            settings: {
              graphType: "phenotypes",
              depth,
              edgeDirection: "INBOUND",
              allowedCollections: [],
              setOperation: "Connected Paths",
              includeInterNodeEdges: false,
            },
          },
        ],
      }),
    );

  it("searches at the largest per-node depth, not the shared depth", async () => {
    services.fetchConnectingPaths.mockResolvedValue({
      nodes: [{ _id: "UBERON/0001004" }, { _id: "CL/0000066" }],
      links: [],
    });

    const store = makeStore();
    loadConnectedPathsPhase(store, {
      depth: 2,
      perNodeSettings: {
        "UBERON/0001004": { depth: 4 },
        "CL/0000066": { depth: 4 },
      },
    });

    await store.dispatch(executePhase({ phaseId: "p1" }));

    expect(services.fetchConnectingPaths).toHaveBeenCalledTimes(1);
    expect(services.fetchConnectingPaths.mock.calls[0][0].maxDepth).toBe(4);
  });

  it("takes the maximum when per-node depths differ", async () => {
    services.fetchConnectingPaths.mockResolvedValue({
      nodes: [{ _id: "UBERON/0001004" }, { _id: "CL/0000066" }],
      links: [],
    });

    const store = makeStore();
    loadConnectedPathsPhase(store, {
      depth: 2,
      perNodeSettings: {
        "UBERON/0001004": { depth: 4 },
        "CL/0000066": { depth: 3 },
      },
    });

    await store.dispatch(executePhase({ phaseId: "p1" }));

    expect(services.fetchConnectingPaths.mock.calls[0][0].maxDepth).toBe(4);
  });

  it("falls back to the shared depth when a node has no override", async () => {
    services.fetchConnectingPaths.mockResolvedValue({
      nodes: [{ _id: "UBERON/0001004" }, { _id: "CL/0000066" }],
      links: [],
    });

    const store = makeStore();
    loadConnectedPathsPhase(store, { depth: 2, perNodeSettings: {} });

    await store.dispatch(executePhase({ phaseId: "p1" }));

    expect(services.fetchConnectingPaths.mock.calls[0][0].maxDepth).toBe(2);
  });

  it("reports the depth actually searched when no paths are found", async () => {
    services.fetchConnectingPaths.mockResolvedValue({ nodes: [], links: [] });

    const store = makeStore();
    loadConnectedPathsPhase(store, {
      depth: 2,
      perNodeSettings: {
        "UBERON/0001004": { depth: 4 },
        "CL/0000066": { depth: 4 },
      },
    });

    const action = await store.dispatch(executePhase({ phaseId: "p1" }));

    expect(action.error.message).toContain("depth 4");
  });
});
