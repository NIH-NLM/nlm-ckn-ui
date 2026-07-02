import { configureStore } from "@reduxjs/toolkit";
import { fireEvent, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import graphReducer, { setEdgeFilterMode } from "../../../store/graphSlice";
import FiltersPanel from "./FiltersPanel";

const renderPanel = (mode = "include", isAdvancedMode = false) => {
  const store = configureStore({ reducer: { graph: graphReducer } });
  const dispatchSpy = jest.spyOn(store, "dispatch");
  const settings = {
    allCollections: [],
    allowedCollections: [],
    edgeFilters: { Label: [] },
    edgeFilterModes: { Label: mode },
  };
  render(
    <Provider store={store}>
      <FiltersPanel
        settings={settings}
        collectionMaps={new Map()}
        availableEdgeFilters={{ Label: { type: "categorical", values: ["DERIVES_FROM"] } }}
        edgeFilterStatus="succeeded"
        onCollectionChange={() => {}}
        onCollectionsClearAll={() => {}}
        graphLinks={[{ Label: "DERIVES_FROM" }]}
        isAdvancedMode={isAdvancedMode}
      />
    </Provider>,
  );
  return { dispatchSpy };
};

describe("FiltersPanel edge filter mode toggle", () => {
  it("toggling Exclude dispatches setEdgeFilterMode exclude", () => {
    const { dispatchSpy } = renderPanel("include");
    fireEvent.click(screen.getByRole("button", { name: /exclude/i }));
    expect(dispatchSpy).toHaveBeenCalledWith(
      setEdgeFilterMode({ field: "Label", mode: "exclude" }),
    );
  });

  it("renders an Include and an Exclude control for a categorical field", () => {
    renderPanel("include");
    expect(screen.getByRole("button", { name: /include/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /exclude/i })).toBeInTheDocument();
  });

  it("marks Include active in include mode", () => {
    renderPanel("include");
    expect(screen.getByRole("button", { name: /^include$/i })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: /exclude/i })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("marks Exclude active in exclude mode", () => {
    renderPanel("exclude");
    expect(screen.getByRole("button", { name: /exclude/i })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: /^include$/i })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("keeps the dropdown placeholder stable regardless of mode", () => {
    // The placeholder is a stable handle (used by e2e locators); mode is shown
    // by the Include/Exclude toggle, not the dropdown label.
    renderPanel("exclude");
    expect(screen.getByPlaceholderText("Filter by Label...")).toBeInTheDocument();
  });

  it("hides the Include/Exclude toggle in advanced mode", () => {
    // Advanced mode does not apply edge-filter modes yet, so the toggle must
    // not be shown; the legacy include-only dropdown is rendered instead.
    renderPanel("include", true);
    expect(screen.queryByRole("button", { name: /exclude/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^include$/i })).not.toBeInTheDocument();
    // Legacy dropdown uses the bare field name as its placeholder label.
    expect(screen.getByPlaceholderText(/filter by label/i)).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/show only these|hide these/i)).not.toBeInTheDocument();
  });
});
