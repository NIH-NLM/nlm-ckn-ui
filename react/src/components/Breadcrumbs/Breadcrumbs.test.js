import { render, screen } from "@testing-library/react";
import { MemoryRouter as Router } from "react-router-dom";
import Breadcrumbs from "./Breadcrumbs";

const renderWithRouter = (ui) => render(<Router>{ui}</Router>);

describe("Breadcrumbs Component", () => {
  test("renders nothing when crumbs is empty", () => {
    const { container } = renderWithRouter(<Breadcrumbs crumbs={[]} />);
    expect(container.firstChild).toBeNull();
  });

  test("renders nothing when crumbs is undefined", () => {
    const { container } = renderWithRouter(<Breadcrumbs />);
    expect(container.firstChild).toBeNull();
  });

  test("renders crumb labels", () => {
    const crumbs = [
      { label: "Home", path: "/" },
      { label: "Collections", path: "/collections" },
      { label: "Cell Ontology", path: "/collections/CL" },
    ];
    renderWithRouter(<Breadcrumbs crumbs={crumbs} />);

    expect(screen.getByText("Home")).toBeInTheDocument();
    expect(screen.getByText("Collections")).toBeInTheDocument();
    expect(screen.getByText("Cell Ontology")).toBeInTheDocument();
  });

  test("all but the last crumb are links", () => {
    const crumbs = [
      { label: "Home", path: "/" },
      { label: "Collections", path: "/collections" },
      { label: "Cell Ontology", path: "/collections/CL" },
    ];
    renderWithRouter(<Breadcrumbs crumbs={crumbs} />);

    expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute("href", "/");
    expect(screen.getByRole("link", { name: "Collections" })).toHaveAttribute(
      "href",
      "/collections",
    );
    expect(screen.queryByRole("link", { name: "Cell Ontology" })).not.toBeInTheDocument();
  });

  test("last crumb is plain text with aria-current=page", () => {
    const crumbs = [
      { label: "Home", path: "/" },
      { label: "Cell Ontology", path: "/collections/CL" },
    ];
    renderWithRouter(<Breadcrumbs crumbs={crumbs} />);

    const current = screen.getByText("Cell Ontology");
    expect(current.tagName).toBe("SPAN");
    expect(current).toHaveAttribute("aria-current", "page");
  });

  test("single crumb renders as plain text with no separator", () => {
    const crumbs = [{ label: "Home", path: "/" }];
    renderWithRouter(<Breadcrumbs crumbs={crumbs} />);

    expect(screen.getByText("Home")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.queryByText(">")).not.toBeInTheDocument();
  });

  test("renders nav with accessible label", () => {
    const crumbs = [{ label: "Home", path: "/" }];
    renderWithRouter(<Breadcrumbs crumbs={crumbs} />);

    expect(screen.getByRole("navigation", { name: "Breadcrumb" })).toBeInTheDocument();
  });
});
