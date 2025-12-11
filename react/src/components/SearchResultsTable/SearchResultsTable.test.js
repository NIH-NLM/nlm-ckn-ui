import { configureStore } from "@reduxjs/toolkit";
import { render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import nodesReducer from "../../store/nodesSlice";
import SearchResultsTable from "./SearchResultsTable";

// Create a test store
const createTestStore = () =>
  configureStore({
    reducer: {
      nodesSlice: nodesReducer,
    },
  });

// Mock collection maps
jest.mock("../../assets/cell-kn-mvp-collection-maps.json", () => ({
  maps: [
    ["CL", { display_name: "Cell Types" }],
    ["GO", { display_name: "Gene Ontology" }],
  ],
}));

// Mock utils - include all needed exports
jest.mock("../../utils", () => {
  return {
    __esModule: true,
    getLabel: (item) => item.label || item._id,
    getColorForCollection: jest.fn(() => "#336699"),
  };
});

// Wrapper component for tests
const renderWithProviders = (component) => {
  return render(
    <Provider store={createTestStore()}>
      <MemoryRouter>{component}</MemoryRouter>
    </Provider>,
  );
};

describe("SearchResultsTable", () => {
  // New flat array format (no longer grouped by key)
  const sampleResults = [
    { _id: "CL/0", label: "Apple" },
    { _id: "CL/1", label: "Banana" },
    { _id: "GO/2", label: "Carrot" },
  ];

  test("renders search results as links", () => {
    renderWithProviders(<SearchResultsTable searchResults={sampleResults} />);

    // Items should be rendered as links
    expect(screen.getByText("Apple")).toBeInTheDocument();
    expect(screen.getByText("Banana")).toBeInTheDocument();
    expect(screen.getByText("Carrot")).toBeInTheDocument();
  });

  test("shows no results message when array is empty", () => {
    renderWithProviders(<SearchResultsTable searchResults={[]} />);

    expect(screen.getByText("No results found.")).toBeInTheDocument();
  });

  test("shows no results message when searchResults is not an array", () => {
    renderWithProviders(<SearchResultsTable searchResults={null} />);

    expect(screen.getByText("No results found.")).toBeInTheDocument();
  });

  test("renders collection tags with correct display names", () => {
    renderWithProviders(<SearchResultsTable searchResults={sampleResults} />);

    // Collection tags should show display names
    expect(screen.getAllByText("Cell Types").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Gene Ontology").length).toBeGreaterThan(0);
  });
});
