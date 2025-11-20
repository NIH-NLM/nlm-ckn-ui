import { render, screen } from "@testing-library/react";
import { PrunedCollections } from "./Contexts";

// Dummy component to consume contexts
const ConsumerComponent = () => {
  return (
    <PrunedCollections.Consumer>
      {(value) => <div>{`Pruned: ${value.join(", ")}`}</div>}
    </PrunedCollections.Consumer>
  );
};

describe("Contexts", () => {
  it("should provide default values to consumers", () => {
    render(<ConsumerComponent />);

    // Test default values from contexts
    expect(screen.getByText("Pruned: NCBITaxon")).toBeInTheDocument();
  });

  it("should provide updated values when context values change", () => {
    const Wrapper = ({ children }) => {
      return (
        <PrunedCollections.Provider value={["UpdatedTaxon"]}>{children}</PrunedCollections.Provider>
      );
    };

    render(
      <Wrapper>
        <ConsumerComponent />
      </Wrapper>,
    );

    // Test updated values from contexts
    expect(screen.getByText("Pruned: UpdatedTaxon")).toBeInTheDocument();
  });
});
