import {
  buildAdjacency,
  buildEdgePool,
  buildNodeIndex,
  byStrength,
  formatLinkedLabels,
  humanizeEdgeLabel,
  listLinkOptions,
  neighborsByRelationship,
  pickRowCollection,
  rankLinked,
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
    const unlabeled = { _from: "A/1", _to: "B/1" };
    expect(
      buildEdgePool({ p: { links: [unlabeled, { ...unlabeled, Label: "undefined" }] } }),
    ).toHaveLength(2);
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

describe("rankLinked and byStrength", () => {
  const expresses = (cs, gene) => edge(`x${cs}`, `CS/${cs}`, `GS/${gene}`, "EXPRESSES");
  const derives = (cs, organ) => edge(`d${cs}`, `CS/${cs}`, `UBERON/${organ}`, "DERIVES_FROM");
  const toOrgans = [
    { label: "EXPRESSES", collection: "CS" },
    { label: "DERIVES_FROM", collection: "UBERON" },
  ];

  it("counts the routes that reach each node", () => {
    const a = adjOf([
      ...[1, 2, 3].map((cs) => expresses(cs, "CFTR")),
      derives(1, "liver"),
      derives(2, "lung"),
      derives(3, "lung"),
    ]);
    expect(rankLinked("GS/CFTR", toOrgans, a)).toEqual([
      { id: "UBERON/liver", routes: 1, score: null },
      { id: "UBERON/lung", routes: 2, score: null },
    ]);
  });

  it("counts a self-loop once per step", () => {
    const a = adjOf([edge("e1", "A/1", "A/1", "X"), edge("e2", "A/1", "B/1", "Y")]);
    const path = [
      { label: "X", collection: "A" },
      { label: "Y", collection: "B" },
    ];
    expect(rankLinked("A/1", path, a)).toEqual([{ id: "B/1", routes: 1, score: null }]);
  });

  it("keeps the highest numeric last-hop score and ignores text", () => {
    const hasFeature = (id, mondo, Score) => ({
      ...edge(id, `MONDO/${mondo}`, "GS/CFTR", "HAS_FEATURE"),
      Score,
    });
    const a = adjOf([
      hasFeature("h1", "cf", "0.5"),
      hasFeature("h2", "cf", "0.92"),
      hasFeature("h3", "ali", "n/a"),
    ]);
    const ranked = rankLinked("GS/CFTR", [{ label: "HAS_FEATURE", collection: "MONDO" }], a);
    expect(ranked).toEqual([
      { id: "MONDO/cf", routes: 2, score: 0.92 },
      { id: "MONDO/ali", routes: 1, score: null },
    ]);
  });

  it("orders by score, then routes, then label", () => {
    const n = (label, routes, score = null) => ({ label, routes, score });
    const sorted = [n("b", 1), n("a", 1), n("c", 6), n("d", 1, 0.5), n("e", 1, 0.9)].sort(
      byStrength,
    );
    expect(sorted.map((x) => x.label)).toEqual(["e", "d", "c", "a", "b"]);
  });
});

describe("listLinkOptions", () => {
  it("lists an unlabeled hop that resolvePath can follow", () => {
    const a = buildAdjacency(buildEdgePool({ p: { links: [{ _from: "A/1", _to: "B/1" }] } }));
    const [option] = listLinkOptions(["A/1"], a);
    expect(option).toEqual({ label: undefined, collection: "B", count: 1 });
    expect(resolvePath("A/1", [option], a)).toEqual(["B/1"]);
  });

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

describe("neighborsByRelationship and buildNodeIndex", () => {
  it("groups neighbors by label and direction", () => {
    expect(neighborsByRelationship("PR/P1", adj)).toEqual([
      { label: "MOLECULARLY_INTERACTS_WITH", direction: "in", nodeIds: ["CHEMBL/1"] },
      { label: "PRODUCES", direction: "in", nodeIds: ["GS/CFTR"] },
    ]);
    expect(neighborsByRelationship("zzz", adj)).toEqual([]);
  });

  it("keeps an edge without a label apart and sorts it without throwing", () => {
    const unlabeled = buildAdjacency(
      buildEdgePool({
        a: {
          links: [
            edge("e9", "A/1", "B/1"),
            edge("e8", "A/1", "B/2", "X"),
            edge("e7", "B/3", "A/1"),
            edge("e6", "A/1", "B/4", "undefined"),
          ],
        },
      }),
    );
    expect(neighborsByRelationship("A/1", unlabeled).map((g) => g.label)).toEqual([
      undefined,
      undefined,
      "undefined",
      "X",
    ]);
  });

  it("indexes nodes from phases and details", () => {
    const idx = buildNodeIndex(phaseResults, { "X/1": { _id: "X/1" } });
    expect(idx.get("CHEMBL/1").label).toBe("drug");
    expect(idx.has("X/1")).toBe(true);
    expect(idx.has("PR/P1")).toBe(true);
  });
});

describe("display helpers", () => {
  const nodes = [{ _id: "CS/1" }, { _id: "CS/2" }, { _id: "CL/1" }];
  it("picks the row collection", () => {
    expect(pickRowCollection(nodes, null)).toBe("CS");
    expect(pickRowCollection(nodes, "CL")).toBe("CL");
    expect(pickRowCollection(nodes, "UBERON")).toBe("CS");
    expect(pickRowCollection([], null)).toBeNull();
  });

  it("formats linked labels", () => {
    expect(formatLinkedLabels(["a", "b", "c", "d", "e"])).toBe("a, b, c +2");
    expect(formatLinkedLabels(["a", "b"])).toBe("a, b");
    expect(formatLinkedLabels([])).toBe("–");
  });

  it("humanizes edge labels", () => {
    expect(humanizeEdgeLabel("COMPOSED_PRIMARILY_OF")).toBe("Composed primarily of");
  });
});
