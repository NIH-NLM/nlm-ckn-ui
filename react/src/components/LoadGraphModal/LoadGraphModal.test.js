import { configureStore } from "@reduxjs/toolkit";
import { render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import graphReducer from "store/graphSlice";
import savedGraphsReducer from "store/savedGraphsSlice";
import LoadGraphModal from "./LoadGraphModal";

const renderModal = (savedGraphsState) => {
  const store = configureStore({
    reducer: { graph: graphReducer, savedGraphs: savedGraphsReducer },
    ...(savedGraphsState ? { preloadedState: { savedGraphs: savedGraphsState } } : {}),
  });
  return render(
    <Provider store={store}>
      <LoadGraphModal isOpen onClose={() => {}} />
    </Provider>,
  );
};

describe("LoadGraphModal", () => {
  it("lists saved graphs", () => {
    renderModal({
      savedGraphs: [{ id: "1", name: "My Graph", timestamp: "2026-01-01T00:00:00Z" }],
      activeGraphId: null,
    });
    expect(screen.getByText("My Graph")).toBeInTheDocument();
  });

  it("shows the empty state without crashing when the array is undefined (stale rehydrate)", () => {
    // Mimic a stale persisted blob rehydrated without a savedGraphs array.
    renderModal({ activeGraphId: null });
    expect(screen.getByText("You have no saved graphs.")).toBeInTheDocument();
  });
});
