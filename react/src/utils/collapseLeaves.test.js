import { applyCollapse } from "./collapseLeaves";

// origin -> hub, and hub -> leaf1 / leaf2. Under "standard" collapse a leaf's
// single neighbour must itself be a non-origin, so the two nodes hanging off
// the hub drop out while the origin-adjacent hub survives.
const graphData = {
  nodes: [{ _id: "CL/origin" }, { _id: "CL/hub" }, { _id: "CL/leaf1" }, { _id: "CL/leaf2" }],
  links: [
    { _id: "e1", _from: "CL/origin", _to: "CL/hub" },
    { _id: "e2", _from: "CL/hub", _to: "CL/leaf1" },
    { _id: "e3", _from: "CL/hub", _to: "CL/leaf2" },
  ],
};

describe("applyCollapse", () => {
  it("returns the graph untouched when collapse is off", () => {
    expect(applyCollapse(graphData, "off", ["CL/origin"])).toBe(graphData);
  });

  it("returns the graph untouched when there are no nodes", () => {
    const empty = { nodes: [], links: [] };
    expect(applyCollapse(empty, "standard", [])).toBe(empty);
  });

  it("drops leaf nodes hanging off a non-origin neighbour", () => {
    const result = applyCollapse(graphData, "standard", ["CL/origin"]);

    expect(result.nodes.map((n) => n._id)).toEqual(["CL/origin", "CL/hub"]);
  });

  it("drops the edges attached to collapsed leaves", () => {
    const result = applyCollapse(graphData, "standard", ["CL/origin"]);

    expect(result.links.map((l) => l._id)).toEqual(["e1"]);
  });

  it("keeps origin-adjacent leaves under standard collapse", () => {
    const chain = {
      nodes: [{ _id: "CL/origin" }, { _id: "CL/leaf" }],
      links: [{ _id: "e1", _from: "CL/origin", _to: "CL/leaf" }],
    };

    const result = applyCollapse(chain, "standard", ["CL/origin"]);

    expect(result.nodes.map((n) => n._id)).toEqual(["CL/origin", "CL/leaf"]);
  });

  it("collapses origin-adjacent leaves under all", () => {
    const chain = {
      nodes: [{ _id: "CL/origin" }, { _id: "CL/leaf" }],
      links: [{ _id: "e1", _from: "CL/origin", _to: "CL/leaf" }],
    };

    const result = applyCollapse(chain, "all", ["CL/origin"]);

    expect(result.nodes.map((n) => n._id)).toEqual(["CL/origin"]);
  });

  it("never collapses an origin node", () => {
    const result = applyCollapse(graphData, "all", ["CL/origin", "CL/hub", "CL/leaf1", "CL/leaf2"]);

    expect(result.nodes).toHaveLength(4);
  });
});
