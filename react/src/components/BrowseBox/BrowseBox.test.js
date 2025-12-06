import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import * as Services from "../../services";
import * as Utils from "../../utils";
import BrowseBox from "./BrowseBox";

// Mocking the services and utils
jest.mock("../../services", () => ({
  fetchCollections: jest.fn(),
  fetchCollectionDocuments: jest.fn(),
}));

jest.mock("../../utils", () => ({
  parseCollections: jest.fn(),
  getLabel: jest.fn((item) => item.label || item._id),
}));

describe("BrowseBox", () => {
  beforeEach(() => {
    // Mock Services and Utils
    const mockFetchedData = ["Collection 1", "Collection 2", "Collection 3"];
    Services.fetchCollections.mockResolvedValue(mockFetchedData);
    Services.fetchCollectionDocuments.mockResolvedValue([]);
    Utils.parseCollections.mockImplementation((data) => data);
    // Render the BrowseBox with a Router wrapper and currentCollection prop

    render(
      <MemoryRouter>
        <BrowseBox currentCollection="Collection 2" />
      </MemoryRouter>,
    );
  });
  it("should render collections", async () => {
    // Check collections are rendered
    await waitFor(() => {
      expect(screen.getAllByText(/Collection 1/)[0]).toBeInTheDocument();
      expect(screen.getAllByText(/Collection 2/)[0]).toBeInTheDocument();
      expect(screen.getAllByText(/Collection 3/)[0]).toBeInTheDocument();
    });
  });
  it("should highlight the active collection", async () => {
    // Check appropriate collection is highlighted
    await waitFor(() => {
      expect(screen.getAllByText(/Collection 1/)[0].closest("a")).not.toHaveClass("active");
      expect(screen.getAllByText(/Collection 2/)[0].closest("a")).toHaveClass("active");
      expect(screen.getAllByText(/Collection 3/)[0].closest("a")).not.toHaveClass("active");
    });
  });

  it("should render links to each collection with correct href", async () => {
    // Check hrefs are populated correctly
    await waitFor(() => {
      expect(screen.getAllByText(/Collection 1/)[0].closest("a")).toHaveAttribute(
        "href",
        "/collections/Collection 1",
      );
      expect(screen.getAllByText(/Collection 2/)[0].closest("a")).toHaveAttribute(
        "href",
        "/collections/Collection 2",
      );
      expect(screen.getAllByText(/Collection 3/)[0].closest("a")).toHaveAttribute(
        "href",
        "/collections/Collection 3",
      );
    });
  });
});
