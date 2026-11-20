import { fireEvent, render, screen } from "@testing-library/react";
import ResultsViewSwitch from "components/WorkflowBuilder/ResultsViewSwitch";

describe("ResultsViewSwitch", () => {
  it("marks the current view as pressed", () => {
    render(<ResultsViewSwitch view="graph" onChange={() => {}} />);
    expect(screen.getByRole("button", { name: "Graph" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Table" })).toHaveAttribute("aria-pressed", "false");
  });

  it("reports the chosen view", () => {
    const onChange = jest.fn();
    render(<ResultsViewSwitch view="graph" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Table" }));
    expect(onChange).toHaveBeenCalledWith("table");
  });

  it("names the group", () => {
    render(<ResultsViewSwitch view="table" onChange={() => {}} />);
    expect(screen.getByRole("group", { name: "Show results as" })).toBeInTheDocument();
  });
});
