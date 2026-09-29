import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import DocumentCard from "./DocumentCard";

// Gene symbols render as router links, so every card needs a router context.
const renderCard = (document) =>
  render(<DocumentCard document={document} />, { wrapper: MemoryRouter });

// Mock the collection maps to provide predictable test data
jest.mock("../../assets/nlm-ckn-collection-maps.json", () => ({
  maps: [
    [
      "CL",
      {
        display_name: "Cell Types",
        individual_labels: [{ field_to_use: "label" }],
        individual_urls: [
          {
            individual_url: "http://purl.obolibrary.org/obo/<FIELD_TO_USE>",
            field_to_use: "_key",
          },
        ],
        individual_fields: [
          { field_to_display: "label", display_field_as: "Label" },
          { field_to_display: "prop1", display_field_as: "Property 1" },
          { field_to_display: "prop2", display_field_as: "Property 2" },
        ],
      },
    ],
    [
      "BMC",
      {
        display_name: "Biomarker combination",
        individual_labels: [{ field_to_use: "markers" }],
        individual_fields: [
          { field_to_display: "markers", display_field_as: "Marker(s)" },
          { field_to_display: "f_beta_score", display_field_as: "F-beta score" },
        ],
      },
    ],
    [
      "CS",
      {
        display_name: "Cell set",
        individual_labels: [{ field_to_use: "author_cell_term" }],
        individual_fields: [
          { field_to_display: "expressed_genes", display_field_as: "Expressed genes" },
          { field_to_display: "species", display_field_as: "Species" },
        ],
      },
    ],
    [
      "PUB",
      {
        display_name: "Publication",
        individual_labels: [{ field_to_use: "Citation" }],
        individual_urls: [
          { individual_url: "https://doi.org/<FIELD_TO_USE>", field_to_use: "publication_doi" },
        ],
        individual_fields: [
          { field_to_display: "author_list", display_field_as: "Author" },
          { field_to_display: "journal", display_field_as: "Journal" },
          {
            field_to_display: "publication_doi",
            display_field_as: "DOI",
            field_url: "https://doi.org/<FIELD_TO_USE>",
            field_to_use: "publication_doi",
          },
        ],
      },
    ],
  ],
}));

describe("DocumentCard", () => {
  it("renders an Overview section header", () => {
    const document = { _id: "CL/0", _key: "0", label: "Document Label", prop1: "value1" };
    renderCard(document);
    expect(screen.getByRole("heading", { name: /overview/i })).toBeInTheDocument();
  });

  it("titles a card with no section config as the sectioned card is titled", () => {
    renderCard({ _id: "CL/0", _key: "0", label: "Document Label", prop1: "value1" });
    expect(screen.getByRole("heading", { level: 3 })).toHaveTextContent(
      "Cell Types: Document Label",
    );
  });

  it("renders the component correctly with a string label", () => {
    const document = {
      _id: "CL/0",
      _key: "0",
      label: "Document Label",
      prop1: "value1",
      prop2: "value2",
    };
    renderCard(document);

    // Check if legend renders correctly
    expect(screen.getAllByText("Document Label")[0]).toBeInTheDocument();
    expect(screen.getByText("value1")).toBeInTheDocument();
    expect(screen.getByText("value2")).toBeInTheDocument();
  });

  it("renders the component correctly with an array as label", () => {
    const document = {
      _id: "CL/0",
      _key: "0",
      label: ["Label1", "Label2"],
      prop1: "value1",
    };
    renderCard(document);

    // Check if the label is joined correctly in the table (via formatValue)
    expect(screen.getByText("Label1, Label2")).toBeInTheDocument();
  });

  it("should not render table rows with keys that start with an underscore", () => {
    const document = {
      _id: "CL/0",
      _key: "0",
      label: "Document Label",
      _hiddenProp: "shouldNotShow",
    };
    renderCard(document);

    // Ensure that properties starting with an underscore are not rendered
    expect(screen.queryByText("_hiddenProp")).toBeNull();
  });

  it("renders array values correctly", () => {
    const document = {
      _id: "CL/0",
      _key: "0",
      label: "Document Label",
      prop1: ["value1", "value2"],
    };
    renderCard(document);

    // Check if array values are joined correctly in the table
    expect(screen.getByText("value1, value2")).toBeInTheDocument();
  });

  it("renders section headings and the card title for a configured (CSD) document", () => {
    const document = {
      _id: "CSD/abc",
      Citation: "Sikkema (2023) Nat Med",
      dataset_identifier: "4cb45d80",
      dataset_name: "An integrated cell atlas of the human lung.",
      species: "Homo sapiens",
      filtered_cell_count: 584944,
    };
    renderCard(document);
    // Section headings from the config
    expect(screen.getByText("Context")).toBeInTheDocument();
    expect(screen.getByText("Post-filtering Dataset Metadata")).toBeInTheDocument();
    // Configured field resolved through getDisplayFields (formatFieldValue adds
    // thousands separators to large integers)
    expect(screen.getByText("Cell count")).toBeInTheDocument();
    expect(screen.getByText("584,944")).toBeInTheDocument();
  });

  it("marks external links with the outbound icon and says they open a new tab", () => {
    renderCard({ _id: "CL/0000001", _key: "0000001", label: "cell" });
    const link = screen.getByRole("link", { name: /\(opens in a new tab\)$/ });
    expect(link).toHaveAttribute("href", "http://purl.obolibrary.org/obo/0000001");
    expect(link.querySelector("svg.external-link-icon")).not.toBeNull();
  });

  it("renders the CKN filtering criteria as text under an info icon", () => {
    renderCard({ _id: "CSD/abc", species: "Homo sapiens" });
    expect(screen.getByText("CKN Filtering Criteria")).toBeInTheDocument();
    expect(screen.getByTitle(/criteria used in CKN/i)).toBeInTheDocument();
    expect(screen.getByText(/only human normal adult cells/i)).toBeInTheDocument();
  });

  it("shows true negatives as not used in the calculation", () => {
    renderCard({ _id: "CS/x", author_cell_term: "T cell", true_positive: "5" });
    expect(screen.getByText("True negatives (TN)")).toBeInTheDocument();
    expect(screen.getByText("Not used in calculation")).toBeInTheDocument();
  });

  it("links every marker gene to its own gene page", () => {
    renderCard({ _id: "BMC/hoq", markers: "XCL1,XCL2,GNLY" });

    for (const symbol of ["XCL1", "XCL2", "GNLY"]) {
      expect(screen.getByRole("link", { name: symbol })).toHaveAttribute(
        "href",
        `/collections/GS/${symbol}`,
      );
    }
  });

  it("renders a single marker as one link", () => {
    renderCard({ _id: "BMC/one", markers: "SLPI" });

    expect(screen.getByRole("link", { name: "SLPI" })).toHaveAttribute(
      "href",
      "/collections/GS/SLPI",
    );
  });

  it("leaves Ensembl identifiers as text while still linking their siblings", () => {
    renderCard({ _id: "BMC/ens", markers: "ENSG00000277734,CD3D" });

    expect(screen.queryByRole("link", { name: "ENSG00000277734" })).toBeNull();
    // The card title names the document too, so match the attribute row itself.
    expect(screen.getByRole("cell", { name: /ENSG00000277734/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "CD3D" })).toBeInTheDocument();
  });

  it("trims whitespace and ignores a trailing comma in a marker list", () => {
    renderCard({ _id: "BMC/ws", markers: " CD3D , IL7R ," });

    expect(screen.getAllByRole("link")).toHaveLength(2);
    expect(screen.getByRole("link", { name: "CD3D" })).toHaveAttribute(
      "href",
      "/collections/GS/CD3D",
    );
  });

  it("renders a repeated marker without a duplicate-key warning", () => {
    const keyWarning = jest.spyOn(console, "error").mockImplementation(() => {});

    renderCard({ _id: "BMC/dup", markers: "CD3D,IL7R,CD3D" });

    expect(screen.getAllByRole("link", { name: "CD3D" })).toHaveLength(2);
    expect(keyWarning).not.toHaveBeenCalled();
    keyWarning.mockRestore();
  });

  it("links gene fields on cell set documents but leaves other fields alone", () => {
    renderCard({ _id: "CS/abc", binary_gene_set: "GNLY,PRF1", species: "Homo sapiens" });

    expect(screen.getByRole("link", { name: "GNLY" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Homo sapiens" })).toBeNull();
    expect(screen.getByText("Homo sapiens")).toBeInTheDocument();
  });

  it("lays out a publication card with the citation as plain text and no DOI", () => {
    renderCard({
      _id: "PUB/10.7554-elife.62522",
      Citation: "Wang (2020) eLife",
      author_list: "Wang, Allen, Chiou, Joshua",
      year: "2020",
      title: "LungMAP — Human data from a broad age healthy donor group",
      journal: "eLife",
      publication_doi: "10.7554/elife.62522",
    });
    // The card and landing graph share getTitle (nlm-ckn#338); its label casing
    // is covered in collections.test.js.
    expect(screen.getByRole("heading", { level: 3 })).toHaveTextContent(/^Publication: Wang/);
    expect(screen.getByText("Overview")).toBeInTheDocument();
    expect(screen.getByText("Publication")).toBeInTheDocument();
    expect(screen.getByText("Wang (2020) eLife")).toBeInTheDocument();
    expect(screen.getByText("Authors")).toBeInTheDocument();
    expect(screen.getByText("Journal")).toBeInTheDocument();
    expect(screen.queryByText("DOI")).not.toBeInTheDocument();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("falls back to the flat Overview card for a non-configured collection", () => {
    const document = { _id: "GS/xyz", label: "Some gene" };
    renderCard(document);
    expect(screen.getByText("Overview")).toBeInTheDocument();
    // No CSD section headings for a GS document
    expect(screen.queryByText("Metadata")).not.toBeInTheDocument();
    expect(screen.queryByText("Provenance")).not.toBeInTheDocument();
  });
});
