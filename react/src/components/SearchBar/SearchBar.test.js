import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { searchDocuments } from "services";
import { GraphContext } from "../../contexts";
import SearchBar from "./SearchBar";

jest.mock("services", () => ({
  ...jest.requireActual("services"),
  searchDocuments: jest.fn(),
}));

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
    searchDocuments.mockResolvedValue([]);
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

  it("uses a custom placeholder when provided", () => {
    renderWithContext(<SearchBar placeholder="Search gene, tissue, cell set, publication..." />);
    expect(
      screen.getByPlaceholderText("Search gene, tissue, cell set, publication..."),
    ).toBeInTheDocument();
    // Guard against the prop being ignored: the default must not be rendered.
    expect(screen.queryByPlaceholderText("Search NLM-CKN...")).not.toBeInTheDocument();
  });

  it("calls searchDocuments service after debounce when input changes", async () => {
    renderWithContext(<SearchBar />);
    fireEvent.change(screen.getByPlaceholderText("Search NLM-CKN..."), {
      target: { value: "pericyte" },
    });
    expect(searchDocuments).not.toHaveBeenCalled();

    await act(async () => {
      jest.advanceTimersByTime(250);
    });

    expect(searchDocuments).toHaveBeenCalledTimes(1);
    expect(searchDocuments.mock.calls[0].slice(0, 2)).toEqual(["pericyte", "phenotypes"]);
  });

  it("uses an external search object when provided (controlled mode)", () => {
    const external = {
      query: "pericyte",
      setQuery: jest.fn(),
      results: [],
      isOpen: false,
      setIsOpen: jest.fn(),
      containerRef: { current: null },
    };
    renderWithContext(<SearchBar search={external} />);
    const input = screen.getByPlaceholderText("Search NLM-CKN...");
    expect(input).toHaveValue("pericyte");
    fireEvent.change(input, { target: { value: "lung" } });
    expect(external.setQuery).toHaveBeenCalledWith("lung");
  });
});
