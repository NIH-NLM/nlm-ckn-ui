import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import * as utils from "../../utils";
import SelectedItemsTable from "./SelectedItemsTable";

// Mock the utils module
jest.mock("../../utils", () => ({
  ...jest.requireActual("../../utils"),
  getLabel: jest.fn((item) => item.label || item._id),
  getUrl: jest.fn((item) => item.url || null),
}));

describe("SelectedItemsTable", () => {
  const selectedItems = [
    { _id: "1", label: "Label1", url: "https://example.com/1" },
    { _id: "2", label: "Label2", url: "https://example.com/2" },
  ];

  beforeEach(() => {
    // Reset mocks and ensure getLabel returns the label
    utils.getLabel.mockImplementation((item) => item.label || item._id);
    utils.getUrl.mockImplementation((item) => item.url || null);
  });

  it("renders nothing if selectedItems array is empty", () => {
    const { container } = render(
      <SelectedItemsTable
        selectedItems={[]}
        generateGraph={jest.fn()}
        removeSelectedItem={jest.fn()}
      />,
    );
    // Component returns false when no items
    expect(container.firstChild).toBeNull();
  });

  it("renders the table with headers and rows for each selected item", () => {
    render(
      <MemoryRouter>
        <SelectedItemsTable
          selectedItems={selectedItems}
          generateGraph={jest.fn()}
          removeSelectedItem={jest.fn()}
        />
      </MemoryRouter>,
    );

    // Check for title
    expect(screen.getByText("Origin Nodes")).toBeInTheDocument();

    // Check that each row is rendered with the labels
    expect(screen.getByText("Label1")).toBeInTheDocument();
    expect(screen.getByText("Label2")).toBeInTheDocument();
  });

  it("calls removeSelectedItem when a Remove button is clicked", () => {
    const removeSelectedItemMock = jest.fn();

    render(
      <MemoryRouter>
        <SelectedItemsTable
          selectedItems={selectedItems}
          generateGraph={jest.fn()}
          removeSelectedItem={removeSelectedItemMock}
        />
      </MemoryRouter>,
    );

    // There should be two Remove buttons. Simulate click on the first.
    const removeButtons = screen.getAllByText("Remove");
    fireEvent.click(removeButtons[0]);

    expect(removeSelectedItemMock).toHaveBeenCalledWith(selectedItems[0]);
  });

  it("calls generateGraph when the Generate Graph button is clicked", () => {
    const generateGraphMock = jest.fn();

    render(
      <MemoryRouter>
        <SelectedItemsTable
          selectedItems={selectedItems}
          generateGraph={generateGraphMock}
          removeSelectedItem={jest.fn()}
        />
      </MemoryRouter>,
    );

    // Find and click the Generate Graph button
    const generateGraphButton = screen.getByText("Generate Graph");
    fireEvent.click(generateGraphButton);

    // generateGraph is called without arguments (it reads from state)
    expect(generateGraphMock).toHaveBeenCalled();
  });

  it('renders a Link with the correct "to" attribute for each item', () => {
    render(
      <MemoryRouter>
        <SelectedItemsTable
          selectedItems={selectedItems}
          generateGraph={jest.fn()}
          removeSelectedItem={jest.fn()}
        />
      </MemoryRouter>,
    );

    // Find all view links and check the href for the first item
    const viewLinks = screen.getAllByText("View");
    expect(viewLinks[0].getAttribute("href")).toBe(`/collections/${selectedItems[0]._id}`);
  });
});
