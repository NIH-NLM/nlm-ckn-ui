import {
  getCardTitle,
  getDisplayFields,
  getLabel,
  getSectionedFields,
  getUrl,
} from "./collections";

describe("getSectionedFields", () => {
  const csd = (overrides = {}) => ({
    _id: "CSD/abc123",
    Citation: "Sikkema (2023) Nat Med",
    dataset_identifier: "4cb45d80-499a-48ae-a056-c71ac352c94",
    dataset_name: "An integrated cell atlas of the human lung.",
    species: "Homo sapiens",
    disease_status: "Normal",
    anatomical_structure: "respiratory_system",
    tissue_annotation: "UBERON:0002048: 584944",
    collection_id: "6f6d381a-7701-4781-935c-db10d30de293",
    assay_summary: "EFO:0009922: 584944",
    cluster_annotation: "author_cell_type",
    embedding: "X_umap",
    donor_id_count: "107",
    filtered_cell_count: 480000,
    cell_count: 584944,
    cluster_summary: "61",
    median_of_median_silhouette: "0.7789361625482383",
    median_of_f_beta_scores: "0.8242319077268552",
    mean_silhouette: "0.7337227811745746",
    cellxgene_collection: "6f6d381a-7701-4781-935c-db10d30de293",
    cellxgene_dataset: "b351804c-293e-4aeb-9c4c-043db67f4540",
    ...overrides,
  });

  it("groups fields into the specified sections in order", () => {
    const result = getSectionedFields(csd());
    expect(result.map((s) => s.section)).toEqual([
      "Context",
      "Provenance",
      "Analysis Metadata",
      "CKN Filtering Criteria",
      "Post-filtering Dataset Metadata",
      "Post-filtering Dataset Statistics",
      "Additional",
    ]);
  });

  it("carries the filtering criteria as static text", () => {
    const criteria = getSectionedFields(csd()).find((s) => s.section === "CKN Filtering Criteria");
    expect(criteria.fields).toEqual([]);
    expect(criteria.description).toMatch(/^Only human normal adult cells/);
    expect(criteria.info).toBe("Criteria used in CKN to filter human normal adult cells");
  });

  it("titles the card with its citation, dataset name and anatomical structure", () => {
    expect(getCardTitle(csd())).toBe(
      "Cell Set Dataset: Sikkema (2023) Nat Med — An integrated cell atlas of the human lung. — Respiratory system",
    );
  });

  it("reads cluster count from cluster_summary", () => {
    // cell_set_count, the key this row used to read, exists in no CSD document,
    // so the row never rendered.
    const stats = getSectionedFields(csd()).find(
      (s) => s.section === "Post-filtering Dataset Statistics",
    );
    expect(stats.fields.find((f) => f.label === "Cluster count").value).toBe("61");
  });

  it("reads the median silhouette from median_of_median_silhouette", () => {
    // The row previously read mean_silhouette under a "Median" label.
    const stats = getSectionedFields(
      csd({ median_of_median_silhouette: "0.61", mean_silhouette: "0.42" }),
    ).find((s) => s.section === "Post-filtering Dataset Statistics");
    expect(stats.fields.find((f) => f.label === "Median of median silhouette score").value).toBe(
      "0.61",
    );
  });

  it("shows the post-filter cell count and leaves the dataset total out", () => {
    const stats = getSectionedFields(csd()).find(
      (s) => s.section === "Post-filtering Dataset Statistics",
    );
    expect(stats.fields.find((f) => f.label === "Cell count").value).toBe(480000);
    const keys = getSectionedFields(csd()).flatMap((s) => s.fields.map((f) => f.key));
    expect(keys).not.toContain("cell_count");
  });

  it("merges unspecified attributes into the curated Additional section", () => {
    // The design names four quality statistics under "Additional". Identifiers
    // are not curated slots, but the panel never hides a populated attribute --
    // they join the same section rather than opening a second one of that name.
    const sections = getSectionedFields(csd());
    expect(sections.filter((s) => s.section === "Additional")).toHaveLength(1);
    const additional = sections.find((s) => s.section === "Additional");
    const keys = additional.fields.map((f) => f.key);
    expect(keys).toEqual(
      expect.arrayContaining(["mean_silhouette", "collection_id", "dataset_identifier"]),
    );
    // The curated statistic keeps the design's label, not the collection map's.
    expect(additional.fields.find((f) => f.key === "mean_silhouette").label).toBe(
      "Mean of median silhouette score",
    );
    // Curated rows come first, so the section opens as the design shows it.
    expect(keys.indexOf("mean_silhouette")).toBeLessThan(keys.indexOf("collection_id"));
  });

  it("drops fields with empty values", () => {
    const result = getSectionedFields(csd({ assay_summary: undefined, disease_status: "" }));
    const metadata = result.find((s) => s.section === "Post-filtering Dataset Metadata");
    const labels = metadata.fields.map((f) => f.label);
    expect(labels).not.toContain("Assay");
    expect(labels).not.toContain("Disease");
  });

  it("omits a section when all its fields are empty", () => {
    const result = getSectionedFields(
      csd({
        cellxgene_collection: undefined,
        cellxgene_dataset: undefined,
        dataset_name: undefined,
      }),
    );
    expect(result.map((s) => s.section)).not.toContain("Provenance");
  });

  it("warns that the CELLxGENE dataset link is a file download", () => {
    // The two Provenance links look interchangeable but are not: the collection
    // one opens a page, the dataset one pulls a multi-hundred-MB .h5ad. The
    // design's wording keeps "download" in the label for that reason.
    const provenance = getSectionedFields(csd()).find((s) => s.section === "Provenance");
    expect(provenance.fields.map((f) => f.label)).toEqual([
      "CELLxGENE collection",
      "Dataset name",
      "CELLxGENE data download (.h5ad)",
    ]);
  });

  it("resolves additive (non-config) keys from the raw document", () => {
    const result = getSectionedFields(csd({ assay_summary: "spatial transcriptomics" }));
    const metadata = result.find((s) => s.section === "Post-filtering Dataset Metadata");
    const assay = metadata.fields.find((f) => f.label === "Assay");
    expect(assay.value).toBe("spatial transcriptomics");
    expect(assay.url).toBeNull();
  });

  it("returns null for a collection without a section config", () => {
    expect(getSectionedFields({ _id: "PUB/xyz", label: "Some paper" })).toBeNull();
  });

  it("applies a field's declared transform to the displayed value", () => {
    // anatomical_structure holds slugs; the config declares humanizeSlug on it.
    const result = getSectionedFields(csd({ anatomical_structure: "respiratory_system" }));
    const values = result.flatMap((s) => s.fields).map((f) => f.value);
    expect(values).toContain("Respiratory system");
    expect(values).not.toContain("respiratory_system");
  });
});

describe("getSectionedFields for cell sets", () => {
  // Mirrors a real CS document from the phenotypes graph. ontology_purl is
  // omitted deliberately: only ~27% of cell sets carry one.
  const cs = (overrides = {}) => ({
    _id: "CS/23vh3ujg2hl8",
    author_cell_term: "Endothelial-cell-(APC)",
    species: "Homo sapiens",
    anatomical_structure: "UBERON:0001004",
    cell_count: "2573",
    cluster_cell_count: "2573",
    publication: "10.1038/s41586-020-2157-4",
    dataset_name: "Construction of a human cell landscape at single-cell level",
    cellxgene_collection:
      "cellxgene.cziscience.com/collections/38833785-fac5-48fd-944a-0f62a4c23ed1",
    cellxgene_dataset:
      "datasets.cellxgene.cziscience.com/74c3403a-451c-4a62-84e0-d8a8e45c7ea7.h5ad",
    biomarker_combination: "ACKR1",
    binary_gene_set: "SOCS3,PECAM1,AQP1",
    expressed_genes: "SOCS3,PECAM1,AQP1",
    f_beta_score: "0.469166734017619",
    precision: "0.4738775510204082",
    recall: "0.451224251846094",
    on_target: "0.4645175337791443",
    true_positive: "1161",
    false_positive: "1289",
    false_negative: "1412",
    silhouette_score: "0.3091264712456943",
    mean_silhouette: "0.2084425850391535",
    median_silhouette: "0.3091264712456943",
    first_quartile_silhouette: "0.0497852666476713",
    third_quartile_silhouette: "0.4581237329257807",
    standard_deviation_of_silhouette: "0.322763275328126",
    ...overrides,
  });

  it("groups fields into the three declared sections in order", () => {
    const result = getSectionedFields(cs());
    expect(result.map((s) => s.section)).toEqual([
      "Overview",
      "Biomarker & classification metrics",
      "Quality metrics",
    ]);
  });

  it("keeps classification metrics out of the overview", () => {
    const overview = getSectionedFields(cs()).find((s) => s.section === "Overview");
    const labels = overview.fields.map((f) => f.label);
    expect(labels).toEqual(
      expect.arrayContaining(["Author cell term", "Species", "Cell count", "Publication (DOI)"]),
    );
    expect(labels).not.toContain("F-beta score");
    expect(labels).not.toContain("Mean silhouette");
  });

  it("groups the biomarker combination with its NS-Forest metrics", () => {
    const metrics = getSectionedFields(cs()).find(
      (s) => s.section === "Biomarker & classification metrics",
    );
    expect(metrics.fields.map((f) => f.label)).toEqual([
      "Biomarker combination",
      "Binary gene set",
      "Expressed genes",
      "F-beta score",
      "Precision",
      "Recall",
      "On target",
      "True positives",
      "False positives",
      "False negatives",
    ]);
  });

  it("collects the silhouette summary statistics into quality metrics", () => {
    const quality = getSectionedFields(cs()).find((s) => s.section === "Quality metrics");
    expect(quality.fields.map((f) => f.label)).toEqual([
      "Silhouette score",
      "Mean silhouette",
      "Median silhouette",
      "First quartile silhouette",
      "Third quartile silhouette",
      "Silhouette standard deviation",
    ]);
  });

  it("drops the quality section for cell sets with no silhouette statistics", () => {
    // ~6% of cell sets have no silhouette fields at all.
    const result = getSectionedFields(
      cs({
        silhouette_score: undefined,
        mean_silhouette: undefined,
        median_silhouette: undefined,
        first_quartile_silhouette: undefined,
        third_quartile_silhouette: undefined,
        standard_deviation_of_silhouette: undefined,
      }),
    );
    expect(result.map((s) => s.section)).not.toContain("Quality metrics");
  });

  it("places every configured cell set attribute, leaving no Additional section", () => {
    // "Additional" is the catch-all for configured keys no section claims. Its
    // absence proves the config covers the whole CS collection map.
    const result = getSectionedFields(
      cs({ ontology_purl: "http://purl.obolibrary.org/obo/CL_0002144" }),
    );
    expect(result.map((s) => s.section)).not.toContain("Additional");
  });

  it("links the CELLxGENE collection through the shipped collection map", () => {
    const overview = getSectionedFields(cs()).find((s) => s.section === "Overview");
    const collection = overview.fields.find((f) => f.label === "CELLxGENE collection");
    expect(collection.url).toBe(
      "https://cellxgene.cziscience.com/collections/38833785-fac5-48fd-944a-0f62a4c23ed1",
    );
  });

  it("warns that the cell set dataset link is a file download", () => {
    // Every CS cellxgene_dataset URL is a raw .h5ad, not a browsable page.
    const overview = getSectionedFields(cs()).find((s) => s.section === "Overview");
    const labels = overview.fields.map((f) => f.label);
    expect(labels).toContain("CELLxGENE data file (.h5ad download)");
    expect(labels).not.toContain("CELLxGENE dataset");
  });
});

// Exercises the shipped collection maps rather than a fixture, because these
// URLs are only correct if the config names the field that actually holds a
// resolvable identifier. Both cases below shipped broken.
describe("outbound links from the shipped collection maps", () => {
  it("points a cell set dataset at the bare CELLxGENE dataset UUID", () => {
    // dataset_identifier carries a "__<tissue>" suffix that CELLxGENE 404s on;
    // the unsuffixed UUID lives in version.
    const csd = {
      _id: "CSD/ad9529a3-0937-4177-9732-31dee15188c1__bone_marrow",
      dataset_identifier: "ad9529a3-0937-4177-9732-31dee15188c1__bone_marrow",
      version: "ad9529a3-0937-4177-9732-31dee15188c1",
    };
    expect(getUrl(csd)).toBe(
      "https://cellxgene.cziscience.com/e/ad9529a3-0937-4177-9732-31dee15188c1.cxg/",
    );
  });

  it("resolves a publication DOI through doi.org", () => {
    // publication_doi is a bare DOI, so it needs the resolver prefix to be a URL.
    const pub = {
      _id: "PUB/10.7554-elife.62522",
      publication_doi: "10.7554/elife.62522",
    };
    expect(getUrl(pub)).toBe("https://doi.org/10.7554/elife.62522");

    const doi = getDisplayFields(pub).find((field) => field.key === "publication_doi");
    expect(doi.url).toBe("https://doi.org/10.7554/elife.62522");
  });
});

describe("getLabel for multi-organ cell set datasets", () => {
  // A multi-organ dataset yields one CSD document per organ, all sharing the
  // same Name. The label appends the organ and the last six characters of the
  // dataset UUID so the rows can be told apart (nlm-ckn#303).
  const multiOrgan = (organ) => ({
    _id: `CSD/78819b62-0699-4672-8dc8-d9317b04d255__${organ}`,
    _key: `78819b62-0699-4672-8dc8-d9317b04d255__${organ}`,
    Name: "Domínguez Conde (2022) Science - Global",
    Citation: "Domínguez Conde (2022) Science",
    anatomical_structure: organ,
    version: "78819b62-0699-4672-8dc8-d9317b04d255",
  });

  const without = (item, ...fields) => {
    const copy = { ...item };
    for (const field of fields) delete copy[field];
    return copy;
  };

  it("distinguishes documents that share a Name", () => {
    expect(getLabel(multiOrgan("liver"))).toBe(
      "Domínguez Conde (2022) Science - Global — liver (04d255)",
    );
    expect(getLabel(multiOrgan("bone_marrow"))).toBe(
      "Domínguez Conde (2022) Science - Global — bone marrow (04d255)",
    );
  });

  it("falls back to the key prefix when the version field is absent", () => {
    expect(getLabel(without(multiOrgan("kidney"), "version"))).toBe(
      "Domínguez Conde (2022) Science - Global — kidney (04d255)",
    );
  });

  it("appends only the parts the document actually carries", () => {
    expect(getLabel(without(multiOrgan("liver"), "anatomical_structure"))).toBe(
      "Domínguez Conde (2022) Science - Global (04d255)",
    );
  });

  it("leaves the key fallback label undecorated", () => {
    expect(getLabel(without(multiOrgan("liver"), "Name", "Citation"))).toBe(
      "78819b62-0699-4672-8dc8-d9317b04d255__liver",
    );
  });

  it("leaves other collections alone", () => {
    expect(getLabel({ _id: "CL/0000000", label: "cell", anatomical_structure: "liver" })).toBe(
      "cell",
    );
  });
});
