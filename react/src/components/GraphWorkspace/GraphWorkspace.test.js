import { configureStore } from "@reduxjs/toolkit";
import { fireEvent, render, screen } from "@testing-library/react";
import GraphWorkspace from "components/GraphWorkspace";
import { Provider } from "react-redux";
import graphReducer from "store/graphSlice";
import savedGraphsReducer from "store/savedGraphsSlice";

// Stub heavy children so the test targets composition + selection wiring.
jest.mock("components/ForceGraph/ForceGraph", () => ({ onNodeSelect, title }) => (
  <div>
    <span data-testid="graph-title">{title}</span>
    <button type="button" onClick={() => onNodeSelect("CS/clicked")}>
      graph
    </button>
  </div>
));
jest.mock("components/NodeInspector", () => ({ selectedNodeId, originDocument }) => (
  <div
    data-testid="inspector"
    data-selected={selectedNodeId ?? ""}
    data-origin={originDocument?._id ?? ""}
  >
    {selectedNodeId ?? originDocument?._id ?? "empty"}
  </div>
));
jest.mock("components/SavedGraphShelf", () => () => <div data-testid="shelf" />);
jest.mock("hooks", () => ({
  useNodeDocument: (nodeId) => ({
    // "CS/pending" simulates a not-yet-resolved fetch so the originDocument-seed
    // fallback (active history entry, doc still loading) can be exercised.
    document: nodeId && nodeId !== "CS/pending" ? { _id: nodeId, __resolved: true } : null,
    loading: false,
    error: null,
  }),
}));
// getTitle is used for the title; stub it so title is deterministic from the doc _id,
// keeping the rest of the module intact (graphSlice depends on other utils exports).
jest.mock("utils", () => ({
  ...jest.requireActual("utils"),
  getTitle: (doc) => `Title:${doc?._id}`,
}));

const renderWorkspace = (props = {}, preloadedGraph) => {
  const store = configureStore({
    reducer: { graph: graphReducer, savedGraphs: savedGraphsReducer },
    ...(preloadedGraph ? { preloadedState: { graph: preloadedGraph } } : {}),
  });
  return render(
    <Provider store={store}>
      <GraphWorkspace
        originDocument={{ _id: "CSD/origin" }}
        nodeIds={["CSD/origin"]}
        settings={{}}
        {...props}
      />
    </Provider>,
  );
};

describe("GraphWorkspace", () => {
  it("shows the origin document in the inspector by default", () => {
    renderWorkspace();
    expect(screen.getByTestId("inspector")).toHaveTextContent("CSD/origin");
    expect(screen.getByTestId("shelf")).toBeInTheDocument();
  });

  it("swaps the inspector to the clicked node", () => {
    renderWorkspace();
    fireEvent.click(screen.getByText("graph"));
    expect(screen.getByTestId("inspector")).toHaveTextContent("CS/clicked");
  });

  it("defaults the inspector to the first origin node when no origin document is given", () => {
    renderWorkspace(
      { originDocument: undefined, nodeIds: undefined },
      { past: [], present: { originNodeIds: ["CS/first", "CS/second"] }, future: [] },
    );
    expect(screen.getByTestId("inspector")).toHaveTextContent("CS/first");
  });

  it("shows an empty inspector when there is neither an origin document nor origin nodes", () => {
    renderWorkspace(
      { originDocument: undefined, nodeIds: undefined },
      { past: [], present: { originNodeIds: [] }, future: [] },
    );
    expect(screen.getByTestId("inspector")).toHaveTextContent("empty");
  });

  it("passes an explicit title through to the graph", () => {
    renderWorkspace({ title: "My Graph" });
    expect(screen.getByTestId("graph-title")).toHaveTextContent("My Graph");
  });

  it("derives the title from the origin document when no title prop is given", () => {
    renderWorkspace({ originDocument: { _id: "CSD/origin" } });
    expect(screen.getByTestId("graph-title")).toHaveTextContent("Title:CSD/origin");
  });

  it('falls back to "Graph" with no title and no origin document', () => {
    renderWorkspace(
      { originDocument: undefined, nodeIds: undefined, title: undefined },
      { past: [], present: { originNodeIds: [] }, future: [] },
    );
    expect(screen.getByTestId("graph-title")).toHaveTextContent("Graph");
  });

  it("titles + inspects the active history entry's origin", () => {
    const store = configureStore({
      reducer: { graph: graphReducer, savedGraphs: savedGraphsReducer },
      preloadedState: {
        savedGraphs: {
          savedGraphs: [],
          activeGraphId: null,
          originHistory: [
            {
              id: "hist-CS/active",
              originId: "CS/active",
              label: "A",
              subgraph: { nodes: [], links: [] },
              thumbnail: null,
            },
          ],
          activeHistoryId: "hist-CS/active",
        },
      },
    });
    render(
      <Provider store={store}>
        <GraphWorkspace originDocument={{ _id: "CSD/page" }} nodeIds={["CSD/page"]} settings={{}} />
      </Provider>,
    );
    expect(screen.getByTestId("graph-title")).toHaveTextContent("Title:CS/active");
    expect(screen.getByTestId("inspector")).toHaveTextContent("CS/active");
  });

  it("falls back to the page origin document before any history entry", () => {
    renderWorkspace(); // no originHistory / activeHistoryId
    expect(screen.getByTestId("inspector")).toHaveTextContent("CSD/origin");
  });

  it("shows the page's own document (e.g. an edge doc) when its id differs from the origin node id and no history is active", () => {
    renderWorkspace({
      originDocument: { _id: "EDGE_COLL/e1" }, // edge doc: its own id
      nodeIds: ["CS/from"], // parseId → endpoint vertex
    });
    // Inspector shows the edge document, not the _from vertex.
    expect(screen.getByTestId("inspector")).toHaveTextContent("EDGE_COLL/e1");
  });

  it("seeds the inspector from the page document while the active entry's origin is still resolving", () => {
    const store = configureStore({
      reducer: { graph: graphReducer, savedGraphs: savedGraphsReducer },
      preloadedState: {
        savedGraphs: {
          savedGraphs: [],
          activeGraphId: null,
          originHistory: [
            {
              id: "hist-CS/pending",
              originId: "CS/pending",
              label: "P",
              subgraph: { nodes: [], links: [] },
              thumbnail: null,
            },
          ],
          activeHistoryId: "hist-CS/pending",
        },
      },
    });
    render(
      <Provider store={store}>
        <GraphWorkspace
          originDocument={{ _id: "CS/pending" }}
          nodeIds={["CS/pending"]}
          settings={{}}
        />
      </Provider>,
    );
    // The active entry's document isn't resolved (mock returns null for
    // "CS/pending"), so the workspace uses the matching page originDocument as
    // the seed (passed as originDocument) rather than making the inspector fetch
    // it (selected stays empty).
    const inspector = screen.getByTestId("inspector");
    expect(inspector).toHaveAttribute("data-origin", "CS/pending");
    expect(inspector).toHaveAttribute("data-selected", "");
  });
});
