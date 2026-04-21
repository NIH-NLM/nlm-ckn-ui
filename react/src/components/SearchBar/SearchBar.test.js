import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { GraphContext } from "../../contexts";
import SearchBar from "./SearchBar";

// Use fake timers for debounce and timeout testing
jest.useFakeTimers();

// Mock SearchResultsTable to simplify testing
jest.mock("../SearchResultsTable/SearchResultsTable", () => (props) => (
  <div data-testid="search-results-table">
    {props.searchResults?.map((item) => (
      <div key={item._id || item.label} data-testid="search-result-item">
        {item.label || item._id}
      </div>
    ))}
  </div>
));

// Wrapper with context
const renderWithContext = (component, graphType = "phenotypes") => {
  return render(
    <MemoryRouter>
      <GraphContext.Provider value={{ graphType }}>{component}</GraphContext.Provider>
    </MemoryRouter>,
  );
};

describe("SearchBar Component", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders the input field and child components", () => {
    renderWithContext(<SearchBar />);

    const input = screen.getByPlaceholderText("Search NLM-CKN...");
    expect(input).toBeInTheDocument();

    const resultsTable = screen.getByTestId("search-results-table");
    expect(resultsTable).toBeInTheDocument();
  });

  it("shows search results dropdown when input has focus and text", async () => {
    renderWithContext(<SearchBar />);
    const input = screen.getByPlaceholderText("Search NLM-CKN...");

    // Focus and type in the input
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "test" } });

    // Advance timers by 250ms to trigger the debounce
    await act(async () => {
      jest.advanceTimersByTime(250);
    });

    // Wait for the dropdown to show
    await waitFor(() => {
      const dropdown = screen.getByTestId("search-results-table").parentElement;
      expect(dropdown).toHaveClass("show");
    });
  });

  it("hides search results when clicking outside", async () => {
    renderWithContext(<SearchBar />);
    const input = screen.getByPlaceholderText("Search NLM-CKN...");

    // Focus and type to show results
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "test" } });

    await act(async () => {
      jest.advanceTimersByTime(250);
    });

    // Wait for dropdown to be visible
    await waitFor(() => {
      const dropdown = screen.getByTestId("search-results-table").parentElement;
      expect(dropdown).toHaveClass("show");
    });

    // Click outside
    fireEvent.mouseDown(document.body);

    // Dropdown should be hidden
    await waitFor(() => {
      const dropdown = screen.getByTestId("search-results-table").parentElement;
      expect(dropdown).not.toHaveClass("show");
    });
  });

  // TODO: Add test for searchDocuments service call - requires fixing mock isolation issues
  it.todo("calls searchDocuments service after debounce when input changes");
});
