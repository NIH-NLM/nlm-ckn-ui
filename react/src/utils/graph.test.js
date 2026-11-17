import { mergeChildren, phaseOriginsIn } from "./graph";

describe("mergeChildren", () => {
  test("merges children into every node sharing the target id, not just the first", () => {
    // The Cell Ontology's SUB_CLASS_OF relation is a DAG, not a strict tree:
    // a term can be SUB_CLASS_OF more than one parent, so the same _id can
    // legitimately appear at more than one position once it is flattened into
    // a displayable tree (e.g. "myeloid cell" under both "eukaryotic cell"
    // and "hematopoietic cell"). Merging fetched children into only the
    // first-found occurrence leaves the other occurrence stuck without
    // children, which is what the sunburst zooms into when a user drills
    // through the second occurrence.
    const graphData = {
      _id: "CL/0000000",
      children: [
        {
          _id: "CL/0000255",
          children: [{ _id: "CL/0000763", _hasChildren: true, children: null }],
        },
        {
          _id: "CL/0000988",
          children: [{ _id: "CL/0000763", _hasChildren: true, children: null }],
        },
      ],
    };
    const fetchedChildren = [{ _id: "CL/0000764", _hasChildren: false, children: [] }];

    const merged = mergeChildren(graphData, "CL/0000763", fetchedChildren);

    const underFirstParent = merged.children[0].children[0];
    const underSecondParent = merged.children[1].children[0];
    expect(underFirstParent.children).toEqual(fetchedChildren);
    expect(underSecondParent.children).toEqual(fetchedChildren);
  });

  test("leaves the tree unchanged and warns when the id is not present", () => {
    const graphData = { _id: "CL/0000000", children: [] };
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});

    const merged = mergeChildren(graphData, "CL/9999999", [{ _id: "CL/0000001" }]);

    expect(merged).toEqual(graphData);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

describe("phaseOriginsIn", () => {
  const graph = { nodes: [{ _id: "CL/1" }, { _id: "CS/2" }], links: [] };

  test("keeps a step's executed origins that are nodes of its result", () => {
    const phase = { _executedOriginNodeIds: ["CL/1", "CL/9"], originNodeIds: ["CS/2"] };
    expect(phaseOriginsIn(phase, graph)).toEqual(["CL/1"]);
  });

  test("drops the step ids a combine step records as its origins", () => {
    const phase = { _executedOriginNodeIds: ["preset-a", "preset-b"] };
    expect(phaseOriginsIn(phase, graph)).toEqual([]);
  });

  test("falls back to the configured origins, and to none", () => {
    expect(phaseOriginsIn({ originNodeIds: ["CS/2"] }, graph)).toEqual(["CS/2"]);
    expect(phaseOriginsIn(undefined, graph)).toEqual([]);
    expect(phaseOriginsIn({ originNodeIds: ["CS/2"] }, null)).toEqual([]);
  });
});
