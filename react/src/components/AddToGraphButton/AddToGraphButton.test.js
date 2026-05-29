import { configureStore } from "@reduxjs/toolkit";
import { fireEvent, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import nodesReducer from "../../store/nodesSlice";
import { ToastProvider } from "../Toast";
import AddToGraphButton from "./AddToGraphButton";

const NODE_ID = "CL/001";

const createTestStore = (nodeIds = []) =>
  configureStore({
    reducer: { nodesSlice: nodesReducer },
    preloadedState: { nodesSlice: { originNodeIds: nodeIds } },
  });

const renderButton = (store) =>
  render(
    <Provider store={store}>
      <MemoryRouter>
        <ToastProvider>
          <AddToGraphButton nodeId={NODE_ID} />
        </ToastProvider>
      </MemoryRouter>
    </Provider>,
  );

describe("AddToGraphButton", () => {
  afterEach(() => {
    const root = document.getElementById("toast-root");
    root?.parentNode?.removeChild(root);
  });

  it("shows a toast with a /graph link when adding a node", () => {
    const store = createTestStore([]);
    renderButton(store);

    fireEvent.click(screen.getByRole("button", { name: /add to graph/i }));

    expect(screen.getByText("Added to Graph.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /view graph/i })).toHaveAttribute("href", "/graph");
  });

  it("does NOT show a toast when removing a node", () => {
    const store = createTestStore([NODE_ID]);
    renderButton(store);

    fireEvent.click(screen.getByRole("button", { name: /remove from graph/i }));

    expect(screen.queryByText("Added to Graph.")).not.toBeInTheDocument();
  });
});
