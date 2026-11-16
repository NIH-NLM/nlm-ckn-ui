import { configureStore } from "@reduxjs/toolkit";
import workflowBuilderReducer, {
  initializeWorkflow,
  loadWorkflow,
  removePhase,
  setSolutionPhase,
} from "./workflowBuilderSlice";

const makeStore = () => configureStore({ reducer: { workflowBuilder: workflowBuilderReducer } });
const solution = (store) => store.getState().workflowBuilder.solution;
const phases = [{ id: "p1" }, { id: "p2" }, { id: "p3" }];

describe("workflow solution", () => {
  it("marks a phase as the solution and clears it", () => {
    const store = makeStore();
    store.dispatch(setSolutionPhase("p2"));
    expect(solution(store)).toEqual({
      phaseId: "p2",
      collection: null,
      linkedColumns: [],
      fields: null,
    });
    store.dispatch(setSolutionPhase(null));
    expect(solution(store)).toBeNull();
  });

  it("loads a solution from a workflow and replaces a previous one", () => {
    const store = makeStore();
    store.dispatch(setSolutionPhase("p2"));
    store.dispatch(loadWorkflow({ phases, solution: { phaseId: "p1", collection: "CS" } }));
    expect(solution(store)).toEqual({
      phaseId: "p1",
      collection: "CS",
      linkedColumns: [],
      fields: null,
    });
    store.dispatch(loadWorkflow({ phases }));
    expect(solution(store)).toBeNull();
  });

  it("keeps every part of a loaded solution", () => {
    const store = makeStore();
    const loaded = {
      phaseId: "p1",
      collection: "CS",
      linkedColumns: [{ path: [{ label: "COMPOSED_PRIMARILY_OF", collection: "CL" }] }],
      fields: ["author_cell_term"],
    };
    store.dispatch(loadWorkflow({ phases, solution: loaded }));
    expect(solution(store)).toEqual(loaded);
  });

  it("drops a loaded solution whose phase is not in the workflow", () => {
    const store = makeStore();
    store.dispatch(loadWorkflow({ phases, solution: { phaseId: "missing" } }));
    expect(solution(store)).toBeNull();
  });

  it("loads a workflow with no solution and a phase without an id", () => {
    const store = makeStore();
    store.dispatch(loadWorkflow({ phases: [{}] }));
    expect(solution(store)).toBeNull();
  });

  it("drops the solution when its phase is removed, not another", () => {
    const store = makeStore();
    store.dispatch(loadWorkflow({ phases, solution: { phaseId: "p2" } }));
    store.dispatch(removePhase("p3"));
    expect(solution(store).phaseId).toBe("p2");
    store.dispatch(removePhase("p2"));
    expect(solution(store)).toBeNull();
  });

  it("resets on initializeWorkflow", () => {
    const store = makeStore();
    store.dispatch(setSolutionPhase("p1"));
    store.dispatch(initializeWorkflow());
    expect(solution(store)).toBeNull();
  });
});
