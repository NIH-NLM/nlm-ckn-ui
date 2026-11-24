import { fireEvent, render, screen } from "@testing-library/react";
import SolutionTable from "components/WorkflowBuilder/SolutionTable";
import { MemoryRouter } from "react-router-dom";
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
    <MemoryRouter>
      <SolutionTable
        phaseResult={phaseResult}
        allPhaseResults={{ p1: phaseResult }}
        nodeDetails={{}}
        solution={{ phaseId: "p1", collection: null, linkedColumns: [] }}
        onChangeCollection={() => {}}
        onChangeLinkedColumns={() => {}}
        {...props}
      />
    </MemoryRouter>,
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

describe("linked columns", () => {
  const edge = (_id, _from, _to, Label) => ({ _id, _from, _to, Label });
  const links = [
    edge("e1", "CHEMBL/1", "PR/P1", "MOLECULARLY_INTERACTS_WITH"),
    edge("e2", "GS/CFTR", "PR/P1", "PRODUCES"),
  ];
  const chembl = {
    nodes: [
      { _id: "CHEMBL/1", label: "drug" },
      { _id: "CHEMBL/2", label: "other" },
    ],
    links,
  };
  const gs = { nodes: [{ _id: "GS/CFTR", _key: "CFTR" }], links };
  const toGene = {
    path: [
      { label: "MOLECULARLY_INTERACTS_WITH", collection: "PR" },
      { label: "PRODUCES", collection: "GS" },
    ],
  };
  const renderLinked = (linkedColumns, extra) =>
    renderTable({
      phaseResult: chembl,
      allPhaseResults: { p1: chembl, p2: gs },
      solution: { phaseId: "p1", collection: "CHEMBL", linkedColumns },
      ...extra,
    });

  it("renders a linked cell as a link, with a dash when nothing is linked", () => {
    renderLinked([toGene]);
    expect(screen.getByRole("button", { name: /Gene symbol/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "CFTR" })).toHaveAttribute(
      "href",
      "/collections/GS/CFTR",
    );
    expect(screen.getByText("–")).toBeInTheDocument();
  });

  it("falls back to the id for a node missing from results and details", () => {
    renderLinked([{ path: [toGene.path[0]] }]);
    expect(screen.getByRole("link", { name: "PR/P1" })).toBeInTheDocument();
  });

  it("falls back to the id for a node that has no label fields", () => {
    renderLinked([{ path: [toGene.path[0]] }], { nodeDetails: { "PR/P1": { _id: "PR/P1" } } });
    expect(screen.getByRole("link", { name: "PR/P1" })).toBeInTheDocument();
  });

  it("exports linked values to CSV, joined with semicolons", () => {
    const two = {
      nodes: [{ _id: "CHEMBL/1" }],
      links: [...links, edge("e3", "CHEMBL/1", "PR/P2", "MOLECULARLY_INTERACTS_WITH")],
    };
    renderLinked([{ path: [toGene.path[0]] }], {
      phaseResult: two,
      allPhaseResults: { p1: two },
      nodeDetails: { "PR/P1": { _id: "PR/P1", label: "A" }, "PR/P2": { _id: "PR/P2", label: "B" } },
    });
    fireEvent.click(screen.getByRole("button", { name: /Download CSV/ }));
    expect(downloadFile.mock.calls.at(-1)[0]).toContain('"A; B"');
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

  it("keeps the linked marker on a second linked column to the same collection", () => {
    const viaGene = { path: [{ label: "PRODUCES", collection: "PR" }] };
    renderChembl({
      solution: { phaseId: "p1", collection: "CHEMBL", linkedColumns: [column, viaGene] },
    });
    fireEvent.click(screen.getByRole("button", { name: /Download CSV/ }));
    expect(downloadFile.mock.calls.at(-1)[0]).toContain("(linked) (2)");
  });

  it("keeps an own field and a same-named linked column apart in the CSV", () => {
    renderChembl();
    fireEvent.click(screen.getByRole("button", { name: /Download CSV/ }));
    const csv = downloadFile.mock.calls.at(-1)[0];
    expect(csv).toContain("own-protein");
    expect(csv).toContain("linked-protein");
  });

  it("sorts rows without links last when ascending", () => {
    renderChembl();
    fireEvent.click(screen.getAllByRole("button", { name: /^Protein/ }).at(-1));
    const cells = screen
      .getAllByRole("row")
      .slice(1)
      .map((r) => r.textContent);
    expect(cells[0]).toContain("linked-protein");
    expect(cells[1]).toContain("–");
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
