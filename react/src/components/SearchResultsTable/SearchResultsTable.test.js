import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import SearchResultsTable from "./SearchResultsTable";

describe("SearchResultsTable", () => {
  const sampleResults = {
    fruits: [
      { _id: "CL/0", label: "Apple", definition: "apple" },
      { _id: "CL/1", label: "Banana", definition: "banana" },
    ],
    vegetables: [{ _id: "CL/2", label: "Carrot", definition: "carrot" }],
    dairy: [{ _id: "CL/0", definition: "milk" }],
    empty: [], // This key should be filtered out.
  };

  const handleSelectItem = jest.fn();

  beforeEach(() => {
    handleSelectItem.mockClear();
  });

  test("renders headers and toggles expansion to show items", () => {
    render(
      <MemoryRouter>
        <SearchResultsTable searchResults={sampleResults} handleSelectItem={handleSelectItem} />
      </MemoryRouter>,
    );

    // Only non-empty keys should be rendered as headers.
    expect(screen.getByText("fruits")).toBeInTheDocument();
    expect(screen.getByText("vegetables")).toBeInTheDocument();
    expect(screen.getByText("dairy")).toBeInTheDocument();
    expect(screen.queryByText("empty")).not.toBeInTheDocument();

    // Initially, items should not be visible
    expect(screen.queryByText("Apple")).not.toBeInTheDocument();
    expect(screen.queryByText("Carrot")).not.toBeInTheDocument();
    expect(screen.queryByText("milk")).not.toBeInTheDocument();

    // Click on the "fruits" header to expand it
    fireEvent.click(screen.getByText("fruits"));
    expect(screen.getByText("Apple")).toBeInTheDocument();
    expect(screen.getByText("Banana")).toBeInTheDocument();

    // Expand "vegetables" header
    fireEvent.click(screen.getByText("vegetables"));
    expect(screen.getByText("Carrot")).toBeInTheDocument();

    // Expand "dairy" header
    fireEvent.click(screen.getByText("dairy"));
    expect(screen.getByText("milk")).toBeInTheDocument();
  });

  test("calls handleSelectItem when plus sign is clicked", () => {
    render(
      <MemoryRouter>
        <SearchResultsTable searchResults={sampleResults} handleSelectItem={handleSelectItem} />
      </MemoryRouter>,
    );

    // Expand the "fruits" header so that its items are visible.
    fireEvent.click(screen.getByTestId("header-fruits"));

    // Locate the container for "Apple" and click its plus icon.
    const appleItem = screen.getByText("Apple").closest(".result-list-item");
    const applePlus = within(appleItem).getByText("+");
    fireEvent.click(applePlus);
    expect(handleSelectItem).toHaveBeenCalledWith({
      _id: "CL/0",
      label: "Apple",
      definition: "apple",
    });

    // Expand the "vegetables" header and locate the "Carrot" container.
    fireEvent.click(screen.getByTestId("header-vegetables"));
    const carrotItem = screen.getByText("Carrot").closest(".result-list-item");
    const carrotPlus = within(carrotItem).getByText("+");
    fireEvent.click(carrotPlus);
    expect(handleSelectItem).toHaveBeenCalledWith({
      _id: "CL/2",
      label: "Carrot",
      definition: "carrot",
    });
  });
});
