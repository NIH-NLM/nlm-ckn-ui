import { shouldClearWorkflowData } from "./shouldClearWorkflowData";

// Workflow results live in the graph slice under source "workflow". A graph
// page mounting over them must clear them; the Workflow Builder's own canvas
// must not, or it wipes the origins its Origins panel is there to list.
describe("shouldClearWorkflowData", () => {
  it("clears stale workflow data when a non-workflow host mounts over it", () => {
    expect(
      shouldClearWorkflowData({ hasNodes: true, source: "workflow", isWorkflowHost: false }),
    ).toBe(true);
  });

  it("keeps the data when the workflow builder is the host", () => {
    expect(
      shouldClearWorkflowData({ hasNodes: true, source: "workflow", isWorkflowHost: true }),
    ).toBe(false);
  });

  it("leaves non-workflow data alone", () => {
    expect(
      shouldClearWorkflowData({ hasNodes: true, source: "graph", isWorkflowHost: false }),
    ).toBe(false);
  });

  it("does nothing when there is no data to clear", () => {
    expect(
      shouldClearWorkflowData({ hasNodes: false, source: "workflow", isWorkflowHost: false }),
    ).toBe(false);
  });
});
