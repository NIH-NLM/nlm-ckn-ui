import { fireEvent, render, screen } from "@testing-library/react";
import SolutionTable from "components/WorkflowBuilder/SolutionTable";
import { downloadFile } from "utils";

let mockFields = null;
jest.mock("utils", () => {
  const actual = jest.requireActual("utils");
  return {
    ...actual,
    downloadFile: jest.fn(),
    getCollectionFields: (c) => mockFields ?? actual.getCollectionFields(c),
  };
});

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
  expect(screen.getByRole("button", { name: /Download CSV/ })).toBeDisabled();
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

it("keeps both columns when two share the header Label", () => {
  const nodes = [
    { _id: "CL/1", label: "lung cell", definition: "first" },
    { _id: "CL/2", definition: "second" },
  ];
  renderTable({ phaseResult: { nodes, links: [] } });
  fireEvent.click(screen.getByRole("button", { name: /Download CSV/ }));
  const [csv] = downloadFile.mock.calls.at(-1);
  const header = csv.split("\n")[0];
  expect(header).toContain("Label (label)");
  expect(header.match(/Label/g).length).toBeGreaterThanOrEqual(2);
});

it("exports every element of an array field to CSV", () => {
  const terms = ["t1", "t2", "t3", "t4", "t5"];
  const nodes = [{ _id: "CS/a", author_cell_term: terms }];
  renderTable({ phaseResult: { nodes, links: [] } });
  fireEvent.click(screen.getByRole("button", { name: /Download CSV/ }));
  const [csv, filename] = downloadFile.mock.calls[0];
  expect(filename).toBe("workflow-results.csv");
  for (const t of terms) expect(csv).toContain(t);
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

describe("own fields", () => {
  const names = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"];
  const row = Object.fromEntries(names.map((n) => [n, `v-${n}`]));
  // "empty" has no value on any row, not even inside its array; "late" has one
  // only on the second row.
  const fields = ["empty", "late", ...names].map((n) => ({
    fieldName: n,
    displayName: `Field ${n}`,
  }));
  const withFields = (extra, nodes) => {
    mockFields = fields;
    renderTable({
      phaseResult: {
        nodes: nodes ?? [
          { _id: "XX/1", ...row, empty: [[], [""]] },
          { _id: "XX/2", late: "v-late" },
        ],
        links: [],
      },
      allPhaseResults: {},
      solution: { phaseId: "p1", collection: "XX", linkedColumns: [], ...extra },
    });
  };
  afterEach(() => {
    mockFields = null;
  });
  const headers = () =>
    screen
      .getAllByRole("columnheader")
      .map((h) => h.textContent.replace(/[\u2195\u25b2\u25bc]/g, ""));
  const defaults = ["Label", "Field late", ...names.slice(0, 5).map((n) => `Field ${n}`)];

  it("shows the label and the first six fields with a value on any row", () => {
    withFields({});
    expect(headers()).toEqual(defaults);
  });

  it("shows exactly the chosen fields, once each", () => {
    withFields({ fields: ["b", "a", "b"] });
    expect(headers()).toEqual(["Label", "Field b", "Field a"]);
  });

  it.each([
    ["not a list", "b"],
    ["empty", []],
  ])("falls back to the default fields when fields is %s", (_, fields) => {
    withFields({ fields });
    expect(headers()).toEqual(defaults);
  });

  it("shows every array element, nested too, and an object's contents in the title", () => {
    const wxyz = ["w", "x", "y", "z"];
    withFields({ fields: ["a", "b", "c"] }, [{ _id: "XX/1", a: wxyz, b: { count: 3 }, c: [wxyz] }]);
    expect(screen.getAllByText("w, x, y, z")).toHaveLength(2);
    expect(screen.getByText('{"count":3}')).toHaveAttribute("title", '{"count":3}');
  });
});
