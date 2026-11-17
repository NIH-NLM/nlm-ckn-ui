import { fireEvent, render, screen } from "@testing-library/react";
import SolutionTable from "components/WorkflowBuilder/SolutionTable";

const phaseResult = {
  nodes: [
    { _id: "CS/a", author_cell_term: "AT2" },
    { _id: "CS/b", author_cell_term: "Ionocyte" },
    { _id: "CL/c", label: "lung cell" },
  ],
  links: [],
};
const renderTable = (props) =>
  render(
    <SolutionTable
      phaseResult={phaseResult}
      allPhaseResults={{ p1: phaseResult }}
      nodeDetails={{}}
      solution={{ phaseId: "p1", collection: null, linkedColumns: [] }}
      onChangeCollection={() => {}}
      onChangeLinkedColumns={() => {}}
      {...props}
    />,
  );

it("asks for a run when the step has no results", () => {
  renderTable({ phaseResult: undefined });
  expect(screen.getByText("Run the workflow to see its answer.")).toBeInTheDocument();
});

it("shows the dominant collection's rows and offers a collection selector", () => {
  const onChangeCollection = jest.fn();
  renderTable({ onChangeCollection });
  expect(screen.getAllByRole("row")).toHaveLength(3);
  expect(screen.getByRole("button", { name: /Author cell term/ })).toBeInTheDocument();
  const select = screen.getByRole("combobox");
  expect([...select.options].map((o) => [o.value, o.text])).toEqual([
    ["CS", "Cell set"],
    ["CL", "Cell type"],
  ]);
  fireEvent.change(select, { target: { value: "CL" } });
  expect(onChangeCollection).toHaveBeenCalledWith("CL");
});

it("hides the selector for a single-collection step", () => {
  const gs = { nodes: [{ _id: "GS/1" }], links: [] };
  renderTable({ phaseResult: gs });
  expect(screen.queryByRole("combobox")).toBeNull();
});

it("says so when the chosen collection has no rows", () => {
  renderTable({ phaseResult: { nodes: [], links: [] } });
  expect(screen.getByText("The answer step returned no rows")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /^Label/ })).toBeInTheDocument();
});

describe("label column", () => {
  const header = (name) => screen.queryAllByRole("button", { name: new RegExp(`^${name}`) });

  it("takes the name of the own field that repeats the label", () => {
    renderTable();
    expect(header("Author cell term")).toHaveLength(1);
    expect(header("Label")).toHaveLength(0);
  });

  it("keeps a gene's name when the symbol is the label", () => {
    const gs = {
      nodes: [{ _id: "GS/TFRC", _key: "TFRC", gene_symbol: "TFRC", label: "transferrin receptor" }],
    };
    renderTable({ phaseResult: gs });
    expect(header("Gene symbol")).toHaveLength(1);
    expect(header("Label")).toHaveLength(1);
    expect(screen.getByText("transferrin receptor")).toBeInTheDocument();
  });
});

describe("column identity", () => {
  const edge = { _id: "e1", _from: "CHEMBL/1", _to: "PR/P1", Label: "MOLECULARLY_INTERACTS_WITH" };
  const chembl = {
    nodes: [
      { _id: "CHEMBL/1", label: "drug", protein: "own-protein" },
      { _id: "CHEMBL/2", label: "other", protein: "own-two" },
    ],
    links: [edge],
  };
  const column = { path: [{ label: "MOLECULARLY_INTERACTS_WITH", collection: "PR" }] };
  const renderChembl = (extra) =>
    renderTable({
      phaseResult: chembl,
      allPhaseResults: { p1: chembl },
      nodeDetails: { "PR/P1": { _id: "PR/P1", label: "linked-protein" } },
      solution: { phaseId: "p1", collection: "CHEMBL", linkedColumns: [column] },
      ...extra,
    });

  it("shows one Label column and no duplicate-key warning", () => {
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    renderChembl();
    expect(screen.getAllByRole("button", { name: /^Label/ })).toHaveLength(1);
    expect(spy.mock.calls.flat().join(" ")).not.toMatch(/same key/);
    spy.mockRestore();
  });
});
