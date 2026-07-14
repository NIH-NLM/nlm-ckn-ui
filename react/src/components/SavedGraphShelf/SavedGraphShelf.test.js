import { configureStore } from "@reduxjs/toolkit";
import { fireEvent, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import graphReducer from "store/graphSlice";
import savedGraphsReducer from "store/savedGraphsSlice";
import SavedGraphShelf from "./SavedGraphShelf";

const renderWithState = (savedGraphs, activeGraphId = null) => {
  const store = configureStore({
    reducer: { graph: graphReducer, savedGraphs: savedGraphsReducer },
    preloadedState: { savedGraphs: { savedGraphs, activeGraphId } },
  });
  return {
    store,
    ...render(
      <Provider store={store}>
        <SavedGraphShelf />
      </Provider>,
    ),
  };
};

const card = (over = {}) => ({
  id: "1",
  name: "Graph Title",
  thumbnail: null,
  originNodeIds: ["CS/a"],
  settings: {},
  graphData: { nodes: [], links: [] },
  timestamp: "t",
  ...over,
});

describe("SavedGraphShelf", () => {
  it("renders an empty state when there are no saved graphs", () => {
    const { container } = renderWithState([]);
    expect(container.querySelector(".saved-graph-shelf--empty")).toBeInTheDocument();
  });

  it("renders the empty state without crashing when the array is undefined (stale rehydrate)", () => {
    const store = configureStore({
      reducer: { graph: graphReducer, savedGraphs: savedGraphsReducer },
      // Mimic a stale persisted blob that rehydrated without a savedGraphs array.
      preloadedState: { savedGraphs: { activeGraphId: null } },
    });
    const { container } = render(
      <Provider store={store}>
        <SavedGraphShelf />
      </Provider>,
    );
    expect(container.querySelector(".saved-graph-shelf--empty")).toBeInTheDocument();
  });

  it("renders a card per saved graph and highlights the active one", () => {
    const { container } = renderWithState(
      [card({ id: "1" }), card({ id: "2", name: "Second" })],
      "2",
    );
    expect(screen.getByText("Graph Title")).toBeInTheDocument();
    expect(screen.getByText("Second")).toBeInTheDocument();
    expect(container.querySelectorAll(".saved-graph-card--active")).toHaveLength(1);
  });

  it("restores a graph when its card is clicked", () => {
    const { store } = renderWithState([card({ id: "1" })]);
    fireEvent.click(screen.getByText("Graph Title"));
    expect(store.getState().savedGraphs.activeGraphId).toBe("1");
  });

  it("renames a graph via the rename control without restoring it", () => {
    const { store } = renderWithState([card({ id: "1" })]);
    fireEvent.click(screen.getByRole("button", { name: /rename/i }));
    // Entering rename mode must not restore the graph.
    expect(store.getState().savedGraphs.activeGraphId).toBeNull();
    const input = screen.getByDisplayValue("Graph Title");
    fireEvent.change(input, { target: { value: "Renamed" } });
    fireEvent.blur(input);
    expect(store.getState().savedGraphs.savedGraphs[0].name).toBe("Renamed");
  });

  it("ignores an empty rename value and keeps the existing name", () => {
    const { store } = renderWithState([card({ id: "1" })]);
    fireEvent.click(screen.getByRole("button", { name: /rename/i }));
    const input = screen.getByDisplayValue("Graph Title");
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.blur(input);
    expect(store.getState().savedGraphs.savedGraphs[0].name).toBe("Graph Title");
  });

  it("deletes a graph via its delete control", () => {
    const { store } = renderWithState([card({ id: "1" })]);
    fireEvent.click(screen.getByRole("button", { name: /delete/i }));
    expect(store.getState().savedGraphs.savedGraphs).toHaveLength(0);
  });
});
