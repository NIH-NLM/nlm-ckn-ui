import reducer, {
  addHistoryEntry,
  deleteHistoryEntry,
  restoreHistoryEntry,
  selectOriginHistory,
  setActiveHistory,
} from "./savedGraphsSlice";

const entry = (originId, nodeIds) => ({
  id: `h-${originId}`,
  originId,
  label: originId,
  timestamp: "t",
  thumbnail: null,
  subgraph: {
    nodes: nodeIds.map((n) => ({ _id: n, id: n, x: 1, y: 2 })),
    links: [],
  },
});

describe("originHistory", () => {
  it("addHistoryEntry appends and does not duplicate the same origin", () => {
    let s = reducer(undefined, addHistoryEntry(entry("A", ["A", "n1"])));
    s = reducer(s, addHistoryEntry(entry("A", ["A", "n1"])));
    expect(s.originHistory).toHaveLength(1);
    s = reducer(s, addHistoryEntry(entry("B", ["B", "n2"])));
    expect(s.originHistory.map((e) => e.originId)).toEqual(["A", "B"]);
  });

  it("addHistoryEntry does not store a checked field", () => {
    const s = reducer(undefined, addHistoryEntry({ ...entry("A", ["A"]), checked: true }));
    expect(s.originHistory[0].checked).toBeUndefined();
  });

  it("addHistoryEntry marks the new entry active", () => {
    const s = reducer(undefined, addHistoryEntry(entry("A", ["A"])));
    expect(s.activeHistoryId).toBe("h-A");
  });

  it("addHistoryEntry re-activates an already-tracked origin without duplicating", () => {
    let s = reducer(undefined, addHistoryEntry(entry("A", ["A"])));
    s = reducer(s, addHistoryEntry(entry("B", ["B"])));
    expect(s.activeHistoryId).toBe("h-B");
    s = reducer(s, addHistoryEntry(entry("A", ["A"]))); // dup origin
    expect(s.originHistory).toHaveLength(2);
    expect(s.activeHistoryId).toBe("h-A"); // focus returns to A
  });

  it("deleteHistoryEntry removes it", () => {
    let s = reducer(undefined, addHistoryEntry(entry("A", ["A"])));
    s = reducer(s, deleteHistoryEntry("h-A"));
    expect(s.originHistory).toHaveLength(0);
  });

  it("deleteHistoryEntry clears activeHistoryId when deleting the active entry", () => {
    let s = reducer(undefined, addHistoryEntry(entry("A", ["A"])));
    s = reducer(s, setActiveHistory("h-A"));
    expect(s.activeHistoryId).toBe("h-A");
    s = reducer(s, deleteHistoryEntry("h-A"));
    expect(s.originHistory).toHaveLength(0);
    expect(s.activeHistoryId).toBeNull();
  });

  it("deleteHistoryEntry leaves activeHistoryId unchanged when deleting a different entry", () => {
    let s = reducer(undefined, addHistoryEntry(entry("A", ["A"])));
    s = reducer(s, addHistoryEntry(entry("B", ["B"])));
    s = reducer(s, setActiveHistory("h-A"));
    s = reducer(s, deleteHistoryEntry("h-B"));
    expect(s.activeHistoryId).toBe("h-A");
  });

  it("setActiveHistory sets activeHistoryId", () => {
    const s = reducer(undefined, setActiveHistory("h-A"));
    expect(s.activeHistoryId).toBe("h-A");
  });

  it("restoreHistoryEntry dispatches setGraphData and marks the entry active", () => {
    let state = reducer(undefined, addHistoryEntry(entry("A", ["A", "n1"])));
    const dispatch = jest.fn((action) => {
      if (typeof action === "function") return action(dispatch, getState);
      state = reducer(state, action);
      return action;
    });
    const getState = () => ({ savedGraphs: state });

    restoreHistoryEntry("h-A")(dispatch, getState);

    expect(state.activeHistoryId).toBe("h-A");
    const setGraphDataCall = dispatch.mock.calls.find(
      ([action]) => action.type === "graph/setGraphData",
    );
    expect(setGraphDataCall).toBeDefined();
    expect(setGraphDataCall[0].payload.isRestore).toBe(true);
  });

  it("restoreHistoryEntry is a no-op for an unknown id", () => {
    const state = reducer(undefined, addHistoryEntry(entry("A", ["A"])));
    const dispatch = jest.fn();
    const getState = () => ({ savedGraphs: state });

    restoreHistoryEntry("missing")(dispatch, getState);

    expect(dispatch).not.toHaveBeenCalled();
  });
});

describe("selectOriginHistory", () => {
  it("returns the history array from state", () => {
    const state = reducer(undefined, addHistoryEntry(entry("A", ["A"])));
    expect(selectOriginHistory({ savedGraphs: state })).toHaveLength(1);
  });
});
