import { configureStore } from "@reduxjs/toolkit";
import { fireEvent, render, screen } from "@testing-library/react";
import GraphWorkspace from "components/GraphWorkspace";
import { Provider } from "react-redux";
import graphReducer from "store/graphSlice";
import savedGraphsReducer from "store/savedGraphsSlice";

// Stub heavy children so the test targets composition + selection wiring.
jest.mock("components/ForceGraph/ForceGraph", () => ({ onNodeSelect }) => (
  <button type="button" onClick={() => onNodeSelect("CS/clicked")}>
    graph
  </button>
));
jest.mock("components/NodeInspector", () => ({ selectedNodeId, originDocument }) => (
  <div data-testid="inspector">{selectedNodeId ?? originDocument._id}</div>
));
jest.mock("components/SavedGraphShelf", () => () => <div data-testid="shelf" />);

const renderWorkspace = () => {
  const store = configureStore({
    reducer: { graph: graphReducer, savedGraphs: savedGraphsReducer },
  });
  return render(
    <Provider store={store}>
      <GraphWorkspace
        originDocument={{ _id: "CSD/origin" }}
        nodeIds={["CSD/origin"]}
        settings={{}}
      />
    </Provider>,
  );
};

describe("GraphWorkspace", () => {
  it("shows the origin document in the inspector by default", () => {
    renderWorkspace();
    expect(screen.getByTestId("inspector")).toHaveTextContent("CSD/origin");
    expect(screen.getByTestId("shelf")).toBeInTheDocument();
  });

  it("swaps the inspector to the clicked node", () => {
    renderWorkspace();
    fireEvent.click(screen.getByText("graph"));
    expect(screen.getByTestId("inspector")).toHaveTextContent("CS/clicked");
  });
});
