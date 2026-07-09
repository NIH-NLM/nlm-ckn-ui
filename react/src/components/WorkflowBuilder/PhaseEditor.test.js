import { configureStore } from "@reduxjs/toolkit";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { Provider } from "react-redux";
import PhaseEditor from "./PhaseEditor";

// PhaseEditor only reaches into redux for graph.present.settings.allCollections.
// A minimal stub reducer satisfies that selector without pulling in the full
// (undoable) graph slice.
const graphStub = () => ({ present: { settings: { allCollections: [] } } });

const makePhase = (overrides = {}) => ({
  id: "phase-1",
  name: "",
  originSource: "manual",
  originNodeIds: ["CL/origin"],
  previousPhaseId: null,
  originFilter: "all",
  perNodeSettings: {},
  showAdvancedSettings: false,
  result: null,
  settings: {
    graphType: "ontologies",
    depth: 2,
    edgeDirection: "ANY",
    allowedCollections: [],
    returnCollections: [],
    setOperation: "Union",
    collapseLeafNodes: "standard",
    includeInterNodeEdges: true,
    edgeFilters: { Label: [] },
    edgeFilterModes: { Label: "include" },
    excludeClosingEdges: { Label: [] },
    requireClosingEdges: { Label: [] },
    ...(overrides.settings || {}),
  },
  ...overrides,
});

const renderEditor = (extraProps = {}) => {
  const store = configureStore({ reducer: { graph: graphStub } });
  const onUpdateSettings = jest.fn();
  render(
    <Provider store={store}>
      <PhaseEditor
        phase={makePhase(extraProps.phase)}
        phaseIndex={0}
        onUpdate={jest.fn()}
        onUpdateSettings={onUpdateSettings}
        onAddOriginNode={jest.fn()}
        onRemoveOriginNode={jest.fn()}
        onToggleAdvancedSettings={jest.fn()}
        onUpdatePerNodeSetting={jest.fn()}
        onExecute={jest.fn()}
        onDelete={jest.fn()}
        isExecuting={false}
        collections={["CL"]}
        edgeFilterOptions={{ Label: { type: "categorical", values: ["DERIVES_FROM"] } }}
        nodeDetails={{}}
      />
    </Provider>,
  );
  return { onUpdateSettings };
};

describe("PhaseEditor edge filter include/exclude mode", () => {
  it("renders Include and Exclude controls for a categorical field", () => {
    renderEditor();
    const toggle = screen.getByRole("group", { name: /Label filter mode/i });
    expect(within(toggle).getByRole("button", { name: /include/i })).toBeInTheDocument();
    expect(within(toggle).getByRole("button", { name: /exclude/i })).toBeInTheDocument();
  });

  it("clicking Exclude updates edgeFilterModes for that field", () => {
    const { onUpdateSettings } = renderEditor();
    const toggle = screen.getByRole("group", { name: /Label filter mode/i });
    fireEvent.click(within(toggle).getByRole("button", { name: /exclude/i }));
    expect(onUpdateSettings).toHaveBeenCalledWith("edgeFilterModes", { Label: "exclude" });
  });

  it("clicking Include restores include mode after exclude", () => {
    const { onUpdateSettings } = renderEditor({
      phase: { settings: { edgeFilterModes: { Label: "exclude" } } },
    });
    const toggle = screen.getByRole("group", { name: /Label filter mode/i });
    fireEvent.click(within(toggle).getByRole("button", { name: /include/i }));
    expect(onUpdateSettings).toHaveBeenCalledWith("edgeFilterModes", { Label: "include" });
  });
});
