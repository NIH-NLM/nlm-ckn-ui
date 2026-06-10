import { render, screen } from "@testing-library/react";
import { SkeletonCard, SkeletonLine, SkeletonTable, SkeletonWrapper } from "./Skeleton";

describe("SkeletonWrapper", () => {
  it("renders as a div with role=status and aria-live=polite", () => {
    const { container } = render(
      <SkeletonWrapper>
        <SkeletonLine />
      </SkeletonWrapper>,
    );
    const wrapper = container.firstChild;
    expect(wrapper.tagName.toLowerCase()).toBe("div");
    expect(wrapper).toHaveAttribute("role", "status");
    expect(wrapper).toHaveAttribute("aria-live", "polite");
  });

  it("renders the default visually-hidden Loading... text", () => {
    render(
      <SkeletonWrapper>
        <SkeletonLine />
      </SkeletonWrapper>,
    );
    const hidden = screen.getByText("Loading...");
    expect(hidden).toHaveClass("visually-hidden");
  });

  it("renders a custom label when provided", () => {
    render(
      <SkeletonWrapper label="Fetching results...">
        <SkeletonLine />
      </SkeletonWrapper>,
    );
    expect(screen.getByText("Fetching results...")).toHaveClass("visually-hidden");
  });
});

describe("SkeletonLine", () => {
  it("renders with skeleton class and aria-hidden", () => {
    const { container } = render(<SkeletonLine />);
    const el = container.firstChild;
    expect(el).toHaveClass("skeleton");
    expect(el).toHaveClass("skeleton-line");
    expect(el).toHaveAttribute("aria-hidden", "true");
  });

  it("applies custom width and height via inline style", () => {
    const { container } = render(<SkeletonLine width="60%" height="1.5em" />);
    const el = container.firstChild;
    expect(el).toHaveStyle({ width: "60%", height: "1.5em" });
  });
});

describe("SkeletonCard", () => {
  it("renders with aria-hidden", () => {
    const { container } = render(<SkeletonCard />);
    const card = container.firstChild;
    expect(card).toHaveAttribute("aria-hidden", "true");
    expect(card).toHaveClass("skeleton-card");
  });

  it("renders multiple skeleton lines inside the card", () => {
    const { container } = render(<SkeletonCard />);
    const lines = container.querySelectorAll(".skeleton");
    expect(lines.length).toBeGreaterThan(1);
  });
});

describe("SkeletonTable", () => {
  it("renders with aria-hidden", () => {
    const { container } = render(<SkeletonTable />);
    const table = container.querySelector("table");
    expect(table).toHaveAttribute("aria-hidden", "true");
    expect(table).toHaveClass("skeleton-table");
  });

  it("renders the correct number of rows", () => {
    const { container } = render(<SkeletonTable rows={3} columns={2} />);
    const bodyRows = container.querySelectorAll("tbody tr");
    expect(bodyRows).toHaveLength(3);
  });

  it("renders the correct number of columns per row", () => {
    const { container } = render(<SkeletonTable rows={2} columns={4} />);
    const firstRowCells = container.querySelectorAll("tbody tr:first-child td");
    expect(firstRowCells).toHaveLength(4);
  });

  it("renders default 5 rows and 3 columns", () => {
    const { container } = render(<SkeletonTable />);
    expect(container.querySelectorAll("tbody tr")).toHaveLength(5);
    expect(container.querySelectorAll("tbody tr:first-child td")).toHaveLength(3);
  });
});
