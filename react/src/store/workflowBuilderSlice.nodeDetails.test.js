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
const {
  default: workflowBuilderReducer,
  fetchNodeDetails,
  initializeWorkflow,
  selectFailedNodeIds,
  selectRequestedNodeIds,
} = slice;

const makeStore = () => configureStore({ reducer: { workflowBuilder: workflowBuilderReducer } });
const wb = (store) => store.getState().workflowBuilder;

// The origin chips fall back to the raw "UBERON/0001004" when the details
// cache has no document for an id, so the record of which ids have been
// requested has to be reset in step with that cache.
describe("node details request bookkeeping", () => {
  beforeEach(() => jest.clearAllMocks());

  it("marks ids as requested while the fetch is in flight", async () => {
    services.fetchNodeDetailsByIds.mockResolvedValue([]);
    const store = makeStore();

    const pending = store.dispatch(fetchNodeDetails({ nodeIds: ["UBERON/0001004"] }));
    expect(selectRequestedNodeIds(store.getState())).toContain("UBERON/0001004");
    await pending;
  });

  it("caches the fetched document under its id", async () => {
    services.fetchNodeDetailsByIds.mockResolvedValue([
      { _id: "UBERON/0001004", Label: "bronchus" },
    ]);
    const store = makeStore();

    await store.dispatch(fetchNodeDetails({ nodeIds: ["UBERON/0001004"] }));

    expect(wb(store).nodeDetails["UBERON/0001004"].Label).toBe("bronchus");
  });

  it("forgets the requested ids when the details cache is cleared", async () => {
    services.fetchNodeDetailsByIds.mockResolvedValue([
      { _id: "UBERON/0001004", Label: "bronchus" },
    ]);
    const store = makeStore();
    await store.dispatch(fetchNodeDetails({ nodeIds: ["UBERON/0001004"] }));

    store.dispatch(initializeWorkflow());

    expect(wb(store).nodeDetails).toEqual({});
    expect(selectRequestedNodeIds(store.getState())).toEqual([]);
  });

  it("re-fetches an id after the cache was cleared", async () => {
    services.fetchNodeDetailsByIds.mockResolvedValue([
      { _id: "UBERON/0001004", Label: "bronchus" },
    ]);
    const store = makeStore();
    await store.dispatch(fetchNodeDetails({ nodeIds: ["UBERON/0001004"] }));
    store.dispatch(initializeWorkflow());

    await store.dispatch(fetchNodeDetails({ nodeIds: ["UBERON/0001004"] }));

    expect(services.fetchNodeDetailsByIds).toHaveBeenCalledTimes(2);
    expect(wb(store).nodeDetails["UBERON/0001004"].Label).toBe("bronchus");
  });

  it("holds a failed id back until a new workflow starts, instead of re-requesting it", async () => {
    services.fetchNodeDetailsByIds.mockRejectedValue(new Error("network down"));
    const store = makeStore();

    await store.dispatch(fetchNodeDetails({ nodeIds: ["UBERON/0001004"] }));

    expect(selectRequestedNodeIds(store.getState())).not.toContain("UBERON/0001004");
    expect(selectFailedNodeIds(store.getState())).toContain("UBERON/0001004");

    store.dispatch(initializeWorkflow());
    expect(selectFailedNodeIds(store.getState())).toEqual([]);
  });

  it("does not let a stale failed request release an id a newer request owns", async () => {
    let rejectFirst;
    services.fetchNodeDetailsByIds
      .mockImplementationOnce(
        () =>
          new Promise((_, reject) => {
            rejectFirst = reject;
          }),
      )
      .mockImplementationOnce(() => new Promise(() => {}));
    const store = makeStore();

    const first = store.dispatch(fetchNodeDetails({ nodeIds: ["UBERON/0001004"] }));
    store.dispatch(initializeWorkflow());
    store.dispatch(fetchNodeDetails({ nodeIds: ["UBERON/0001004"] }));
    rejectFirst(new Error("network down"));
    await first;

    expect(selectRequestedNodeIds(store.getState())).toContain("UBERON/0001004");
    expect(selectFailedNodeIds(store.getState())).not.toContain("UBERON/0001004");
  });
});
