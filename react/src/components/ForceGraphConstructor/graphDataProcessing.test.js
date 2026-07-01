import { findLeafNodes } from "./graphDataProcessing";

// Characterization tests pinning the current behavior of findLeafNodes so the
// workflow-init collapse path has a regression net to lean on.
describe("findLeafNodes", () => {
  it("returns [] when mode='standard' and collapseNodes is empty", () => {
    const nodes = [{ id: "A" }, { id: "B" }];
    const links = [{ source: "A", target: "B" }];
    expect(findLeafNodes(nodes, links, [], [], "standard")).toEqual([]);
  });

  it("collapses a leaf in 'standard' mode when the single neighbor IS in collapseNodes", () => {
    const nodes = [{ id: "A" }, { id: "B" }];
    const links = [{ source: "A", target: "B" }];
    // B has one neighbor (A), and A is in collapseNodes → B is a leaf.
    expect(findLeafNodes(nodes, links, ["A"], [], "standard")).toEqual(["B"]);
  });

  it("does NOT collapse a leaf in 'standard' mode whose single neighbor is an origin (origin not in collapseNodes)", () => {
    const nodes = [{ id: "ORIGIN" }, { id: "LEAF" }];
    const links = [{ source: "ORIGIN", target: "LEAF" }];
    // Origin is excluded from collapseNodes per the workflow build pattern;
    // 'standard' mode requires the neighbor to be in collapseNodes.
    const result = findLeafNodes(nodes, links, ["LEAF"], ["ORIGIN"], "standard");
    expect(result).toEqual([]);
  });

  it("collapses every single-neighbor non-origin node in 'all' mode, including one whose only neighbor is an origin", () => {
    const nodes = [
      { id: "ORIGIN" },
      { id: "LEAF_OF_ORIGIN" },
      { id: "INNER" },
      { id: "LEAF_OF_INNER" },
    ];
    const links = [
      { source: "ORIGIN", target: "LEAF_OF_ORIGIN" },
      { source: "ORIGIN", target: "INNER" },
      { source: "INNER", target: "LEAF_OF_INNER" },
    ];
    // 'all' mode ignores collapseNodes membership for the neighbor check.
    const result = findLeafNodes(
      nodes,
      links,
      ["LEAF_OF_ORIGIN", "INNER", "LEAF_OF_INNER"],
      ["ORIGIN"],
      "all",
    );
    expect(result).toEqual(expect.arrayContaining(["LEAF_OF_ORIGIN", "LEAF_OF_INNER"]));
    expect(result).not.toContain("ORIGIN");
    // INNER has two distinct neighbors (ORIGIN, LEAF_OF_INNER) so it is not a leaf.
    expect(result).not.toContain("INNER");
  });

  it("never collapses origin nodes themselves", () => {
    const nodes = [{ id: "ORIGIN" }, { id: "ONLY_NEIGHBOR" }];
    // ORIGIN has a single neighbor — would be a leaf if it weren't an origin.
    const links = [{ source: "ORIGIN", target: "ONLY_NEIGHBOR" }];
    const result = findLeafNodes(nodes, links, ["ONLY_NEIGHBOR"], ["ORIGIN"], "all");
    expect(result).not.toContain("ORIGIN");
  });

  it("does NOT treat a node with two distinct neighbors as a leaf", () => {
    const nodes = [{ id: "A" }, { id: "B" }, { id: "C" }];
    const links = [
      { source: "A", target: "B" },
      { source: "B", target: "C" },
    ];
    // B has two distinct neighbors (A, C) — not a leaf in either mode.
    expect(findLeafNodes(nodes, links, ["A", "C"], [], "standard")).not.toContain("B");
    expect(findLeafNodes(nodes, links, ["A", "C"], [], "all")).not.toContain("B");
  });

  it("treats a node with multiple links to the SAME neighbor as a leaf", () => {
    const nodes = [{ id: "A" }, { id: "B" }];
    // Two parallel links between A and B (e.g., distinct predicates).
    const links = [
      { source: "A", target: "B" },
      { source: "A", target: "B" },
    ];
    expect(findLeafNodes(nodes, links, ["A"], [], "standard")).toEqual(["B"]);
  });
});
