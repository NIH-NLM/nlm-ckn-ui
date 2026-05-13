import { configureStore } from "@reduxjs/toolkit";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Provider } from "react-redux";
import graphReducer, { setAvailableCollections } from "../../store/graphSlice";
import nodesReducer from "../../store/nodesSlice";
import savedGraphsReducer from "../../store/savedGraphsSlice";
import ForceGraph from "./ForceGraph";

// Mock ResizeObserver for jsdom
global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

// Capture the onNodeClick callback so tests can trigger the popup directly
let capturedOnNodeClick = null;

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
};

jest.mock("components/ForceGraphConstructor/ForceGraphConstructor", () => ({
  __esModule: true,
  default: jest.fn(),
}));

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
  fetchNodesDetails: jest.fn(),
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
        <ForceGraph />
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
    // Set up ForceGraphConstructor to capture onNodeClick and return the mock instance
    ForceGraphConstructorMock.mockImplementation((_svg, _data, opts) => {
      capturedOnNodeClick = opts.onNodeClick;
      return mockGraphInstance;
    });
    // Reset mock call counts
    Object.values(mockGraphInstance).forEach((fn) => {
      if (fn.mockReset) fn.mockReset();
    });
    mockGraphInstance.getCurrentGraph.mockReturnValue(null);
    mockGraphInstance.isDragging.mockReturnValue(false);
    // Default return values for service mocks
    fetchCollections.mockResolvedValue([]);
    fetchEdgeFilterOptions.mockResolvedValue([]);
    fetchNodeExpansion.mockResolvedValue({ nodes: [], links: [] });
    fetchNeighborCollections.mockResolvedValue([]);
  });

  it("Should toggle options when toggle options button is clicked", () => {
    render(
      <Provider store={createTestStore()}>
        <ForceGraph />
      </Provider>,
    );

    // Get the button that toggles the options visibility
    // Button text is "< Show Options" when closed, "> Hide Options" when open
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
        // fetchNodeExpansion(nodeId, graphType, allowedCollections, includeInterNodeEdges)
        expect(fetchNodeExpansion).toHaveBeenCalledWith(
          "GO/0000001",
          expect.any(String),
          ["CL"],
          expect.any(Boolean),
        );
      });
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
});
