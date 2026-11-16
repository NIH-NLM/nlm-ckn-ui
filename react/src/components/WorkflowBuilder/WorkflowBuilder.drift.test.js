import { TextDecoder, TextEncoder } from "node:util";
import { configureStore } from "@reduxjs/toolkit";
import { fireEvent, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { fetchCollections, fetchEdgeFilterOptions } from "services";
import { workflowBuilderReducer } from "store";
import WorkflowBuilder from "./WorkflowBuilder";

// WorkflowBuilder (editor view) reaches into both the workflowBuilder slice and
// the (redux-undo wrapped) graph slice. It also fires off collection / edge
// filter option fetches on mount via useGraphDataInit — stub those out so the
// test doesn't hit the network.
// react-scripts' Jest config runs with resetMocks: true, which wipes any
// mockResolvedValue set inside the factory before the first test even runs —
// so the resolved values are (re)applied in beforeEach instead.
jest.mock("services", () => ({
  fetchCollections: jest.fn(),
  fetchEdgeFilterOptions: jest.fn(),
}));

beforeEach(() => {
  fetchCollections.mockResolvedValue([]);
  fetchEdgeFilterOptions.mockResolvedValue({});
});

// A minimal stub reducer: WorkflowBuilder only reads graph.present.settings.*
// and graph.present.availableEdgeFilters, so it doesn't need the real
// (undoable) graph slice.
const graphStub = () => ({
  present: {
    settings: { graphType: "ontologies", allCollections: [] },
    availableEdgeFilters: {},
  },
});

const renderBuilder = (overrides = {}) => {
  const store = configureStore({
    reducer: { graph: graphStub, workflowBuilder: workflowBuilderReducer },
    preloadedState: {
      workflowBuilder: {
        ...workflowBuilderReducer(undefined, { type: "@@INIT" }),
        ...overrides,
      },
    },
  });
  render(
    <Provider store={store}>
      <WorkflowBuilder />
    </Provider>,
  );
};

describe("WorkflowBuilder schema-drift banner", () => {
  it("shows a banner naming the missing labels", () => {
    renderBuilder({ unknownLabels: ["MEMBER_OF"], showPresetSelector: false });
    expect(screen.getByRole("status")).toHaveTextContent("MEMBER_OF");
  });

  it("explains the likely cause", () => {
    renderBuilder({ unknownLabels: ["MEMBER_OF"], showPresetSelector: false });
    expect(screen.getByRole("status")).toHaveTextContent(/schema change/i);
  });

  it("shows no banner for a clean workflow", () => {
    renderBuilder({ unknownLabels: [], showPresetSelector: false });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("dismisses on request", () => {
    renderBuilder({ unknownLabels: ["MEMBER_OF"], showPresetSelector: false });
    fireEvent.click(screen.getByRole("button", { name: /dismiss/i }));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});

describe("WorkflowBuilder sharing", () => {
  it("includes the solution in the shared link", () => {
    // jsdom does not provide the encoders the share handler uses.
    Object.assign(global, { TextEncoder, TextDecoder });
    const writeText = jest.fn();
    Object.assign(navigator, { clipboard: { writeText } });
    const solution = { phaseId: "p1", collection: "CS", linkedColumns: [], fields: ["x"] };
    renderBuilder({
      showPresetSelector: false,
      solution,
      phases: [{ id: "p1", name: "", originSource: "manual", originNodeIds: [], settings: {} }],
    });
    fireEvent.click(screen.getByRole("button", { name: /share/i }));
    const url = writeText.mock.calls[0][0];
    const encoded = decodeURIComponent(url.split("?w=")[1]);
    const bytes = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
    expect(JSON.parse(new TextDecoder().decode(bytes)).solution).toEqual(solution);
  });
});
