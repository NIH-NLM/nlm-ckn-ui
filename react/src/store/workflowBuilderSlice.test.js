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
const { default: workflowBuilderReducer, executePhase, loadWorkflow } = slice;

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
