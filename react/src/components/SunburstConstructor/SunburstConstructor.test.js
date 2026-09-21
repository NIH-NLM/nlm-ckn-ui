import SunburstConstructor from "./SunburstConstructor";

const refOf = (value) => ({ current: value });

const data = {
  _id: "CL/0000000",
  label: "cell",
  descendant_count: 3324,
  weight: 58,
  value: 58,
  _hasChildren: true,
  children: [
    {
      _id: "CL/0000001",
      label: "one child",
      descendant_count: 1,
      weight: 1,
      value: 1,
      _hasChildren: true,
      children: [],
    },
    {
      _id: "CL/0000002",
      label: "leaf",
      descendant_count: 0,
      weight: 1,
      value: 1,
      _hasChildren: false,
      children: [],
    },
  ],
};

describe("SunburstConstructor", () => {
  test("arc tooltips report the raw descendant count, not the weight, with sensible wording for 0/1/many", () => {
    const { svgNode } = SunburstConstructor(
      data,
      928,
      refOf(() => {}),
      refOf(() => {}),
      refOf(() => {}),
      null,
    );

    const titles = Array.from(svgNode.querySelectorAll("path title")).map((t) => t.textContent);

    expect(titles).toContain("cell (3,324 cell types)");
    expect(titles).toContain("one child (1 cell type)");
    expect(titles).toContain("leaf (0 cell types)");
    // The compressed weight (58, 1, 1) must never appear in place of the count.
    expect(titles.some((t) => t.includes("(58"))).toBe(false);
  });
});
