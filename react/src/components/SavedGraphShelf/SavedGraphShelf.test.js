import { configureStore } from "@reduxjs/toolkit";
import { fireEvent, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import graphReducer from "store/graphSlice";
import savedGraphsReducer from "store/savedGraphsSlice";
import SavedGraphShelf from "./SavedGraphShelf";

const renderWithState = (originHistory, activeHistoryId = null) => {
  const store = configureStore({
    reducer: { graph: graphReducer, savedGraphs: savedGraphsReducer },
    preloadedState: { savedGraphs: { originHistory, activeHistoryId } },
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

const entry = (over = {}) => ({
  id: "1",
  originId: "CS/a",
  label: "Origin Label",
  thumbnail: null,
  subgraph: { nodes: [], links: [] },
  timestamp: "t",
  ...over,
});

describe("SavedGraphShelf", () => {
  it("renders an empty state when there is no history", () => {
    const { container } = renderWithState([]);
    expect(container.querySelector(".saved-graph-shelf--empty")).toBeInTheDocument();
  });

  it("renders the empty state without crashing when the array is undefined (stale rehydrate)", () => {
    const store = configureStore({
      reducer: { graph: graphReducer, savedGraphs: savedGraphsReducer },
      // Mimic a stale persisted blob that rehydrated without an originHistory array.
      preloadedState: { savedGraphs: { activeHistoryId: null } },
    });
    const { container } = render(
      <Provider store={store}>
        <SavedGraphShelf />
      </Provider>,
    );
    expect(container.querySelector(".saved-graph-shelf--empty")).toBeInTheDocument();
  });

  it("renders a card per history entry and highlights the active one", () => {
    const { container } = renderWithState(
      [entry({ id: "1" }), entry({ id: "2", label: "Second" })],
      "2",
    );
    expect(screen.getByText("Origin Label")).toBeInTheDocument();
    expect(screen.getByText("Second")).toBeInTheDocument();
    expect(container.querySelectorAll(".saved-graph-card--active")).toHaveLength(1);
  });

  it("restores a history entry when its card is clicked", () => {
    const { store } = renderWithState([entry({ id: "1" })]);
    fireEvent.click(screen.getByText("Origin Label"));
    expect(store.getState().savedGraphs.activeHistoryId).toBe("1");
  });

  it("restores a history entry when its thumbnail is clicked", () => {
    const { container, store } = renderWithState([entry({ id: "1" })]);
    fireEvent.click(container.querySelector(".saved-graph-card-thumb"));
    expect(store.getState().savedGraphs.activeHistoryId).toBe("1");
  });

  it("deletes a history entry via its delete control", () => {
    const { store } = renderWithState([entry({ id: "1" })]);
    fireEvent.click(screen.getByRole("button", { name: /delete/i }));
    expect(store.getState().savedGraphs.originHistory).toHaveLength(0);
  });
});
