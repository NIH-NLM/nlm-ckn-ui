import { render, screen } from "@testing-library/react";
import NodeLabel from "./NodeLabel";

// Uses the shipped collection maps, so the CSD label and title read as they do
// in the app.
const csd = (overrides = {}) => ({
  _id: "CSD/25b62707__kidney",
  _key: "25b62707__kidney",
  Name: "Lake (2023) Nature - Kidney atlas",
  Citation: "Lake (2023) Nature",
  anatomical_structure: "kidney",
  is_reference_dataset: "False",
  ...overrides,
});

describe("NodeLabel", () => {
  it("shows the label followed by a Reference badge for a reference dataset", () => {
    const { container } = render(<NodeLabel item={csd({ is_reference_dataset: "True" })} />);
    expect(container).toHaveTextContent('Lake (2023) Nature - "Kidney atlas" for kidney');
    const badge = screen.getByText("Reference");
    expect(badge).toHaveClass("node-badge");
    expect(badge).toHaveAttribute(
      "title",
      "Reference dataset for kidney, used to classify other cell set data",
    );
  });

  it("shows the label alone when the document has no badges", () => {
    const { container } = render(<NodeLabel item={csd()} />);
    expect(container).toHaveTextContent('Lake (2023) Nature - "Kidney atlas" for kidney');
    expect(screen.queryByText("Reference")).not.toBeInTheDocument();
  });

  it("shows the collection-prefixed title when asTitle is set", () => {
    const { container } = render(
      <NodeLabel item={csd({ is_reference_dataset: "True" })} asTitle />,
    );
    expect(container).toHaveTextContent(/^Cell Set Dataset: Lake \(2023\) Nature/);
    expect(screen.getByText("Reference")).toBeInTheDocument();
  });
});
