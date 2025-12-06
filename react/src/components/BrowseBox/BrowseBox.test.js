import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
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

// Helper to render with router at a specific collection path
const renderAtPath = (path) => {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/collections/:coll" element={<BrowseBox />} />
        <Route path="/collections" element={<BrowseBox />} />
      </Routes>
    </MemoryRouter>,
  );
};

describe("BrowseBox", () => {
  beforeEach(() => {
    // Mock Services and Utils
    const mockFetchedData = ["Collection 1", "Collection 2", "Collection 3"];
    Services.fetchCollections.mockResolvedValue(mockFetchedData);
    Services.fetchCollectionDocuments.mockResolvedValue([]);
    Utils.parseCollections.mockImplementation((data) => data);
  });

  it("should render collections", async () => {
    renderAtPath("/collections/Collection 2");

    // Check collections are rendered
    await waitFor(() => {
      expect(screen.getAllByText(/Collection 1/)[0]).toBeInTheDocument();
      expect(screen.getAllByText(/Collection 2/)[0]).toBeInTheDocument();
      expect(screen.getAllByText(/Collection 3/)[0]).toBeInTheDocument();
    });
  });

  it("should highlight the active collection based on URL param", async () => {
    renderAtPath("/collections/Collection 2");

    // Check appropriate collection is highlighted (based on URL param)
    await waitFor(() => {
      const links = screen.getAllByRole("link");
      const collection1Link = links.find((link) => link.textContent.includes("Collection 1"));
      const collection2Link = links.find((link) => link.textContent.includes("Collection 2"));
      const collection3Link = links.find((link) => link.textContent.includes("Collection 3"));

      expect(collection1Link).not.toHaveClass("active");
      expect(collection2Link).toHaveClass("active");
      expect(collection3Link).not.toHaveClass("active");
    });
  });

  it("should render links to each collection with correct href", async () => {
    renderAtPath("/collections/Collection 2");

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
