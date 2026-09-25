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

describe("PhaseEditor direction control on Connected Paths", () => {
  const connectedPathsPhase = {
    originNodeIds: ["UBERON/0001004", "CL/0000066"],
    settings: { setOperation: "Connected Paths" },
  };

  it("disables the shared direction select, which the path search cannot honour", () => {
    renderEditor({ phase: connectedPathsPhase });

    expect(screen.getByLabelText("Direction")).toBeDisabled();
  });

  it("leaves the shared direction select enabled for a Union phase", () => {
    renderEditor({
      phase: {
        originNodeIds: ["UBERON/0001004", "CL/0000066"],
        settings: { setOperation: "Union" },
      },
    });

    expect(screen.getByLabelText("Direction")).toBeEnabled();
  });

  it("disables every per-node direction select on Connected Paths", () => {
    renderEditor({
      phase: {
        ...connectedPathsPhase,
        showAdvancedSettings: true,
        perNodeSettings: { "UBERON/0001004": { depth: 4 } },
      },
    });

    const directionSelects = screen.getAllByLabelText(/Direction:/);
    expect(directionSelects).toHaveLength(2);
    for (const select of directionSelects) {
      expect(select).toBeDisabled();
    }
  });

  it("keeps per-node depth selects enabled on Connected Paths", () => {
    renderEditor({
      phase: {
        ...connectedPathsPhase,
        showAdvancedSettings: true,
        perNodeSettings: { "UBERON/0001004": { depth: 4 } },
      },
    });

    for (const select of screen.getAllByLabelText(/Depth:/)) {
      expect(select).toBeEnabled();
    }
  });
});
