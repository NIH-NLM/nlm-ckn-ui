import { configureStore } from "@reduxjs/toolkit";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { Provider } from "react-redux";
import graphReducer, { setEdgeFilterMode } from "../../../store/graphSlice";
import FiltersPanel from "./FiltersPanel";

const renderPanel = (modeOrOptions = "include") => {
  const options = typeof modeOrOptions === "string" ? { mode: modeOrOptions } : modeOrOptions;
  const { mode = "include", settings: settingsOverride = {}, ...propOverrides } = options;

  const store = configureStore({ reducer: { graph: graphReducer } });
  const dispatchSpy = jest.spyOn(store, "dispatch");
  const settings = {
    allCollections: [],
    availableCollections: [],
    allowedCollections: [],
    terminalCollections: [],
    edgeFilters: { Label: [] },
    edgeFilterModes: { Label: mode },
    ...settingsOverride,
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
        onTerminalCollectionChange={() => {}}
        onTerminalCollectionsClearAll={() => {}}
        graphLinks={[{ Label: "DERIVES_FROM" }]}
        {...propOverrides}
      />
    </Provider>,
  );
  return { dispatchSpy };
};

describe("FiltersPanel section order", () => {
  it("renders sections in the order the query applies: Collections, Edge Filters, Stop traversal at", () => {
    renderPanel();

    const headings = screen.getAllByRole("heading", { level: 3 }).map((el) => el.textContent);

    expect(headings).toEqual(["Collection Filters:", "Edge Filters:", "Stop traversal at:"]);
  });
});

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

  it("shows the Include/Exclude toggle regardless of mode", () => {
    // Advanced (per-node) mode now applies edge-filter modes, so the toggle is
    // always rendered; both Include and Exclude controls must be present.
    renderPanel("include");
    expect(screen.getByRole("button", { name: /^include$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /exclude/i })).toBeInTheDocument();
  });
});

describe("FiltersPanel collection filter dropdown", () => {
  it("offers only the current graph's collections, not the full ontologies-wide set", () => {
    renderPanel({
      settings: {
        allCollections: ["CS", "UBERON", "CHEBI"],
        availableCollections: ["CS", "UBERON"],
      },
    });

    const picker = screen.getByText("Collection Filters:").closest(".collection-picker");
    fireEvent.focus(within(picker).getByPlaceholderText(/Filter by Collections/i));
    const optionList = picker.querySelector(".dropdown-list");
    expect(within(optionList).getByText("CS")).toBeInTheDocument();
    expect(within(optionList).getByText("UBERON")).toBeInTheDocument();
    // CHEBI is in allCollections (ontologies-wide) but not in this graph's
    // availableCollections, so it must not be offerable here.
    expect(within(optionList).queryByText("CHEBI")).not.toBeInTheDocument();
  });
});

describe("FiltersPanel terminal collections", () => {
  it("offers only currently allowed collections as terminal options", () => {
    renderPanel({
      settings: {
        allCollections: ["CS", "UBERON", "MONDO"],
        allowedCollections: ["CS", "UBERON"],
        terminalCollections: ["UBERON"],
      },
    });

    const group = screen.getByRole("group", { name: /stop traversal at/i });
    // The dropdown's option list only renders while open (onFocus sets isOpen),
    // and selected values also render as pills outside that list regardless of
    // open state. Focus the input first and scope assertions to .dropdown-list
    // so we prove the *option list* is sourced from allowedCollections, rather
    // than incidentally matching the "UBERON" pill (always present) or trivially
    // finding "MONDO" absent because the list was never opened.
    fireEvent.focus(within(group).getByPlaceholderText(/Filter by Terminal collections/i));
    const optionList = group.querySelector(".dropdown-list");
    expect(within(optionList).getByText("UBERON")).toBeInTheDocument();
    // MONDO is allowed nowhere, so it must not be offerable as terminal.
    expect(within(optionList).queryByText("MONDO")).not.toBeInTheDocument();
  });

  it("toggles a collection's terminal state", () => {
    const onTerminalCollectionChange = jest.fn();
    renderPanel({
      settings: {
        allCollections: ["CS", "UBERON"],
        allowedCollections: ["CS", "UBERON"],
        terminalCollections: [],
      },
      onTerminalCollectionChange,
    });

    const group = screen.getByRole("group", { name: /stop traversal at/i });
    fireEvent.focus(within(group).getByPlaceholderText(/Filter by Terminal collections/i));
    const optionList = group.querySelector(".dropdown-list");
    fireEvent.click(within(optionList).getByText("UBERON"));

    expect(onTerminalCollectionChange).toHaveBeenCalledWith("UBERON");
  });
});

describe("FiltersPanel keeps an active edge filter reachable", () => {
  it("still renders a selected field when the filter emptied the graph", () => {
    // A selection that matches no edges empties the graph, which empties
    // graphLinks. Deriving the visible fields from graphLinks alone therefore
    // removed the dropdown holding the selection that caused it, leaving no way
    // to toggle the filter back off.
    renderPanel({
      settings: { edgeFilters: { Label: ["DERIVES_FROM"] } },
      graphLinks: [],
    });

    expect(screen.getByPlaceholderText("Filter by Label...")).toBeInTheDocument();
  });

  it("still renders a selected field the current graph has no edge for", () => {
    renderPanel({
      settings: { edgeFilters: { Label: ["DERIVES_FROM"] } },
      graphLinks: [{ Score: 0.5 }],
    });

    expect(screen.getByPlaceholderText("Filter by Label...")).toBeInTheDocument();
  });

  it("still renders a numeric field narrowed off its full range", () => {
    renderPanel({
      availableEdgeFilters: { Score: { type: "numeric", min: 0, max: 1 } },
      settings: { edgeFilters: { Score: { min: 0.4, max: 1 } } },
      graphLinks: [],
    });

    expect(screen.getByText("Edge Filters:")).toBeInTheDocument();
  });

  it("hides a numeric field still spanning its full range", () => {
    // Every numeric field is seeded with its full {min, max} on load, so a
    // seeded range is not a selection and must not pin the field open.
    renderPanel({
      availableEdgeFilters: { Score: { type: "numeric", min: 0, max: 1 } },
      settings: { edgeFilters: { Score: { min: 0, max: 1 } } },
      graphLinks: [],
    });

    expect(screen.queryByText("Edge Filters:")).not.toBeInTheDocument();
  });

  it("hides an unselected field the current graph has no edge for", () => {
    renderPanel({
      settings: { edgeFilters: { Label: [] } },
      graphLinks: [{ Score: 0.5 }],
    });

    expect(screen.queryByPlaceholderText("Filter by Label...")).not.toBeInTheDocument();
  });
});
