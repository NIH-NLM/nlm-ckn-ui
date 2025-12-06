import { configureStore } from "@reduxjs/toolkit";
import { fireEvent, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import graphReducer from "../../store/graphSlice";
import nodesReducer from "../../store/nodesSlice";
import savedGraphsReducer from "../../store/savedGraphsSlice";
import ForceGraph from "./ForceGraph";

// Mock ResizeObserver for jsdom
global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

// Create a test store with all required slices
const createTestStore = () =>
  configureStore({
    reducer: {
      graph: graphReducer,
      nodesSlice: nodesReducer,
      savedGraphs: savedGraphsReducer,
    },
  });

describe("ForceGraph", () => {
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

  // TODO: Finish testing
});
