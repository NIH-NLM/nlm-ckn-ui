import { configureStore } from "@reduxjs/toolkit";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import nodesReducer from "../../store/nodesSlice";
import { ToastProvider } from "../Toast";
import Tree from "./Tree";

const testStore = () =>
  configureStore({
    reducer: { nodesSlice: nodesReducer },
    preloadedState: { nodesSlice: { originNodeIds: [] } },
  });

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

const wrapTree = (props) => (
  <Provider store={testStore()}>
    <MemoryRouter>
      <ToastProvider>
        <Tree {...props} />
      </ToastProvider>
    </MemoryRouter>
  </Provider>
);

const renderTree = (props) => render(wrapTree(props));

const sharedCell = {
  _id: "CL/0000003",
  label: "test cell 0000003",
  descendant_count: 0,
  weight: 1,
  value: 1,
  _hasChildren: false,
  children: [],
};

// Seed shape from Task 1: root with two children that both carry the same
// (DAG-shared) child. `_id` repeats across the two occurrences on purpose --
// that repetition is exactly what broke the old id-keyed expansion state.
const twoParentFixture = {
  _id: "CL/0000000",
  label: "cell",
  descendant_count: 3,
  weight: 1,
  value: 1,
  _hasChildren: true,
  children: [
    {
      _id: "CL/0000001",
      label: "test cell 0000001",
      descendant_count: 1,
      weight: 1,
      value: 1,
      _hasChildren: true,
      children: [{ ...sharedCell }],
    },
    {
      _id: "CL/0000002",
      label: "test cell 0000002",
      descendant_count: 1,
      weight: 1,
      value: 1,
      _hasChildren: true,
      children: [{ ...sharedCell }],
    },
  ],
};

describe("Tree Component", () => {
  test("reports the full path when a node is expanded", async () => {
    const onExpandedPathsChange = jest.fn();

    // Pre-expand the root and the first parent so the shared child under
    // CL/0000001 is on screen. CL/0000002's own copy of the shared child
    // stays collapsed, so exactly one occurrence of the shared label renders.
    renderTree({
      data: twoParentFixture,
      fetchChildren: jest.fn().mockResolvedValue([]),
      expandedPaths: [["CL/0000000"], ["CL/0000000", "CL/0000001"]],
      onExpandedPathsChange,
    });

    // Expand the shared node under the FIRST parent.
    // The click handler is bound to the enclosing node group; the label
    // itself renders twice (a white text-outline clone plus the real text),
    // so pick the first match rather than asserting a single unique node.
    const [target] = await screen.findAllByText(/^test cell 0000003/);
    fireEvent.click(target);

    expect(onExpandedPathsChange).toHaveBeenCalledWith([
      ["CL/0000000"],
      ["CL/0000000", "CL/0000001"],
      ["CL/0000000", "CL/0000001", "CL/0000003"],
    ]);
  });

  test("expanding one occurrence of a shared node does not expand the other", async () => {
    const onExpandedPathsChange = jest.fn();

    // Pre-expand both parents, so both occurrences of the shared child are
    // reachable. Give each occurrence a distinct label only so the click
    // target is unambiguous -- the underlying `_id` is still shared, which is
    // the case this test exists to cover.
    const bothParentsExpandedFixture = {
      ...twoParentFixture,
      children: [
        {
          ...twoParentFixture.children[0],
          children: [{ ...sharedCell, label: "shared under parent one" }],
        },
        {
          ...twoParentFixture.children[1],
          children: [{ ...sharedCell, label: "shared under parent two" }],
        },
      ],
    };

    renderTree({
      data: bothParentsExpandedFixture,
      fetchChildren: jest.fn().mockResolvedValue([]),
      expandedPaths: [["CL/0000000"], ["CL/0000000", "CL/0000001"], ["CL/0000000", "CL/0000002"]],
      onExpandedPathsChange,
    });

    const [target] = await screen.findAllByText("shared under parent two");
    fireEvent.click(target);

    expect(onExpandedPathsChange).toHaveBeenCalledWith([
      ["CL/0000000"],
      ["CL/0000000", "CL/0000001"],
      ["CL/0000000", "CL/0000002"],
      ["CL/0000000", "CL/0000002", "CL/0000003"],
    ]);
  });

  test("collapses an already-expanded node on a second click", async () => {
    const onExpandedPathsChange = jest.fn();

    renderTree({
      data: twoParentFixture,
      fetchChildren: jest.fn().mockResolvedValue([]),
      expandedPaths: [["CL/0000000"], ["CL/0000000", "CL/0000001"]],
      onExpandedPathsChange,
    });

    const [target] = await screen.findAllByText("test cell 0000001");
    fireEvent.click(target);

    expect(onExpandedPathsChange).toHaveBeenCalledWith([["CL/0000000"]]);
  });

  test("two occurrences of one shared node each keep their own add-to-graph button", async () => {
    const bothParentsExpanded = [
      ["CL/0000000"],
      ["CL/0000000", "CL/0000001"],
      ["CL/0000000", "CL/0000002"],
    ];

    const { rerender } = renderTree({
      data: twoParentFixture,
      fetchChildren: jest.fn().mockResolvedValue([]),
      expandedPaths: bothParentsExpanded,
      onExpandedPathsChange: jest.fn(),
    });

    // Every visible node gets its own portal-mounted button: root, both
    // parents, and both occurrences of the shared child (CL/0000003) -- 5
    // nodes. If the map were keyed by bare id, the two CL/0000003 entries
    // would collide and only one button would render.
    await waitFor(() => {
      expect(document.querySelectorAll(".add-to-graph-button")).toHaveLength(5);
    });

    // Collapse only the first occurrence's parent (CL/0000001), hiding its
    // copy of the shared child. The second occurrence, still expanded under
    // CL/0000002, must keep its button: root, both parents, and one
    // remaining occurrence of the shared child -- 4 nodes.
    rerender(
      wrapTree({
        data: twoParentFixture,
        fetchChildren: jest.fn().mockResolvedValue([]),
        expandedPaths: [["CL/0000000"], ["CL/0000000", "CL/0000002"]],
        onExpandedPathsChange: jest.fn(),
      }),
    );

    await waitFor(() => {
      expect(document.querySelectorAll(".add-to-graph-button")).toHaveLength(4);
    });
  });

  describe("standalone (no data prop)", () => {
    let originalFetch;

    beforeEach(() => {
      originalFetch = global.fetch;
      global.fetch = jest.fn(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          statusText: "OK",
          json: () => Promise.resolve({ ...twoParentFixture, children: [] }),
        }),
      );
    });

    afterEach(() => {
      global.fetch = originalFetch;
    });

    test("fetches its own root from /arango_api/hierarchy/ with the given label", async () => {
      renderTree({ label: "SUB_CLASS_OF" });

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          expect.stringContaining("/arango_api/hierarchy/"),
          expect.objectContaining({
            body: JSON.stringify({ label: "SUB_CLASS_OF", parent_id: null }),
          }),
        );
      });
    });

    test("applies the response for the latest label, not a slower earlier one", async () => {
      let resolveA;
      let resolveB;
      const promiseA = new Promise((resolve) => {
        resolveA = resolve;
      });
      const promiseB = new Promise((resolve) => {
        resolveB = resolve;
      });

      global.fetch = jest.fn((_url, options) => {
        const body = JSON.parse(options.body);
        const wait = body.label === "LABEL_A" ? promiseA : promiseB;
        const rootLabel = body.label === "LABEL_A" ? "root A" : "root B";
        return wait.then(() => ({
          ok: true,
          status: 200,
          statusText: "OK",
          json: () => Promise.resolve({ ...twoParentFixture, label: rootLabel, children: [] }),
        }));
      });

      const { rerender } = renderTree({ label: "LABEL_A" });
      await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));

      // Switch labels before the first (slower) request resolves.
      rerender(wrapTree({ label: "LABEL_B" }));
      await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));

      // Resolve the superseded request first and let React flush its state
      // update, so we can observe whether the stale response was applied
      // before the latest request ever resolves.
      await act(async () => {
        resolveA();
      });
      expect(screen.queryAllByText("root A")).toHaveLength(0);

      // Now resolve the latest request and confirm its data renders.
      await act(async () => {
        resolveB();
      });

      await waitFor(() => {
        expect(screen.queryAllByText("root B").length).toBeGreaterThan(0);
      });
      expect(screen.queryAllByText("root A")).toHaveLength(0);
    });
  });
});
