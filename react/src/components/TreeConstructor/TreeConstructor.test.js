import { render } from "@testing-library/react";
import TreeConstructor from "./TreeConstructor";

// jsdom does not implement SVGTransformList, which d3-interpolate's "transform"
// interpolator relies on when animating a <g transform="..."> attribute via
// transition. Stub it to fall through to the identity transform so tree
// updates run without throwing; positions are not asserted by these tests.
beforeAll(() => {
  Object.defineProperty(SVGElement.prototype, "transform", {
    configurable: true,
    get() {
      return { baseVal: { consolidate: () => null } };
    },
  });
});

// root -> [child1, child2]; child1 -> [grandchild]. Expanding child1 should
// only ever introduce the grandchild -- root, child1 and child2 are already
// on screen and must not be re-entered.
const treeData = {
  _id: "CL/0000000",
  label: "root",
  _hasChildren: true,
  children: [
    {
      _id: "CL/0000001",
      label: "child one",
      _hasChildren: true,
      children: [{ _id: "CL/0000003", label: "grandchild", _hasChildren: false, children: [] }],
    },
    { _id: "CL/0000002", label: "child two", _hasChildren: false, children: [] },
  ],
};

describe("TreeConstructor Component", () => {
  test("expanding a node only enters its new children, and does not exit unrelated nodes", () => {
    const onNodeEnter = jest.fn();
    const onNodeExit = jest.fn();

    const { rerender } = render(
      <TreeConstructor
        data={treeData}
        onNodeEnter={onNodeEnter}
        onNodeExit={onNodeExit}
        expandedPaths={[["CL/0000000"]]}
        onToggle={jest.fn()}
      />,
    );

    // Initial render: root, child one, child two all enter.
    expect(onNodeEnter).toHaveBeenCalledTimes(3);
    onNodeEnter.mockClear();
    onNodeExit.mockClear();

    // Expand child one -- only the grandchild should enter. Root, child one
    // and child two are already visible and must not re-enter or exit.
    rerender(
      <TreeConstructor
        data={treeData}
        onNodeEnter={onNodeEnter}
        onNodeExit={onNodeExit}
        expandedPaths={[["CL/0000000"], ["CL/0000000", "CL/0000001"]]}
        onToggle={jest.fn()}
      />,
    );

    expect(onNodeEnter).toHaveBeenCalledTimes(1);
    expect(onNodeEnter).toHaveBeenCalledWith(
      ["CL/0000000", "CL/0000001", "CL/0000003"],
      expect.anything(),
    );
    expect(onNodeExit).not.toHaveBeenCalled();
  });

  test("two visible occurrences of the same node id are reported with distinct paths", () => {
    const sharedChild = {
      _id: "CL/0000009",
      label: "shared",
      _hasChildren: false,
      children: [],
    };
    const dagData = {
      _id: "CL/0000000",
      label: "root",
      _hasChildren: true,
      children: [
        {
          _id: "CL/0000001",
          label: "parent a",
          _hasChildren: true,
          children: [{ ...sharedChild }],
        },
        {
          _id: "CL/0000002",
          label: "parent b",
          _hasChildren: true,
          children: [{ ...sharedChild }],
        },
      ],
    };
    const onNodeEnter = jest.fn();

    render(
      <TreeConstructor
        data={dagData}
        onNodeEnter={onNodeEnter}
        onNodeExit={jest.fn()}
        expandedPaths={[["CL/0000000"], ["CL/0000000", "CL/0000001"], ["CL/0000000", "CL/0000002"]]}
        onToggle={jest.fn()}
      />,
    );

    const paths = onNodeEnter.mock.calls.map(([path]) => path);
    expect(paths).toContainEqual(["CL/0000000", "CL/0000001", "CL/0000009"]);
    expect(paths).toContainEqual(["CL/0000000", "CL/0000002", "CL/0000009"]);
  });
});
