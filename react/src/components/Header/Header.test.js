import { fireEvent, render, screen } from "@testing-library/react";
import { ActiveNavProvider, GraphContext } from "contexts";
import { MemoryRouter } from "react-router-dom"; // Wrap with Router for routing context
import Header from "./Header";

// SearchBar pulls in the results table + search service; stub the table so the
// header test targets composition, not search internals.
jest.mock("components/SearchResultsTable/SearchResultsTable", () => () => (
  <div data-testid="search-results-table" />
));

const renderHeader = (initialEntries = ["/"]) =>
  render(
    <MemoryRouter initialEntries={initialEntries}>
      <GraphContext.Provider value={{ graphType: "phenotypes" }}>
        <ActiveNavProvider>
          <Header />
        </ActiveNavProvider>
      </GraphContext.Provider>
    </MemoryRouter>,
  );

describe("Header", () => {
  it("renders the brand, the header search, and the nav links", () => {
    renderHeader();
    expect(screen.getByAltText(/NLM Cell Knowledge Network logo/i)).toBeInTheDocument();
    expect(screen.getByText("NLM Cell Knowledge Network")).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText("Search gene, tissue, cell set, publication..."),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Collections" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Graph" })).toBeInTheDocument();
  });
});

describe("Header Component", () => {
  test("renders without crashing", () => {
    renderHeader();
  });

  test("renders all navigation links", () => {
    renderHeader();

    // Check if each navigation link is rendered
    expect(screen.getByText(/Explore/i)).toBeInTheDocument();
    expect(screen.getByText(/collections/i)).toBeInTheDocument();
    expect(screen.getByText(/Graph/i)).toBeInTheDocument();
    expect(screen.getByText(/About/i)).toBeInTheDocument();
  });

  test("sets active class for correct link based on location", () => {
    // Simulate different routes and check if the active class is applied to the correct link
    renderHeader(["/tree"]);

    expect(screen.getByText(/Explore/i)).toHaveClass("active-nav"); // /tree should be active
    expect(screen.getByText(/collections/i)).not.toHaveClass("active-nav");
  });

  test("updates active class when location changes by clicking a link", () => {
    renderHeader(["/collections"]);

    // Check the initial active class
    expect(screen.getByText(/collections/i)).toHaveClass("active-nav");
    expect(screen.getByText(/Explore/i)).not.toHaveClass("active-nav");

    // Simulate a click event on the "Explore" link to navigate to `/tree`
    fireEvent.click(screen.getByText(/Explore/i));

    // Check if the active class switches to the "Explore" link after the click
    expect(screen.getByText(/Explore/i)).toHaveClass("active-nav");
    expect(screen.getByText(/collections/i)).not.toHaveClass("active-nav");
  });
});
