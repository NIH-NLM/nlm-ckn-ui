import { configureStore } from "@reduxjs/toolkit";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import collectionDefaults from "../../assets/collection-defaults.json";
import graphReducer, {
  loadGraph,
  setAvailableCollections,
  setGraphData,
} from "../../store/graphSlice";
import nodesReducer from "../../store/nodesSlice";
import savedGraphsReducer, {
  addHistoryEntry,
  restoreHistoryEntry,
  selectOriginHistory,
  setActiveHistory,
} from "../../store/savedGraphsSlice";
import { ToastProvider } from "../Toast";
import ForceGraph from "./ForceGraph";
import { useGraphExport } from "./hooks";

// Mock ResizeObserver for jsdom
global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

// jsdom does not implement the Blob URL APIs used by the graph export path
if (!global.URL.createObjectURL) {
  global.URL.createObjectURL = jest.fn(() => "blob:mock-url");
}
if (!global.URL.revokeObjectURL) {
  global.URL.revokeObjectURL = jest.fn();
}

// Capture the onNodeClick callback so tests can trigger the popup directly
let capturedOnNodeClick = null;
// Capture the onSimulationEnd callback so tests can drive a settle directly
let capturedOnSimulationEnd = null;
// Capture the full options object so tests can drive callbacks the D3 layer
// would normally fire (e.g. onLassoSelection at the end of a lasso drag).
let capturedOpts = null;

const mockGraphInstance = {
  updateGraph: jest.fn(),
  setLayoutMode: jest.fn(),
  toggleLabels: jest.fn(),
  toggleSimulation: jest.fn(),
  toggleFocusNodes: jest.fn(),
  updateNodeFontSize: jest.fn(),
  updateLinkFontSize: jest.fn(),
  restoreGraph: jest.fn(),
  resize: jest.fn(),
  getCurrentGraph: jest.fn(() => null),
  isDragging: jest.fn(() => false),
  setLassoMode: jest.fn(),
  setSelectedNodeIds: jest.fn(),
};

jest.mock("components/ForceGraphConstructor/ForceGraphConstructor", () => ({
  __esModule: true,
  default: jest.fn(),
}));

jest.mock("./hooks", () => {
  const actual = jest.requireActual("./hooks");
  return { ...actual, useGraphExport: jest.fn() };
});

// jsdom cannot rasterize SVG, so the real captureGraphThumbnail always rejects
// there. Mock it so history-capture tests get a deterministic, controllable
// thumbnail instead of a swallowed rejection.
jest.mock("utils", () => ({
  ...jest.requireActual("utils"),
  captureGraphThumbnail: jest.fn(() => Promise.resolve("mock-thumbnail")),
}));

const { captureGraphThumbnail } = require("utils");

const ForceGraphConstructorMock =
  require("components/ForceGraphConstructor/ForceGraphConstructor").default;

// Mock graph API services used by ForceGraph and its thunks
jest.mock("services", () => ({
  fetchNeighborCollections: jest.fn(),
  fetchNodeExpansion: jest.fn(),
  fetchGraphData: jest.fn(),
  fetchCollections: jest.fn(() => Promise.resolve([])),
  fetchEdgeFilterOptions: jest.fn(() => Promise.resolve([])),
  fetchConnectingPaths: jest.fn(),
  fetchEdgesBetween: jest.fn(),
  fetchDocument: jest.fn(),
  fetchNodeDetailsByIds: jest.fn(),
  executeAqlQuery: jest.fn(),
  fetchPredefinedQueries: jest.fn(),
  fetchCollectionDocuments: jest.fn(),
  searchDocuments: jest.fn(),
  fetchHierarchyData: jest.fn(),
  fetchWorkflowPresets: jest.fn(),
  ApiError: class ApiError extends Error {},
  fetchWithErrorHandling: jest.fn(),
  getJson: jest.fn(),
  postJson: jest.fn(),
}));

// Import mocked services after mock declaration for access in tests
const {
  fetchNeighborCollections,
  fetchNodeExpansion,
  fetchCollections,
  fetchEdgeFilterOptions,
  fetchGraphData,
} = require("services");

// Create a test store with all required slices
const createTestStore = () =>
  configureStore({
    reducer: {
      graph: graphReducer,
      nodesSlice: nodesReducer,
      savedGraphs: savedGraphsReducer,
    },
  });

// Create a store pre-populated with available collections so ForceGraphConstructor is created
const createStoreWithCollections = () => {
  const store = createTestStore();
  store.dispatch(setAvailableCollections(["CL", "UBERON", "GO"]));
  return store;
};

// Helper: render ForceGraph and open the popup for a node
const openNodePopup = async (store, nodeId = "CL/0000001") => {
  await act(async () => {
    render(
      <Provider store={store}>
        <MemoryRouter>
          <ToastProvider>
            <ForceGraph />
          </ToastProvider>
        </MemoryRouter>
      </Provider>,
    );
  });
  // ForceGraphConstructor is called during effect above; capturedOnNodeClick is now set
  // Fire a fake node click to open the popup
  await act(async () => {
    if (capturedOnNodeClick) {
      capturedOnNodeClick({ clientX: 100, clientY: 100 }, { _id: nodeId, label: "Test Node" });
    }
  });
};

describe("ForceGraph", () => {
  beforeEach(() => {
    capturedOnNodeClick = null;
    capturedOnSimulationEnd = null;
    capturedOpts = null;
    // Set up ForceGraphConstructor to capture callbacks and return the mock instance
    ForceGraphConstructorMock.mockImplementation((_svg, _data, opts) => {
      capturedOnNodeClick = opts.onNodeClick;
      capturedOnSimulationEnd = opts.onSimulationEnd;
      capturedOpts = opts;
      return mockGraphInstance;
    });
    // Reset mock call counts
    Object.values(mockGraphInstance).forEach((fn) => {
      if (fn.mockReset) fn.mockReset();
    });
    mockGraphInstance.getCurrentGraph.mockReturnValue(null);
    mockGraphInstance.isDragging.mockReturnValue(false);
    // Re-arm the export hook mock (resetMocks clears implementations between tests)
    useGraphExport.mockImplementation(() => jest.fn());
    // Default return values for service mocks
    fetchCollections.mockResolvedValue([]);
    fetchEdgeFilterOptions.mockResolvedValue([]);
    fetchNodeExpansion.mockResolvedValue({ nodes: [], links: [] });
    fetchNeighborCollections.mockResolvedValue([]);
    // Re-arm the thumbnail mock (resetMocks clears implementations between tests)
    captureGraphThumbnail.mockImplementation(() => Promise.resolve("mock-thumbnail"));
    // jsdom ships no Fullscreen API, and the canvas bar hides the button without one.
    Object.defineProperty(document, "fullscreenEnabled", { value: true, configurable: true });
  });

  // The canvas actions are icon-only, so the hover/focus note is the only thing
  // explaining them. data-tooltip drives the CSS bubble; aria-label stays the
  // accessible name. No native `title`, or the browser draws a second tooltip.
  it("gives every canvas action a hover note and no native title", () => {
    render(
      <Provider store={createTestStore()}>
        <ForceGraph onToggleOrigins={() => {}} />
      </Provider>,
    );

    const expected = [
      [/^origins \(\d+\)$/i, /^Origins \(\d+\)$/],
      [/^full screen$/i, /^Full screen/],
      [/^lasso select$/i, /select multiple nodes/i],
      [/^download graph$/i, /^Download graph/],
    ];

    for (const [name, tooltip] of expected) {
      const button = screen.getByRole("button", { name });
      expect(button).toHaveAttribute("data-tooltip", expect.stringMatching(tooltip));
      expect(button).not.toHaveAttribute("title");
    }
  });

  it("Should toggle options when toggle options button is clicked", () => {
    render(
      <Provider store={createTestStore()}>
        <ForceGraph title="Test Graph Title" />
      </Provider>,
    );

    // Get the button that toggles the options visibility
    // Button text is "Show Options" when closed, "Hide Options" when open
    const toggleButton = screen.getByRole("button", {
      name: /show options/i,
    });
    // Get the graph-options panel by its ID
    const optionsPanel = document.getElementById("graph-options-panel");

    // Ensure options begins hidden
    expect(optionsPanel).toHaveStyle("display: none");

    // Click button
    fireEvent.click(toggleButton);
    // After clicking, the options should be visible
    expect(optionsPanel).toHaveStyle("display: flex");

    // Click the toggle button again (now should say "Hide Options")
    const hideButton = screen.getByRole("button", {
      name: /hide options/i,
    });
    fireEvent.click(hideButton);
    // After clicking again, the options should be hidden
    expect(optionsPanel).toHaveStyle("display: none");
  });

  it("renders the graph title", () => {
    render(
      <Provider store={createTestStore()}>
        <ForceGraph title="Test Graph Title" />
      </Provider>,
    );

    expect(screen.getByRole("heading", { name: "Test Graph Title" })).toBeInTheDocument();
  });

  it("renders a download button on the canvas that triggers the export handler", () => {
    render(
      <Provider store={createTestStore()}>
        <ForceGraph title="Test Graph Title" />
      </Provider>,
    );

    const downloadButton = screen.getByRole("button", { name: /download graph/i });
    expect(downloadButton).toBeInTheDocument();

    const exportMock = useGraphExport.mock.results.at(-1).value;
    fireEvent.click(downloadButton);
    expect(exportMock).toHaveBeenCalledWith("png");
  });

  // The lasso auto-exits after a plain drag so pan/zoom resumes, but a
  // shift-drag means "keep adding" — disarming there strands the user, because
  // the next shift-drag is gated out by isEnabled() and gets handled by the
  // zoom behavior as a pan instead.
  describe("lasso selection", () => {
    const renderArmed = () => {
      const store = createStoreWithCollections();
      render(
        <Provider store={store}>
          <ForceGraph title="Test Graph Title" />
        </Provider>,
      );
      const lassoButton = () => screen.getByRole("button", { name: /lasso select/i });
      fireEvent.click(lassoButton());
      return { store, lassoButton };
    };

    it("stays armed after a shift-drag so consecutive drags accumulate", () => {
      const { store, lassoButton } = renderArmed();
      expect(lassoButton()).toHaveAttribute("aria-pressed", "true");
      const callsAtArming = mockGraphInstance.setLassoMode.mock.calls.length;

      act(() => {
        capturedOpts.onLassoSelection(["CL/A"], { shift: true });
      });
      expect(store.getState().graph.present.lassoSelectedNodeIds).toEqual(["CL/A"]);
      // Still armed — without this the next shift-drag never reaches the lasso.
      expect(lassoButton()).toHaveAttribute("aria-pressed", "true");
      // And the D3 layer was never disarmed. Assert on what happened SINCE
      // arming: staying armed is a no-op state update that React bails out of,
      // so there is no fresh setLassoMode(true) call to look for — checking the
      // last call would just re-read the arming click and pass vacuously.
      const sinceArming = mockGraphInstance.setLassoMode.mock.calls.slice(callsAtArming).flat();
      expect(sinceArming).not.toContain(false);

      // A second shift-drag, with no re-arming click in between.
      act(() => {
        capturedOpts.onLassoSelection(["CL/B"], { shift: true });
      });
      expect(store.getState().graph.present.lassoSelectedNodeIds).toEqual(["CL/A", "CL/B"]);
    });

    it("exits lasso mode after a plain drag so pan and zoom resume", () => {
      const { store, lassoButton } = renderArmed();

      act(() => {
        capturedOpts.onLassoSelection(["CL/A"], { shift: false });
      });
      expect(store.getState().graph.present.lassoSelectedNodeIds).toEqual(["CL/A"]);
      expect(lassoButton()).toHaveAttribute("aria-pressed", "false");
      expect(mockGraphInstance.setLassoMode).toHaveBeenLastCalledWith(false);
    });

    it("replaces the selection on a plain drag after a shift-drag", () => {
      const { store, lassoButton } = renderArmed();

      act(() => {
        capturedOpts.onLassoSelection(["CL/A"], { shift: true });
      });
      act(() => {
        capturedOpts.onLassoSelection(["CL/B"], { shift: false });
      });
      expect(store.getState().graph.present.lassoSelectedNodeIds).toEqual(["CL/B"]);
      expect(lassoButton()).toHaveAttribute("aria-pressed", "false");
    });
  });

  describe("Expand by Collection submenu", () => {
    it("shows the disclosure button when the node popup is open", async () => {
      fetchNeighborCollections.mockResolvedValue([]);
      const store = createStoreWithCollections();
      await openNodePopup(store);

      const disclosureBtn = screen.getByRole("button", {
        name: /expand by collection/i,
      });
      expect(disclosureBtn).toBeVisible();
      expect(disclosureBtn).toHaveAttribute("aria-haspopup", "menu");
      expect(disclosureBtn).toHaveAttribute("aria-expanded", "false");
    });

    it("populates the submenu with collection display labels after clicking the disclosure button", async () => {
      fetchNeighborCollections.mockResolvedValue(["CL", "UBERON"]);
      const store = createStoreWithCollections();
      await openNodePopup(store);

      const disclosureBtn = screen.getByRole("button", {
        name: /expand by collection/i,
      });

      await act(async () => {
        fireEvent.click(disclosureBtn);
      });

      await waitFor(() => {
        expect(screen.getByRole("menuitem", { name: /cell type/i })).toBeInTheDocument();
        expect(screen.getByRole("menuitem", { name: /anatomical structure/i })).toBeInTheDocument();
      });

      expect(disclosureBtn).toHaveAttribute("aria-expanded", "true");
    });

    it("triggers expandNode with collectionOverride when a collection item is clicked", async () => {
      fetchNeighborCollections.mockResolvedValue(["CL", "UBERON"]);
      fetchNodeExpansion.mockResolvedValue({ nodes: [], links: [] });
      const store = createStoreWithCollections();
      await openNodePopup(store, "GO/0000001");

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /expand by collection/i }));
      });

      await waitFor(() =>
        expect(screen.queryByRole("menuitem", { name: /cell type/i })).toBeInTheDocument(),
      );

      await act(async () => {
        fireEvent.click(screen.getByRole("menuitem", { name: /cell type/i }));
      });

      await waitFor(() => {
        // fetchNodeExpansion(nodeId, graphType, allowedCollections, includeInterNodeEdges, edgeFilters, excludeEdgeFilters, terminalCollections)
        expect(fetchNodeExpansion).toHaveBeenCalledWith(
          "GO/0000001",
          expect.any(String),
          ["CL"],
          expect.any(Boolean),
          expect.any(Object),
          {},
          // This store has no terminal collections set, so the exact value must
          // be the empty list -- expect.any(Array) would pass on a wrong-slot
          // regression that forwarded allowedCollections here.
          [],
        );
      });
    });

    it("forwards collapseNodes and collapseMode to updateGraph on workflow init", async () => {
      const store = createTestStore();
      const origin = { _id: "CL/0001", id: "CL/0001" };
      const leafA = { _id: "GO/0010", id: "GO/0010" };
      const leafB = { _id: "GO/0020", id: "GO/0020" };
      await act(async () => {
        store.dispatch(setAvailableCollections(["CL", "GO"]));
        store.dispatch(
          setGraphData({
            graphData: {
              nodes: [origin, leafA, leafB],
              links: [
                { source: "CL/0001", target: "GO/0010" },
                { source: "CL/0001", target: "GO/0020" },
              ],
            },
            originNodeIds: [origin._id],
            source: "workflow",
            collapseLeafNodes: "all",
          }),
        );
      });
      await act(async () => {
        render(
          <Provider store={store}>
            <MemoryRouter>
              <ToastProvider>
                <ForceGraph />
              </ToastProvider>
            </MemoryRouter>
          </Provider>,
        );
      });
      await waitFor(() => expect(mockGraphInstance.updateGraph).toHaveBeenCalled());
      const firstCall = mockGraphInstance.updateGraph.mock.calls[0][0];
      expect(firstCall.collapseMode).toBe("all");
      expect(firstCall.collapseNodes).toEqual(expect.arrayContaining([leafA._id, leafB._id]));
      expect(firstCall.collapseNodes).not.toContain(origin._id);
    });

    it("routes a restore render through restoreGraph, not updateGraph", async () => {
      const store = createStoreWithCollections();
      const origin = { _id: "CL/0001", id: "CL/0001", x: 10, y: 20 };
      const leaf = { _id: "GO/0010", id: "GO/0010", x: 30, y: 40 };
      await act(async () => {
        render(
          <Provider store={store}>
            <MemoryRouter>
              <ToastProvider>
                <ForceGraph />
              </ToastProvider>
            </MemoryRouter>
          </Provider>,
        );
      });
      mockGraphInstance.restoreGraph.mockClear();
      mockGraphInstance.updateGraph.mockClear();

      await act(async () => {
        store.dispatch(
          setGraphData({
            graphData: {
              nodes: [origin, leaf],
              links: [{ source: "CL/0001", target: "GO/0010" }],
            },
            isRestore: true,
          }),
        );
      });

      await waitFor(() => expect(mockGraphInstance.restoreGraph).toHaveBeenCalled());
      expect(mockGraphInstance.updateGraph).not.toHaveBeenCalled();
    });

    it("auto-captures a history entry once when a new origin resolves, and not again on re-resolve or restore", async () => {
      const store = createStoreWithCollections();
      const origin = { _id: "CL/0001", id: "CL/0001" };
      const leaf = { _id: "GO/0010", id: "GO/0010" };
      await act(async () => {
        render(
          <Provider store={store}>
            <MemoryRouter>
              <ToastProvider>
                <ForceGraph />
              </ToastProvider>
            </MemoryRouter>
          </Provider>,
        );
      });

      // First resolution of a new origin: history should gain exactly one entry.
      await act(async () => {
        store.dispatch(
          setGraphData({
            graphData: {
              nodes: [origin, leaf],
              links: [{ source: "CL/0001", target: "GO/0010" }],
            },
            originNodeIds: [origin._id],
          }),
        );
      });

      await waitFor(() => {
        const history = selectOriginHistory(store.getState());
        expect(history).toHaveLength(1);
        expect(history[0].originId).toBe(origin._id);
      });

      // Re-resolving the same origin must not add a duplicate entry.
      await act(async () => {
        store.dispatch(
          setGraphData({
            graphData: {
              nodes: [origin, leaf],
              links: [{ source: "CL/0001", target: "GO/0010" }],
            },
            originNodeIds: [origin._id],
          }),
        );
      });

      await waitFor(() => {
        expect(selectOriginHistory(store.getState())).toHaveLength(1);
      });

      // A restore render must not spawn a new history entry.
      await act(async () => {
        store.dispatch(
          setGraphData({
            graphData: {
              nodes: [origin, leaf],
              links: [{ source: "CL/0001", target: "GO/0010" }],
            },
            originNodeIds: [origin._id],
            isRestore: true,
          }),
        );
      });

      await waitFor(() => expect(mockGraphInstance.restoreGraph).toHaveBeenCalled());
      expect(selectOriginHistory(store.getState())).toHaveLength(1);
    });

    it("freezes the active entry when a new origin is added, before the new entry exists", async () => {
      // Pin the actual mechanism under test: the origin-transition effect
      // writes `activeHistoryIdRef.current = null` directly, one line before
      // it dispatches setActiveHistory(null). The dispatch alone would
      // eventually null the ref too (via the separate mirror effect at
      // ForceGraph.js:162-165), but only after a further render — and
      // act()'s flush-until-stable behavior means a settle driven from a
      // *separate* act() call can never observe that gap, since by then the
      // mirror has already caught up regardless of the direct write. To
      // reach the actual gap the direct write exists to close, this
      // middleware calls the settle from *inside* the setActiveHistory(null)
      // dispatch, before its reducer (and therefore the store update the
      // mirror effect depends on) has run. At that instant, only the direct
      // ref write — not the dispatch — can have protected A.
      let interceptSettle = null;
      const freezeInterceptorMiddleware = () => (next) => (action) => {
        if (interceptSettle && action.type === setActiveHistory.type && action.payload === null) {
          const settle = interceptSettle;
          interceptSettle = null;
          settle();
        }
        return next(action);
      };
      const store = configureStore({
        reducer: {
          graph: graphReducer,
          nodesSlice: nodesReducer,
          savedGraphs: savedGraphsReducer,
        },
        middleware: (getDefaultMiddleware) =>
          getDefaultMiddleware().concat(freezeInterceptorMiddleware),
      });
      store.dispatch(setAvailableCollections(["CL", "UBERON", "GO"]));

      const originA = { _id: "CL/0001", id: "CL/0001" };
      const originB = { _id: "CL/0002", id: "CL/0002" };
      captureGraphThumbnail.mockImplementationOnce(() => Promise.resolve("thumbnail-A"));
      await act(async () => {
        render(
          <Provider store={store}>
            <MemoryRouter>
              <ToastProvider>
                <ForceGraph />
              </ToastProvider>
            </MemoryRouter>
          </Provider>,
        );
      });

      await act(async () => {
        store.dispatch(
          setGraphData({
            graphData: { nodes: [originA], links: [] },
            originNodeIds: [originA._id],
          }),
        );
      });
      await waitFor(() => expect(selectOriginHistory(store.getState())).toHaveLength(1));
      const entryA = selectOriginHistory(store.getState())[0];
      expect(entryA.thumbnail).toBe("thumbnail-A");
      expect(store.getState().savedGraphs.activeHistoryId).toBe(entryA.id);

      // B's own capture is also held open, so its addHistoryEntry cannot
      // land (and re-point activeHistoryId) as a side channel either.
      let resolveThumbnailB;
      const thumbnailBPromise = new Promise((resolve) => {
        resolveThumbnailB = resolve;
      });
      captureGraphThumbnail.mockImplementationOnce(() => thumbnailBPromise);
      interceptSettle = () => capturedOnSimulationEnd([originA, originB], []);

      // Compose in a second origin. The freeze must happen synchronously with
      // the origin change, so a settle arriving before B's entry is created
      // cannot overwrite A's snapshot with the A+B graph.
      await act(async () => {
        store.dispatch(
          setGraphData({
            graphData: { nodes: [originA, originB], links: [] },
            originNodeIds: [originA._id, originB._id],
          }),
        );
      });

      expect(interceptSettle).toBeNull(); // confirms the settle actually fired mid-dispatch
      // This length check is a proxy for the real thing under test: if the
      // direct activeHistoryIdRef write is missing, the intercepted settle
      // sees a stale ref still pointing at A, so handleSimulationEnd treats A
      // as active and (via the mocked capture queue) causes B's entry to be
      // created here instead of staying pending — history grows to 2. A
      // failure on this line means the settle landed on the wrong/stale
      // active entry, not literally that a second card is undesirable in
      // isolation.
      expect(selectOriginHistory(store.getState())).toHaveLength(1);
      const afterFreeze = selectOriginHistory(store.getState()).find((e) => e.id === entryA.id);
      expect(afterFreeze.subgraph.nodes.map((n) => n._id)).toEqual([originA._id]);
      expect(afterFreeze.thumbnail).toBe("thumbnail-A");

      // Let B's capture resolve and its entry land.
      await act(async () => {
        resolveThumbnailB("thumbnail-B");
        await thumbnailBPromise;
      });

      // B still gets its own entry, and it becomes the active one.
      await waitFor(() => expect(selectOriginHistory(store.getState())).toHaveLength(2));
      const entryB = selectOriginHistory(store.getState())[1];
      expect(entryB.originId).toBe(originB._id);
      expect(entryB.thumbnail).toBe("thumbnail-B");
      expect(entryB.id).not.toBe(entryA.id);
      expect(store.getState().savedGraphs.activeHistoryId).toBe(entryB.id);
    });

    it("freezes and leaves nothing active when an origin is removed", async () => {
      const store = createStoreWithCollections();
      const originA = { _id: "CL/0001", id: "CL/0001" };
      const originB = { _id: "CL/0002", id: "CL/0002" };
      await act(async () => {
        render(
          <Provider store={store}>
            <MemoryRouter>
              <ToastProvider>
                <ForceGraph />
              </ToastProvider>
            </MemoryRouter>
          </Provider>,
        );
      });
      await act(async () => {
        store.dispatch(
          setGraphData({
            graphData: { nodes: [originA, originB], links: [] },
            originNodeIds: [originA._id, originB._id],
          }),
        );
      });
      await waitFor(() => expect(selectOriginHistory(store.getState())).toHaveLength(2));
      const before = selectOriginHistory(store.getState());

      // Drop B. No new origin, so nothing becomes active and no card is added.
      await act(async () => {
        store.dispatch(
          setGraphData({
            graphData: { nodes: [originA], links: [] },
            originNodeIds: [originA._id],
          }),
        );
      });
      await act(async () => {
        capturedOnSimulationEnd([originA], []);
      });

      expect(store.getState().savedGraphs.activeHistoryId).toBeNull();
      const after = selectOriginHistory(store.getState());
      expect(after).toHaveLength(2);
      expect(after.map((e) => e.subgraph.nodes.length)).toEqual(
        before.map((e) => e.subgraph.nodes.length),
      );
    });

    it("captures a second entry when an origin is removed and re-added", async () => {
      const store = createStoreWithCollections();
      const originA = { _id: "CL/0001", id: "CL/0001" };
      const originB = { _id: "CL/0002", id: "CL/0002" };
      await act(async () => {
        render(
          <Provider store={store}>
            <MemoryRouter>
              <ToastProvider>
                <ForceGraph />
              </ToastProvider>
            </MemoryRouter>
          </Provider>,
        );
      });
      const compose = async (nodes) => {
        await act(async () => {
          store.dispatch(
            setGraphData({
              graphData: { nodes, links: [] },
              originNodeIds: nodes.map((n) => n._id),
            }),
          );
        });
      };
      await compose([originA]);
      await waitFor(() => expect(selectOriginHistory(store.getState())).toHaveLength(1));
      await compose([originA, originB]);
      await waitFor(() => expect(selectOriginHistory(store.getState())).toHaveLength(2));
      await compose([originA]); // remove B — no capture
      await compose([originA, originB]); // re-add B — a second B card

      await waitFor(() => expect(selectOriginHistory(store.getState())).toHaveLength(3));
      const history = selectOriginHistory(store.getState());
      expect(history.map((e) => e.originId)).toEqual([originA._id, originB._id, originB._id]);
      expect(new Set(history.map((e) => e.id)).size).toBe(3);
    });

    it("does not duplicate a history entry when ForceGraph remounts with an origin already covered by history", async () => {
      // graph/savedGraphs state survives route changes (only nodesSlice is
      // persistence-whitelisted), so leaving /graph and returning remounts
      // ForceGraph while the store still holds live graphData and a history
      // entry for that origin. The first-run branch must not re-queue it —
      // otherwise, since Task 1 removed the reducer's originId dedupe, it
      // would append a duplicate card for a graph that already has one.
      const store = createStoreWithCollections();
      const origin = { _id: "CL/0001", id: "CL/0001" };
      let unmount;
      await act(async () => {
        ({ unmount } = render(
          <Provider store={store}>
            <MemoryRouter>
              <ToastProvider>
                <ForceGraph />
              </ToastProvider>
            </MemoryRouter>
          </Provider>,
        ));
      });
      await act(async () => {
        store.dispatch(
          setGraphData({ graphData: { nodes: [origin], links: [] }, originNodeIds: [origin._id] }),
        );
      });
      await waitFor(() => expect(selectOriginHistory(store.getState())).toHaveLength(1));

      unmount();

      // Remount into the same store — graphData and originNodeIds are still
      // live from before the unmount, exactly as GraphWorkspace/ForceGraph
      // remounting on a return to /graph would see.
      await act(async () => {
        render(
          <Provider store={store}>
            <MemoryRouter>
              <ToastProvider>
                <ForceGraph />
              </ToastProvider>
            </MemoryRouter>
          </Provider>,
        );
      });

      expect(selectOriginHistory(store.getState())).toHaveLength(1);
    });

    it("freezes a stale active entry on a fresh mount when its origin is already live", async () => {
      // GraphPage dispatches initializeGraph from the URL on mount, and
      // graph/savedGraphs both survive route changes. So ForceGraph can mount
      // fresh with an origin already live in the store and an unrelated (or
      // stale, or previously restored) entry still active for that same
      // origin. The first-run branch must freeze that entry before any
      // settle can reach it, even though it also decides not to re-queue a
      // capture for the already-covered origin.
      const store = createTestStore();
      store.dispatch(setAvailableCollections(["CL", "UBERON", "GO"]));
      const origin = { _id: "CL/0001", id: "CL/0001" };
      store.dispatch(
        addHistoryEntry({
          id: "entry-a",
          originId: origin._id,
          label: "Origin A",
          subgraph: { nodes: [origin], links: [] },
          thumbnail: "thumbnail-A",
          timestamp: new Date().toISOString(),
        }),
      );
      store.dispatch(
        setGraphData({
          graphData: { nodes: [origin], links: [] },
          originNodeIds: [origin._id],
        }),
      );
      expect(store.getState().savedGraphs.activeHistoryId).toBe("entry-a");

      await act(async () => {
        render(
          <Provider store={store}>
            <MemoryRouter>
              <ToastProvider>
                <ForceGraph />
              </ToastProvider>
            </MemoryRouter>
          </Provider>,
        );
      });

      // The first-run freeze must have already detached the stale entry —
      // no need to wait for a settle.
      expect(store.getState().savedGraphs.activeHistoryId).toBeNull();

      // A settle with a different node set must not reach entry-a.
      const differentNode = { _id: "CL/0001", id: "CL/0001", x: 50, y: 50 };
      await act(async () => {
        capturedOnSimulationEnd([differentNode], []);
      });

      const entryA = selectOriginHistory(store.getState()).find((e) => e.id === "entry-a");
      expect(entryA.subgraph.nodes).toEqual([origin]);
      expect(store.getState().savedGraphs.activeHistoryId).toBeNull();
      expect(selectOriginHistory(store.getState())).toHaveLength(1);
    });

    it("clears a stale pending origin on restore so a coincidental id match cannot hijack the restored entry", async () => {
      // A fresh search sets originNodeIds before its data arrives, leaving an
      // origin pending. If that origin id happens to also appear in a graph
      // delivered later by a restore, and the pending queue is not cleared,
      // the next ungated effect run captures it as a phantom entry and steals
      // activeHistoryId away from the entry the restore just activated.
      const store = createStoreWithCollections();
      const originB = { _id: "CL/0002", id: "CL/0002" };
      // Shares an id with the origin left pending below.
      const sharedNode = { _id: "CL/0001", id: "CL/0001" };
      await act(async () => {
        render(
          <Provider store={store}>
            <MemoryRouter>
              <ToastProvider>
                <ForceGraph />
              </ToastProvider>
            </MemoryRouter>
          </Provider>,
        );
      });

      // Resolve and capture origin B normally.
      await act(async () => {
        store.dispatch(
          setGraphData({
            graphData: { nodes: [originB, sharedNode], links: [] },
            originNodeIds: [originB._id],
          }),
        );
      });
      await waitFor(() => expect(selectOriginHistory(store.getState())).toHaveLength(1));
      const entryB = selectOriginHistory(store.getState())[0];
      expect(store.getState().savedGraphs.activeHistoryId).toBe(entryB.id);

      // A fresh search sets originNodeIds before its data arrives, leaving
      // this origin pending indefinitely (graphData has no matching node yet).
      await act(async () => {
        store.dispatch(
          setGraphData({ graphData: { nodes: [], links: [] }, originNodeIds: [sharedNode._id] }),
        );
      });

      // Before that search resolves, the user restores entry B.
      await act(async () => {
        store.dispatch(restoreHistoryEntry(entryB.id));
      });
      expect(store.getState().savedGraphs.activeHistoryId).toBe(entryB.id);

      // The settle that follows the restore delivers entryB's subgraph, which
      // happens to contain a node sharing an id with the still-pending origin.
      await act(async () => {
        capturedOnSimulationEnd([originB, sharedNode], []);
      });

      // No phantom entry was captured, and the restored entry is still active.
      expect(selectOriginHistory(store.getState())).toHaveLength(1);
      expect(store.getState().savedGraphs.activeHistoryId).toBe(entryB.id);
    });

    it("keeps a restored entry active and syncing", async () => {
      // A restore clears originNodeIds, which must not read as an origin-set
      // change — otherwise it would freeze the entry the restore just activated.
      const store = createStoreWithCollections();
      const origin = { _id: "CL/0001", id: "CL/0001", x: 1, y: 1 };
      await act(async () => {
        render(
          <Provider store={store}>
            <MemoryRouter>
              <ToastProvider>
                <ForceGraph />
              </ToastProvider>
            </MemoryRouter>
          </Provider>,
        );
      });
      await act(async () => {
        store.dispatch(
          setGraphData({ graphData: { nodes: [origin], links: [] }, originNodeIds: [origin._id] }),
        );
      });
      await waitFor(() => expect(selectOriginHistory(store.getState())).toHaveLength(1));
      const entryId = selectOriginHistory(store.getState())[0].id;

      await act(async () => {
        store.dispatch(restoreHistoryEntry(entryId));
      });
      expect(store.getState().savedGraphs.activeHistoryId).toBe(entryId);

      // A settle after the restore still updates that entry.
      const moved = { ...origin, x: 99, y: 99 };
      await act(async () => {
        capturedOnSimulationEnd([moved], []);
      });
      await waitFor(() => {
        const restored = selectOriginHistory(store.getState()).find((e) => e.id === entryId);
        expect(restored.subgraph.nodes[0].x).toBe(99);
      });
    });

    it("freezes the active entry and clears activeHistoryId when a saved graph is loaded, adding no new card", async () => {
      // Unlike a restore, loading a saved graph never re-points activeHistoryId,
      // so the previously active entry must freeze here or the settle that
      // follows the load would stamp the loaded graph into it.
      const store = createStoreWithCollections();
      const origin = { _id: "CL/0001", id: "CL/0001" };
      await act(async () => {
        render(
          <Provider store={store}>
            <MemoryRouter>
              <ToastProvider>
                <ForceGraph />
              </ToastProvider>
            </MemoryRouter>
          </Provider>,
        );
      });
      await act(async () => {
        store.dispatch(
          setGraphData({ graphData: { nodes: [origin], links: [] }, originNodeIds: [origin._id] }),
        );
      });
      await waitFor(() => expect(selectOriginHistory(store.getState())).toHaveLength(1));
      const entryA = selectOriginHistory(store.getState())[0];
      expect(store.getState().savedGraphs.activeHistoryId).toBe(entryA.id);

      const loaded = { _id: "CL/0099", id: "CL/0099" };
      await act(async () => {
        store.dispatch(
          loadGraph({
            originNodeIds: [loaded._id],
            settings: store.getState().graph.present.settings,
            graphData: { nodes: [loaded], links: [] },
          }),
        );
      });

      expect(store.getState().savedGraphs.activeHistoryId).toBeNull();
      expect(selectOriginHistory(store.getState())).toHaveLength(1);

      // A settle following the load must not resurrect or overwrite A's entry.
      await act(async () => {
        capturedOnSimulationEnd([loaded], []);
      });

      const afterLoad = selectOriginHistory(store.getState()).find((e) => e.id === entryA.id);
      expect(afterLoad.subgraph.nodes.map((n) => n._id)).toEqual([origin._id]);
      expect(store.getState().savedGraphs.activeHistoryId).toBeNull();
      expect(selectOriginHistory(store.getState())).toHaveLength(1);
    });

    it("captures a card on first mount when an origin is already live and history is empty", async () => {
      // The production path: GraphPage/workflow populate graphData and
      // originNodeIds before ForceGraph mounts, so the first-run branch — not
      // the transition branch — is what has to queue and capture the card.
      const store = createTestStore();
      const origin = { _id: "CL/0001", id: "CL/0001" };
      const leaf = { _id: "GO/0010", id: "GO/0010" };
      store.dispatch(setAvailableCollections(["CL", "UBERON", "GO"]));
      store.dispatch(
        setGraphData({
          graphData: {
            nodes: [origin, leaf],
            links: [{ source: origin._id, target: leaf._id }],
          },
          originNodeIds: [origin._id],
        }),
      );
      expect(selectOriginHistory(store.getState())).toHaveLength(0);

      await act(async () => {
        render(
          <Provider store={store}>
            <MemoryRouter>
              <ToastProvider>
                <ForceGraph />
              </ToastProvider>
            </MemoryRouter>
          </Provider>,
        );
      });

      await waitFor(() => expect(selectOriginHistory(store.getState())).toHaveLength(1));
      const [entry] = selectOriginHistory(store.getState());
      expect(entry.originId).toBe(origin._id);
      expect(entry.subgraph.nodes.map((n) => n._id)).toEqual([origin._id, leaf._id]);
      expect(store.getState().savedGraphs.activeHistoryId).toBe(entry.id);
    });

    it("freezes the active entry when an undo reverts across an origin change", async () => {
      // isRestoring is set only by handleUndo/handleRedo, and an undo — unlike
      // a restore — does not re-point activeHistoryId. So undoing across an
      // origin add must freeze, or the next settle stamps the reverted
      // (A-only) graph into card B, leaving a card labelled B whose snapshot
      // contains no B.
      const store = createStoreWithCollections();
      const originA = { _id: "CL/0001", id: "CL/0001" };
      const originB = { _id: "CL/0002", id: "CL/0002" };
      await act(async () => {
        render(
          <Provider store={store}>
            <MemoryRouter>
              <ToastProvider>
                <ForceGraph />
              </ToastProvider>
            </MemoryRouter>
          </Provider>,
        );
      });
      await act(async () => {
        store.dispatch(
          setGraphData({
            graphData: { nodes: [originA], links: [] },
            originNodeIds: [originA._id],
          }),
        );
      });
      await waitFor(() => expect(selectOriginHistory(store.getState())).toHaveLength(1));
      await act(async () => {
        store.dispatch(
          setGraphData({
            graphData: { nodes: [originA, originB], links: [] },
            originNodeIds: [originA._id, originB._id],
          }),
        );
      });
      await waitFor(() => expect(selectOriginHistory(store.getState())).toHaveLength(2));
      const entryB = selectOriginHistory(store.getState())[1];
      expect(store.getState().savedGraphs.activeHistoryId).toBe(entryB.id);

      // Cmd+Z, the same path the user takes (both recompose thunks are in the
      // redux-undo filter, so this is reachable from the normal UI).
      await act(async () => {
        fireEvent.keyDown(window, { key: "z", metaKey: true });
      });

      expect(store.getState().graph.present.originNodeIds).toEqual([originA._id]);
      expect(store.getState().savedGraphs.activeHistoryId).toBeNull();

      // The settle that follows the undo must reach neither card.
      await act(async () => {
        capturedOnSimulationEnd([{ ...originA, x: 99, y: 99 }], []);
      });

      const afterUndo = selectOriginHistory(store.getState()).find((e) => e.id === entryB.id);
      expect(afterUndo.subgraph.nodes.map((n) => n._id)).toEqual([originA._id, originB._id]);
      expect(store.getState().savedGraphs.activeHistoryId).toBeNull();
      expect(selectOriginHistory(store.getState())).toHaveLength(2);
    });

    it("keeps the active entry syncing through an undo that does not change the origin set", async () => {
      // The freeze keys off the origin set, not off isRestoring: an undo that
      // only rolls back graph edits leaves the card describing the same
      // composition, so it must stay active and keep syncing.
      const store = createStoreWithCollections();
      const originA = { _id: "CL/0001", id: "CL/0001" };
      const leaf = { _id: "GO/0010", id: "GO/0010" };
      await act(async () => {
        render(
          <Provider store={store}>
            <MemoryRouter>
              <ToastProvider>
                <ForceGraph />
              </ToastProvider>
            </MemoryRouter>
          </Provider>,
        );
      });
      await act(async () => {
        store.dispatch(
          setGraphData({
            graphData: { nodes: [originA], links: [] },
            originNodeIds: [originA._id],
          }),
        );
      });
      await waitFor(() => expect(selectOriginHistory(store.getState())).toHaveLength(1));
      const entryA = selectOriginHistory(store.getState())[0];

      // An undoable graph edit that carries no originNodeIds, so the origin set
      // is untouched.
      await act(async () => {
        store.dispatch(setGraphData({ nodes: [originA, leaf], links: [] }));
      });
      await act(async () => {
        fireEvent.keyDown(window, { key: "z", metaKey: true });
      });

      expect(store.getState().graph.present.originNodeIds).toEqual([originA._id]);
      expect(store.getState().savedGraphs.activeHistoryId).toBe(entryA.id);

      // Still syncing: the settle after the undo updates the active card.
      await act(async () => {
        capturedOnSimulationEnd([{ ...originA, x: 99, y: 99 }], []);
      });
      await waitFor(() => {
        const synced = selectOriginHistory(store.getState()).find((e) => e.id === entryA.id);
        expect(synced.subgraph.nodes[0].x).toBe(99);
      });
      expect(selectOriginHistory(store.getState())).toHaveLength(1);
    });

    it("drops a settle whose thumbnail resolves after a different entry became active", async () => {
      // handleSimulationEnd awaits captureGraphThumbnail before dispatching the
      // sync. If the active entry is frozen and another activated during that
      // window, the settle's (now stale) graph must land in neither card.
      const store = createStoreWithCollections();
      const originA = { _id: "CL/0001", id: "CL/0001" };
      const originB = { _id: "CL/0002", id: "CL/0002" };

      captureGraphThumbnail.mockImplementationOnce(() => Promise.resolve("thumbnail-A"));
      await act(async () => {
        render(
          <Provider store={store}>
            <MemoryRouter>
              <ToastProvider>
                <ForceGraph />
              </ToastProvider>
            </MemoryRouter>
          </Provider>,
        );
      });
      await act(async () => {
        store.dispatch(
          setGraphData({
            graphData: { nodes: [originA], links: [] },
            originNodeIds: [originA._id],
          }),
        );
      });
      await waitFor(() => expect(selectOriginHistory(store.getState())).toHaveLength(1));
      const entryA = selectOriginHistory(store.getState())[0];
      expect(entryA.thumbnail).toBe("thumbnail-A");
      expect(store.getState().savedGraphs.activeHistoryId).toBe(entryA.id);

      // A settle on the A-only graph, held open at the thumbnail capture.
      let resolveSettleThumbnail;
      const settleThumbnail = new Promise((resolve) => {
        resolveSettleThumbnail = resolve;
      });
      captureGraphThumbnail.mockImplementationOnce(() => settleThumbnail);
      await act(async () => {
        capturedOnSimulationEnd([{ ...originA, x: 77, y: 77 }], []);
      });

      // While it is in flight, compose in B: A freezes and B's card takes over.
      captureGraphThumbnail.mockImplementationOnce(() => Promise.resolve("thumbnail-B"));
      await act(async () => {
        store.dispatch(
          setGraphData({
            graphData: { nodes: [originA, originB], links: [] },
            originNodeIds: [originA._id, originB._id],
          }),
        );
      });
      await waitFor(() => expect(selectOriginHistory(store.getState())).toHaveLength(2));
      const entryB = selectOriginHistory(store.getState())[1];
      expect(store.getState().savedGraphs.activeHistoryId).toBe(entryB.id);

      // Only now does the settle's capture resolve.
      await act(async () => {
        resolveSettleThumbnail("stale-thumbnail");
        await settleThumbnail;
      });

      const finalA = selectOriginHistory(store.getState()).find((e) => e.id === entryA.id);
      const finalB = selectOriginHistory(store.getState()).find((e) => e.id === entryB.id);
      expect(finalA.subgraph.nodes[0].x).toBeUndefined();
      expect(finalA.thumbnail).toBe("thumbnail-A");
      expect(finalB.subgraph.nodes.map((n) => n._id)).toEqual([originA._id, originB._id]);
      expect(finalB.thumbnail).toBe("thumbnail-B");
    });

    it("does not show an error state when popup is closed before the fetch resolves (abort)", async () => {
      let resolveCollections;
      const deferred = new Promise((resolve) => {
        resolveCollections = resolve;
      });
      fetchNeighborCollections.mockReturnValue(deferred);

      const store = createStoreWithCollections();
      await openNodePopup(store);

      // Click the disclosure to start the fetch
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /expand by collection/i }));
      });

      // Close the popup before the fetch resolves
      await act(async () => {
        const closeBtn = screen.getByRole("button", { name: /close popup/i });
        fireEvent.click(closeBtn);
      });

      // Now resolve the deferred promise
      await act(async () => {
        resolveCollections(["CL", "UBERON"]);
        await deferred;
      });

      // Popup is closed and no error state should appear
      expect(screen.queryByText(/failed to load collections/i)).not.toBeInTheDocument();
      expect(screen.queryByRole("menuitem")).not.toBeInTheDocument();
    });
  });

  describe("terminal collections stay in sync with allowed collections", () => {
    it("drops a deselected collection from terminalCollections but keeps a still-allowed one", () => {
      const store = createStoreWithCollections();
      render(
        <Provider store={store}>
          <ForceGraph title="Test Graph Title" />
        </Provider>,
      );

      // Open the options panel, then switch to the Filters tab.
      fireEvent.click(screen.getByRole("button", { name: /show options/i }));
      fireEvent.click(screen.getByRole("button", { name: /^filters$/i }));

      // The real collection-maps config (assets/nlm-ckn-collection-maps.json) is
      // wired through ForceGraph, so the UI shows display names, not raw ids:
      // UBERON -> "Anatomical structure", GO -> "Gene ontology".
      const UBERON_LABEL = "Anatomical structure";
      const GO_LABEL = "Gene ontology";

      // Mark both UBERON and GO as terminal via the real "Stop traversal at" control.
      const terminalInput = screen.getByPlaceholderText(/Filter by Terminal collections/i);
      fireEvent.focus(terminalInput);
      const terminalList = terminalInput
        .closest(".filterable-dropdown")
        .querySelector(".dropdown-list");
      fireEvent.click(within(terminalList).getByText(UBERON_LABEL));
      fireEvent.click(within(terminalList).getByText(GO_LABEL));

      expect(store.getState().graph.present.settings.terminalCollections).toEqual(["UBERON", "GO"]);

      // Deselect UBERON from the main Collections control by removing its pill.
      const collectionsInput = screen.getByPlaceholderText(/^Filter by Collections/i);
      const collectionsWrapper = collectionsInput.closest(".filterable-dropdown");
      const uberonPill = within(collectionsWrapper)
        .getAllByText(UBERON_LABEL, { selector: ".pill-text" })[0]
        .closest(".pill");
      fireEvent.click(within(uberonPill).getByRole("button"));

      const finalSettings = store.getState().graph.present.settings;
      // UBERON is no longer allowed, so it must not still be terminal.
      expect(finalSettings.allowedCollections).not.toContain("UBERON");
      expect(finalSettings.terminalCollections).not.toContain("UBERON");
      // GO is still allowed, so its terminal flag must be preserved, not wiped
      // wholesale — this would fail if the fix cleared the entire list instead
      // of filtering out just the deselected entry.
      expect(finalSettings.terminalCollections).toEqual(["GO"]);
    });

    it("clears terminalCollections when all collections are cleared", () => {
      const store = createStoreWithCollections();
      render(
        <Provider store={store}>
          <ForceGraph title="Test Graph Title" />
        </Provider>,
      );

      fireEvent.click(screen.getByRole("button", { name: /show options/i }));
      fireEvent.click(screen.getByRole("button", { name: /^filters$/i }));

      const terminalInput = screen.getByPlaceholderText(/Filter by Terminal collections/i);
      fireEvent.focus(terminalInput);
      const terminalList = terminalInput
        .closest(".filterable-dropdown")
        .querySelector(".dropdown-list");
      fireEvent.click(within(terminalList).getByText("Anatomical structure"));
      expect(store.getState().graph.present.settings.terminalCollections).toEqual(["UBERON"]);

      // "Clear all" on the Collections control: nothing is traversed any more,
      // so no collection can be terminal either. Otherwise stale terminal pills
      // render against an empty option list.
      const collectionsWrapper = screen
        .getByPlaceholderText(/^Filter by Collections/i)
        .closest(".filterable-dropdown");
      fireEvent.click(within(collectionsWrapper).getByRole("button", { name: /clear all/i }));

      const finalSettings = store.getState().graph.present.settings;
      expect(finalSettings.allowedCollections).toEqual([]);
      expect(finalSettings.terminalCollections).toEqual([]);
    });
  });

  describe("terminal collections from page defaults", () => {
    it("applies settingsFromProps.terminalCollections to the store", async () => {
      const store = createTestStore();
      store.dispatch(setAvailableCollections(["BGS", "CS", "UBERON", "CSD"]));

      await act(async () => {
        render(
          <Provider store={store}>
            <MemoryRouter>
              <ToastProvider>
                <ForceGraph
                  settings={{
                    graphType: "phenotypes",
                    depth: 3,
                    allowedCollections: ["BGS", "CS", "UBERON", "CSD"],
                    terminalCollections: ["UBERON", "CSD"],
                  }}
                />
              </ToastProvider>
            </MemoryRouter>
          </Provider>,
        );
      });

      await waitFor(() => {
        expect(store.getState().graph.present.settings.terminalCollections).toEqual([
          "UBERON",
          "CSD",
        ]);
      });
    });

    it("resets terminalCollections when the next page's defaults omit the key", async () => {
      // Redux settings are not reset between document pages, and GS is the only
      // entry in collection-defaults.json that carries terminalCollections. An
      // absent key must therefore mean "none", not "keep the previous page's".
      const store = createTestStore();
      store.dispatch(setAvailableCollections(["BGS", "CS", "UBERON", "CSD"]));

      const renderWith = (settings) =>
        render(
          <Provider store={store}>
            <MemoryRouter>
              <ToastProvider>
                <ForceGraph settings={settings} />
              </ToastProvider>
            </MemoryRouter>
          </Provider>,
        );

      let view;
      await act(async () => {
        view = renderWith({
          graphType: "phenotypes",
          depth: 3,
          allowedCollections: ["BGS", "CS", "UBERON", "CSD"],
          terminalCollections: ["UBERON", "CSD"],
        });
      });
      await waitFor(() => {
        expect(store.getState().graph.present.settings.terminalCollections).toEqual([
          "UBERON",
          "CSD",
        ]);
      });

      // Navigate away to a page whose defaults have no terminalCollections.
      await act(async () => {
        view.unmount();
      });
      await act(async () => {
        // The mounting page re-populates the collection list (the mocked
        // fetchCollections resolves empty, so restore it explicitly).
        store.dispatch(setAvailableCollections(["BGS", "CS", "UBERON", "CSD"]));
        renderWith({
          graphType: "phenotypes",
          depth: 2,
          allowedCollections: ["UBERON"],
        });
      });

      await waitFor(() => {
        expect(store.getState().graph.present.settings.terminalCollections).toEqual([]);
      });
    });
  });

  describe("CS collection defaults reach a Cell set page's own predicates and PUB", () => {
    it("sends IS_ABOUT and WAS_ATTRIBUTED_TO in edgeFilters.Label, and PUB in allowedCollections", async () => {
      const csDefaults = collectionDefaults.CS;
      fetchGraphData.mockResolvedValue({ nodes: [], links: [] });
      const store = createTestStore();
      // The prop-defaults effect only intersects allowedCollections once
      // availableCollections is populated, so seed it with every collection
      // the CS defaults name -- otherwise PUB (and everything else) would be
      // silently dropped and this test would pass for the wrong reason.
      store.dispatch(setAvailableCollections(csDefaults.allowedCollections));

      await act(async () => {
        render(
          <Provider store={store}>
            <MemoryRouter>
              <ToastProvider>
                <ForceGraph settings={csDefaults} />
              </ToastProvider>
            </MemoryRouter>
          </Provider>,
        );
      });

      await waitFor(() => {
        expect(fetchGraphData).toHaveBeenCalled();
      });

      const params = fetchGraphData.mock.calls[0][0];
      // WAS_ATTRIBUTED_TO is what brings a dataset's publications onto this
      // page. The ETL once emitted it unsplit as WASATTRIBUTEDTO; that spelling
      // is gone from the data, and a pinned value matching nothing still shows
      // up as a selected filter, so it must not come back.
      expect(params.edgeFilters.Label).toEqual(
        expect.arrayContaining(["IS_ABOUT", "WAS_ATTRIBUTED_TO"]),
      );
      expect(params.edgeFilters.Label).not.toContain("WASATTRIBUTEDTO");
      expect(params.allowedCollections).toEqual(expect.arrayContaining(["PUB"]));
    });
  });

  describe("BGS collection defaults keep the binary gene set graph to one hop", () => {
    it("sends depth 1 and only BGS, CS and GS in allowedCollections", async () => {
      // Without an entry of its own, a binary gene set page fell through to
      // _defaults -- depth 2 over every collection -- which pulls in the sibling
      // gene sets, cell type markers, diseases and proteins reachable through the
      // cell set, ~300 nodes for a set of 10 genes. One hop over BGS/CS/GS leaves
      // the gene set, the cell set that expresses it, and its member genes.
      const bgsDefaults = collectionDefaults.BGS;
      fetchGraphData.mockResolvedValue({ nodes: [], links: [] });
      const store = createTestStore();
      // The prop-defaults effect intersects allowedCollections against the
      // available list, so seed it with every collection the defaults name.
      store.dispatch(setAvailableCollections(bgsDefaults.allowedCollections));

      await act(async () => {
        render(
          <Provider store={store}>
            <MemoryRouter>
              <ToastProvider>
                <ForceGraph settings={bgsDefaults} />
              </ToastProvider>
            </MemoryRouter>
          </Provider>,
        );
      });

      await waitFor(() => {
        expect(fetchGraphData).toHaveBeenCalled();
      });

      const params = fetchGraphData.mock.calls[0][0];
      expect(params.depth).toBe(1);
      expect(params.allowedCollections).toEqual(["BGS", "CS", "GS"]);
    });
  });

  describe("BMC collection defaults reach the cell set, its dataset and the anatomical structure", () => {
    it("sends depth 2, the four-collection allow list, and the predicates that pin the shape", async () => {
      // A marker set page should show its own marker genes, the cell set it
      // characterizes, that cell set's dataset, and the anatomical structure the
      // dataset is about -- and nothing else.
      //
      // The anatomical structure is reached through CS -DERIVES_FROM-> UBERON at
      // hop 2, NOT by expanding the CSD at hop 3. IS_ABOUT also links a CSD to
      // every cell set in its dataset, so that third hop drags in the sibling
      // cell sets (32 of them, measured on BMC/oz8fp9m8a9b5 against dev
      // v1.7.0-rc.2). The CSD -IS_ABOUT-> UBERON edge still gets drawn: both
      // endpoints are in the result set, so the inter-node-edge pass adds it.
      const bmcDefaults = collectionDefaults.BMC;
      fetchGraphData.mockResolvedValue({ nodes: [], links: [] });
      const store = createTestStore();
      // The prop-defaults effect intersects allowedCollections against the
      // available list, so seed it with every collection the defaults name.
      store.dispatch(setAvailableCollections(bmcDefaults.allowedCollections));

      await act(async () => {
        render(
          <Provider store={store}>
            <MemoryRouter>
              <ToastProvider>
                <ForceGraph settings={bmcDefaults} />
              </ToastProvider>
            </MemoryRouter>
          </Provider>,
        );
      });

      await waitFor(() => {
        expect(fetchGraphData).toHaveBeenCalled();
      });

      const params = fetchGraphData.mock.calls[0][0];
      expect(params.depth).toBe(2);
      expect(params.allowedCollections).toEqual(["CS", "GS", "CSD", "UBERON"]);
      expect(params.edgeFilters.Label).toEqual([
        "HAS_CHARACTERIZING_MARKER_SET",
        "PART_OF",
        "IS_ABOUT",
        "DERIVES_FROM",
      ]);
    });

    it("does not collapse leaf nodes on start", () => {
      // Every node this page is meant to show is a leaf. Leaf collapse would
      // hide the marker genes, the dataset and the anatomical structure, which
      // is the whole graph.
      expect(collectionDefaults.BMC.collapseOnStart).toBe("off");
    });
  });

  describe("collection-defaults.json fixture", () => {
    it("contains no entry using the retired SELECTIVELY_EXPRESS predicate", () => {
      // Assert the fixture is non-empty first: a forEach over {} would make every
      // assertion below pass vacuously, so the guard would stop guarding silently.
      const entries = Object.entries(collectionDefaults);
      expect(entries.length).toBeGreaterThan(0);
      for (const [, entry] of entries) {
        expect(entry.preferredPredicates || []).not.toContain("SELECTIVELY_EXPRESS");
      }
    });
  });
});
