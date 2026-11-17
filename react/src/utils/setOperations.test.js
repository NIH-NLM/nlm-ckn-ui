import { performSetOperation } from "./setOperations";

const node = (n) => ({ _id: `CL/${n}` });
const link = (a, b) => ({ _id: `e/${a}-${b}`, _from: `CL/${a}`, _to: `CL/${b}` });

describe("performSetOperation Difference", () => {
  const A = { nodes: [1, 2, 3].map(node), links: [link(1, 2), link(1, 3), link(2, 3)] };
  const B = { nodes: [node(2)], links: [] };
  const C = { nodes: [node(3)], links: [] };

  it("keeps first-graph nodes found in no other graph", () => {
    const result = performSetOperation([A, B, C], "Difference");
    expect(result.nodes.map((n) => n._id)).toEqual(["CL/1"]);
    expect(result.links).toEqual([]);
  });

  it("keeps links whose ends both survive", () => {
    const result = performSetOperation([A, B], "difference");
    expect(result.nodes.map((n) => n._id)).toEqual(["CL/1", "CL/3"]);
    expect(result.links.map((l) => l._id)).toEqual(["e/1-3"]);
  });

  it("keeps a node the first graph repeats", () => {
    const result = performSetOperation([{ nodes: [node(1), node(1)], links: [] }, B], "Difference");
    expect(result.nodes.map((n) => n._id)).toEqual(["CL/1"]);
  });

  it("returns a single graph unchanged", () => {
    expect(performSetOperation([A], "Difference")).toBe(A);
  });
});
