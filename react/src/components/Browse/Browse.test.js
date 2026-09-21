import { configureStore } from "@reduxjs/toolkit";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import nodesReducer from "../../store/nodesSlice";
import { ToastProvider } from "../Toast";
import Browse from "./Browse";

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

const renderBrowse = (initialEntry = "/browse") =>
  render(
    <Provider store={testStore()}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <ToastProvider>
          <Browse />
        </ToastProvider>
      </MemoryRouter>
    </Provider>,
  );

const root = {
  _id: "CL/0000000",
  label: "cell",
  descendant_count: 2,
  weight: 2,
  value: 2,
  _hasChildren: true,
  children: [
    {
      _id: "CL/0000001",
      label: "test cell 0000001",
      descendant_count: 1,
      weight: 1,
      value: 1,
      _hasChildren: true,
      children: null,
    },
  ],
};

const grandchild = [
  {
    _id: "CL/0000003",
    label: "test cell 0000003",
    descendant_count: 0,
    weight: 1,
    value: 1,
    _hasChildren: false,
    children: null,
  },
];

// Two sibling branches, each already carrying its own child, so expanding
// them in the tree needs no fetch -- isolates the multi-branch expansion
// behavior from the merge/fetch machinery covered by the tests above.
const branchingRoot = {
  _id: "CL/0000000",
  label: "cell",
  descendant_count: 4,
  weight: 1,
  value: 1,
  _hasChildren: true,
  children: [
    {
      _id: "CL/0000010",
      label: "branch a",
      descendant_count: 1,
      weight: 1,
      value: 1,
      _hasChildren: true,
      children: [
        {
          _id: "CL/0000011",
          label: "leaf a1",
          descendant_count: 0,
          weight: 1,
          value: 1,
          _hasChildren: false,
          children: [],
        },
      ],
    },
    {
      _id: "CL/0000020",
      label: "branch b",
      descendant_count: 1,
      weight: 1,
      value: 1,
      _hasChildren: true,
      children: [
        {
          _id: "CL/0000021",
          label: "leaf b1",
          descendant_count: 0,
          weight: 1,
          value: 1,
          _hasChildren: false,
          children: [],
        },
      ],
    },
  ],
};

describe("Browse", () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    global.fetch = jest.fn((url, options) => {
      if (url.includes("/hierarchy/labels/")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve([{ label: "SUB_CLASS_OF", root: "CL/0000000" }]),
        });
      }
      const body = options?.body ? JSON.parse(options.body) : {};
      if (body.parent_id === null) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(root) });
      }
      if (body.parent_id === "CL/0000001") {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(grandchild) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test("defaults to the tree when no view is requested", async () => {
    renderBrowse();
    await screen.findAllByText("cell");

    // The tree draws a node's label twice (outline pass, then fill pass); the
    // sunburst draws each arc's label once and its center text separately.
    // Two matches for a child label means the tree is the view on screen.
    expect(await screen.findAllByText(/^test cell 0000001/)).toHaveLength(2);
    expect(screen.getByRole("button", { name: /tree/i })).toHaveClass("active");
  });

  test("keeps loaded children and focus when the view toggles", async () => {
    renderBrowse("/browse?view=sunburst");
    await screen.findAllByText("cell");

    fireEvent.click(await screen.findByText(/^test cell 0000001/));
    // Wait for the drill-in fetch's merge to actually land in state -- the
    // newly centered node's child arc appears once it has -- before
    // counting requests.
    await screen.findByText(/^test cell 0000003/);
    const callsAfterExpand = global.fetch.mock.calls.length;

    fireEvent.click(screen.getByRole("button", { name: /tree/i }));

    // The tree renders the expanded node without refetching it. Each node's
    // label is drawn twice (an outline pass then a fill pass), so this
    // checks that some match exists rather than exactly one.
    expect(await screen.findAllByText(/^test cell 0000003/)).not.toHaveLength(0);
    expect(global.fetch.mock.calls.length).toBe(callsAfterExpand);
  });

  test("hand-off: focusing a node in the sunburst opens that path in the tree", async () => {
    renderBrowse("/browse?view=sunburst");
    await screen.findAllByText("cell");

    fireEvent.click(await screen.findByText(/^test cell 0000001/));
    await screen.findByText(/^test cell 0000003/);

    fireEvent.click(screen.getByRole("button", { name: /tree/i }));

    // Both the focused node and its child are open -- the whole focus chain.
    expect(await screen.findAllByText(/^test cell 0000001/)).not.toHaveLength(0);
    expect(await screen.findAllByText(/^test cell 0000003/)).not.toHaveLength(0);
  });

  test("hand-off: toggling a path open in the tree then switching to the sunburst centers there", async () => {
    renderBrowse();
    await screen.findAllByText("cell");

    fireEvent.click(screen.getByRole("button", { name: /tree/i }));
    await screen.findAllByText("cell");

    const [target] = await screen.findAllByText(/^test cell 0000001/);
    fireEvent.click(target);
    await screen.findAllByText(/^test cell 0000003/);

    fireEvent.click(screen.getByRole("button", { name: /sunburst/i }));

    // The sunburst's center text (bold, distinct from an arc label) names the
    // node last toggled open in the tree, not the hierarchy root.
    await waitFor(() => {
      const svg = document.querySelector("svg");
      const centerText = Array.from(svg.querySelectorAll("text")).find(
        (t) => t.style.fontWeight === "bold",
      );
      expect(centerText?.textContent).toMatch(/^test cell 0000001/);
    });
  });

  test("keeps sibling branches open while working only in the tree", async () => {
    global.fetch = jest.fn((url) => {
      if (url.includes("/hierarchy/labels/")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve([{ label: "SUB_CLASS_OF", root: "CL/0000000" }]),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve(branchingRoot) });
    });

    renderBrowse();
    await screen.findAllByText("cell");

    fireEvent.click(screen.getByRole("button", { name: /tree/i }));
    await screen.findAllByText("branch a");

    // Expand both sibling branches in turn.
    const [branchA] = await screen.findAllByText("branch a");
    fireEvent.click(branchA);
    await screen.findAllByText("leaf a1");

    const [branchB] = await screen.findAllByText("branch b");
    fireEvent.click(branchB);
    await screen.findAllByText("leaf b1");

    // Expanding branch b did not close branch a -- both stay open at once,
    // exactly as standalone /tree behaves today.
    expect(screen.queryAllByText("leaf a1").length).toBeGreaterThan(0);
    expect(screen.queryAllByText("leaf b1").length).toBeGreaterThan(0);
  });
});

describe("Browse stale request guard", () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  // Shares node id CL/0000001 with `root` -- the same CL node can sit under
  // more than one hierarchy predicate -- so a stale merge under label B has
  // somewhere real to (wrongly) land, rather than being harmlessly dropped
  // by mergeChildren's "parent not found" path.
  const rootB = {
    _id: "CL/0000900",
    label: "other root",
    descendant_count: 1,
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
        children: null,
      },
    ],
  };

  test("a child fetch that resolves after the label switches never reaches the new label's data", async () => {
    let resolveChildA;
    const childAResponse = new Promise((resolve) => {
      resolveChildA = resolve;
    });

    global.fetch = jest.fn((url, options) => {
      if (url.includes("/hierarchy/labels/")) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve([
              { label: "SUB_CLASS_OF", root: "CL/0000000" },
              { label: "PART_OF", root: "CL/0000900" },
            ]),
        });
      }
      const body = options?.body ? JSON.parse(options.body) : {};
      if (body.label === "SUB_CLASS_OF" && body.parent_id === null) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(root) });
      }
      if (body.label === "SUB_CLASS_OF" && body.parent_id === "CL/0000001") {
        // Stays pending until resolveChildA() is called below, so the test
        // controls exactly when this response lands relative to the label
        // switch.
        return childAResponse.then(() => ({
          ok: true,
          json: () => Promise.resolve(grandchild),
        }));
      }
      if (body.label === "PART_OF" && body.parent_id === null) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(rootB) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
    });

    // Pinned to the sunburst: this test clicks one arc to start a single
    // child fetch, and the tree draws each label twice.
    renderBrowse("/browse?view=sunburst");
    await screen.findAllByText("cell");

    // Start a child fetch under label A (SUB_CLASS_OF) that will not resolve
    // until resolveChildA() is called.
    fireEvent.click(await screen.findByText(/^test cell 0000001/));

    // Switch to label B while A's child fetch is still in flight, and let
    // B's root load.
    fireEvent.change(screen.getByLabelText(/hierarchy/i), {
      target: { value: "PART_OF" },
    });
    await screen.findAllByText("other root");

    // Now let A's stale child response resolve, and flush the microtasks its
    // resolution schedules (including any -- correct or not -- state
    // update) before asserting anything.
    await act(async () => {
      resolveChildA();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    // Assert right here, at the moment the stale response resolves: A's
    // children must not have merged into B's data. Waiting until the end of
    // the test would let an implementation that briefly merges them and then
    // "corrects" itself pass anyway.
    expect(screen.queryByText(/^test cell 0000003/)).not.toBeInTheDocument();
    expect(screen.queryAllByText("other root").length).toBeGreaterThan(0);
  });

  // Mirror-image of the test above: here it's the ROOT load for the new
  // label that is slow, not a child fetch under the old one. If `data`
  // stayed on label A's hierarchy until B's root arrived, the user could
  // click a still-rendered A node while waiting, and that click's
  // `fetchChildren` would capture label B and the post-switch generation --
  // passing the staleness check -- so its response could merge into B's
  // data once it lands. Asserting A is gone before B resolves is what rules
  // that out.
  test("switching labels clears the previous hierarchy before the new root arrives", async () => {
    let resolveRootB;
    const rootBResponse = new Promise((resolve) => {
      resolveRootB = resolve;
    });

    global.fetch = jest.fn((url, options) => {
      if (url.includes("/hierarchy/labels/")) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve([
              { label: "SUB_CLASS_OF", root: "CL/0000000" },
              { label: "PART_OF", root: "CL/0000900" },
            ]),
        });
      }
      const body = options?.body ? JSON.parse(options.body) : {};
      if (body.label === "SUB_CLASS_OF" && body.parent_id === null) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(root) });
      }
      if (body.label === "PART_OF" && body.parent_id === null) {
        // Stays pending until resolveRootB() is called below, so the test
        // controls exactly when B's root lands relative to the switch.
        return rootBResponse.then(() => ({
          ok: true,
          json: () => Promise.resolve(rootB),
        }));
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
    });

    renderBrowse();
    await screen.findAllByText("cell");

    // Switch to label B while its root fetch is still in flight.
    fireEvent.change(screen.getByLabelText(/hierarchy/i), {
      target: { value: "PART_OF" },
    });

    // A's hierarchy must already be gone -- not just about to be replaced --
    // so there is no A node left on screen to click while B's root is
    // pending.
    await waitFor(() => {
      expect(screen.queryByText(/^cell$/)).not.toBeInTheDocument();
      expect(screen.queryByText(/^test cell 0000001/)).not.toBeInTheDocument();
    });

    // Now let B's root resolve, and confirm B renders.
    await act(async () => {
      resolveRootB();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(await screen.findAllByText("other root")).not.toHaveLength(0);
  });
});

describe("Browse error state", () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test("shows the configured label when no hierarchy predicate is present", async () => {
    global.fetch = jest.fn((url) => {
      if (url.includes("/hierarchy/labels/")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve(null) });
    });

    renderBrowse();

    const banner = await screen.findByRole("alert");
    expect(banner).toHaveTextContent("SUB_CLASS_OF");
  });
});
