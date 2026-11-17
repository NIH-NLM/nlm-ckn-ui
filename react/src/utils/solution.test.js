import {
  buildAdjacency,
  buildEdgePool,
  buildNodeIndex,
  listLinkOptions,
  resolvePath,
} from "./solution";

const edge = (_id, _from, _to, Label) => ({ _id, _from, _to, Label });
const interacts = edge("e1", "CHEMBL/1", "PR/P1", "MOLECULARLY_INTERACTS_WITH");
const produces = edge("e2", "GS/CFTR", "PR/P1", "PRODUCES");

const phaseResults = {
  a: { nodes: [{ _id: "CHEMBL/1", label: "drug" }], links: [interacts, produces] },
  b: { nodes: [{ _id: "GS/CFTR" }], links: [produces] },
  c: null,
  d: { nodes: [{ _id: "PR/P1" }] },
};

const adjOf = (links) => buildAdjacency(buildEdgePool({ p: { links } }));
const adj = buildAdjacency(buildEdgePool(phaseResults));

describe("buildEdgePool", () => {
  it("dedupes edges across phases and tolerates missing data", () => {
    expect(buildEdgePool(phaseResults)).toHaveLength(2);
  });

  it("dedupes by from|label|to when _id is absent and skips partial links", () => {
    const l = { _from: "A/1", _to: "B/1", Label: "X" };
    const pool = buildEdgePool({
      p: { links: [l, { ...l }, { _from: "A/1", Label: "X" }, { _to: "B/1" }] },
    });
    expect(pool).toEqual([{ id: undefined, from: "A/1", to: "B/1", label: "X" }]);
  });
});

describe("resolvePath", () => {
  it("follows edges forward, counting a duplicated edge once", () => {
    const path = [
      { label: "MOLECULARLY_INTERACTS_WITH", collection: "PR" },
      { label: "PRODUCES", collection: "GS" },
    ];
    expect(resolvePath("CHEMBL/1", path, adj)).toEqual(["GS/CFTR"]);
  });

  it("follows edges in reverse", () => {
    const path = [
      { label: "PRODUCES", collection: "PR" },
      { label: "MOLECULARLY_INTERACTS_WITH", collection: "CHEMBL" },
    ];
    expect(resolvePath("GS/CFTR", path, adj)).toEqual(["CHEMBL/1"]);
  });

  it("never returns the starting row, even when a path loops back to it", () => {
    const loop = [
      { label: "PRODUCES", collection: "PR" },
      { label: "PRODUCES", collection: "GS" },
    ];
    expect(resolvePath("GS/CFTR", loop, adj)).toEqual([]);
    const twoGenes = adjOf([produces, edge("e3", "GS/OTHER", "PR/P1", "PRODUCES")]);
    expect(resolvePath("GS/CFTR", loop, twoGenes)).toEqual(["GS/OTHER"]);
  });

  it("returns nothing for an unknown row", () => {
    expect(resolvePath("nope/1", [{ label: "PRODUCES", collection: "GS" }], adj)).toEqual([]);
  });
});

describe("listLinkOptions", () => {
  it("lists first hops and next hops after a prefix", () => {
    expect(listLinkOptions(["CHEMBL/1"], adj)).toEqual([
      { label: "MOLECULARLY_INTERACTS_WITH", collection: "PR", count: 1 },
    ]);
    const next = listLinkOptions(["CHEMBL/1"], adj, [
      { label: "MOLECULARLY_INTERACTS_WITH", collection: "PR" },
    ]);
    expect(next).toContainEqual({ label: "PRODUCES", collection: "GS", count: 1 });
  });

  it("sorts by count descending", () => {
    const a = adjOf([
      edge("1", "A/1", "B/1", "R1"),
      edge("2", "A/1", "C/1", "R2"),
      edge("3", "A/2", "C/2", "R2"),
    ]);
    const opts = listLinkOptions(["A/1", "A/2"], a);
    expect(opts[0]).toEqual({ label: "R2", collection: "C", count: 2 });
    expect(opts[1].count).toBe(1);
  });

  it("lists next hops after a prefix that returns to the row", () => {
    const prefix = ["B", "A"].map((collection) => ({ label: "R", collection }));
    const opts = listLinkOptions(["A/1"], adjOf([edge("1", "A/1", "B/1", "R")]), prefix);
    expect(opts).toEqual([{ label: "R", collection: "B", count: 1 }]);
  });
});

describe("buildNodeIndex", () => {
  it("indexes nodes from phases and details", () => {
    const idx = buildNodeIndex(phaseResults, { "X/1": { _id: "X/1" } });
    expect(idx.get("CHEMBL/1").label).toBe("drug");
    expect(idx.has("X/1")).toBe(true);
    expect(idx.has("PR/P1")).toBe(true);
  });
});
