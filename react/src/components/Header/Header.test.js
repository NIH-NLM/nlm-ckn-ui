import { configureStore } from "@reduxjs/toolkit";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ActiveNavProvider, GraphContext } from "contexts";
import { Provider } from "react-redux";
import { MemoryRouter, useLocation } from "react-router-dom"; // Wrap with Router for routing context
import AppRoutes from "../../AppRoutes";
import nodesReducer from "../../store/nodesSlice";
import { ToastProvider } from "../Toast";
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
    renderHeader(["/graph"]);
    expect(screen.getByAltText(/NLM Cell Knowledge Network logo/i)).toBeInTheDocument();
    expect(screen.getByText("NLM Cell Knowledge Network")).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/search/i)).toBeInTheDocument();
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
    expect(screen.getByText(/Browse/i)).toBeInTheDocument();
    expect(screen.getByText(/collections/i)).toBeInTheDocument();
    expect(screen.getByText(/Graph/i)).toBeInTheDocument();
    expect(screen.getByText(/About/i)).toBeInTheDocument();
  });

  test("sets active class for correct link based on location", () => {
    // Simulate different routes and check if the active class is applied to the correct link
    renderHeader(["/browse"]);

    expect(screen.getByText(/Browse/i)).toHaveClass("active-nav"); // /browse should be active
    expect(screen.getByText(/collections/i)).not.toHaveClass("active-nav");
  });

  test("updates active class when location changes by clicking a link", () => {
    renderHeader(["/collections"]);

    // Check the initial active class
    expect(screen.getByText(/collections/i)).toHaveClass("active-nav");
    expect(screen.getByText(/Browse/i)).not.toHaveClass("active-nav");

    // Simulate a click event on the "Browse" link to navigate to `/browse`
    fireEvent.click(screen.getByText(/Browse/i));

    // Check if the active class switches to the "Browse" link after the click
    expect(screen.getByText(/Browse/i)).toHaveClass("active-nav");
    expect(screen.getByText(/collections/i)).not.toHaveClass("active-nav");
  });
});

describe("Legacy sunburst/tree redirects", () => {
  // Reads the router's live location so the assertion below reflects
  // whatever AppRoutes actually resolved to, not a value the test hands it.
  const LocationDisplay = () => {
    const location = useLocation();
    return <div data-testid="location-display">{location.pathname + location.search}</div>;
  };

  const testStore = () =>
    configureStore({
      reducer: { nodesSlice: nodesReducer },
      preloadedState: { nodesSlice: { originNodeIds: [] } },
    });

  const renderAt = (initialEntries) =>
    render(
      <Provider store={testStore()}>
        <MemoryRouter initialEntries={initialEntries}>
          <ToastProvider>
            <LocationDisplay />
            <AppRoutes />
          </ToastProvider>
        </MemoryRouter>
      </Provider>,
    );

  beforeEach(() => {
    // AppRoutes lands on /browse, which fetches its own hierarchy data. The
    // redirect target is all this test cares about, so answer with a
    // minimal, well-formed root and label list rather than mocking every
    // request shape Browse might otherwise send.
    global.fetch = jest.fn((url) => {
      if (url.includes("/hierarchy/labels/")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          statusText: "OK",
          json: () => Promise.resolve([{ label: "SUB_CLASS_OF", root: "CL/0000000" }]),
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        statusText: "OK",
        json: () =>
          Promise.resolve({
            _id: "CL/0000000",
            label: "cell",
            descendant_count: 0,
            weight: 1,
            value: 1,
            _hasChildren: false,
            children: [],
          }),
      });
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // This asserts against AppRoutes, the same route table App.js renders --
  // not a redeclared copy of the two redirect routes, which would keep
  // passing even if App.js dropped them.
  it("redirects /sunburst to /browse with view=sunburst", async () => {
    renderAt(["/sunburst"]);
    expect(screen.getByTestId("location-display")).toHaveTextContent("/browse?view=sunburst");
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));
  });

  it("redirects /tree to /browse with view=tree", async () => {
    renderAt(["/tree"]);
    expect(screen.getByTestId("location-display")).toHaveTextContent("/browse?view=tree");
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));
  });
});
