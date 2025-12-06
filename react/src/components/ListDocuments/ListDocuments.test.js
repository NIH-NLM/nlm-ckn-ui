import { render, screen } from "@testing-library/react";
import { BrowserRouter as Router } from "react-router-dom";
import ListDocuments from "./ListDocuments";

// Mock the utils module - use __esModule to ensure proper export handling
jest.mock("../../utils", () => {
  return {
    __esModule: true,
    getLabel: (item) => {
      if (Array.isArray(item.label)) {
        return item.label.join(",");
      }
      return item.label || item._id;
    },
  };
});

describe("ListDocuments Component", () => {
  it("renders a single label correctly", () => {
    const document = { _id: "CL/123", label: "Sample Label" };

    render(
      <Router>
        <ListDocuments document={document} />
      </Router>,
    );

    // Check if the label is rendered correctly
    expect(screen.getByText("Sample Label")).toBeInTheDocument();

    // Check if the link has the correct href based on _id
    const linkElement = screen.getByRole("link");
    expect(linkElement).toHaveAttribute("href", "/collections/CL/123");
  });

  it("renders an array label correctly", () => {
    const document = { _id: "CL/123", label: ["Label1", "Label2"] };

    render(
      <Router>
        <ListDocuments document={document} />
      </Router>,
    );

    // Check if the labels are joined by ',' (matching actual getLabel behavior)
    expect(screen.getByText("Label1,Label2")).toBeInTheDocument();

    const linkElement = screen.getByRole("link");
    expect(linkElement).toHaveAttribute("href", "/collections/CL/123");
  });
});
