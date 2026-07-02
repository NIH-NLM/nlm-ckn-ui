import { splitEdgeFiltersByMode } from "./edgeFilters";

describe("splitEdgeFiltersByMode", () => {
  it("routes include-mode categorical fields to include", () => {
    const { include, exclude } = splitEdgeFiltersByMode({ Label: ["IS_A"] }, { Label: "include" });
    expect(include).toEqual({ Label: ["IS_A"] });
    expect(exclude).toEqual({});
  });

  it("routes exclude-mode categorical fields to exclude", () => {
    const { include, exclude } = splitEdgeFiltersByMode(
      { Label: ["DERIVES_FROM"] },
      { Label: "exclude" },
    );
    expect(include).toEqual({});
    expect(exclude).toEqual({ Label: ["DERIVES_FROM"] });
  });

  it("defaults missing mode to include", () => {
    const { include, exclude } = splitEdgeFiltersByMode({ Source: ["X"] }, {});
    expect(include).toEqual({ Source: ["X"] });
    expect(exclude).toEqual({});
  });

  it("keeps numeric range filters in include regardless of mode", () => {
    const { include, exclude } = splitEdgeFiltersByMode(
      { score: { min: 0.5, max: 1 } },
      { score: "exclude" },
    );
    expect(include).toEqual({ score: { min: 0.5, max: 1 } });
    expect(exclude).toEqual({});
  });

  it("handles undefined/empty inputs without throwing", () => {
    expect(splitEdgeFiltersByMode()).toEqual({ include: {}, exclude: {} });
    expect(splitEdgeFiltersByMode({}, {})).toEqual({ include: {}, exclude: {} });
  });
});
