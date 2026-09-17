import { humanizeSlug } from "utils/strings";

/**
 * UI-local sidebar section structure, keyed by collection abbreviation.
 *
 * This is a presentation-only config owned by the UI. It is intentionally
 * separate from `assets/nlm-ckn-collection-maps.json`, which is kept
 * byte-identical with the ETL repo by a sync workflow and must not carry
 * UI section tags.
 *
 * Each field descriptor:
 *   - key:     the document property to read.
 *   - label:   the display label shown in the sidebar (authoritative).
 *   - variant: optional; "description" renders as a lead paragraph, not a row.
 *
 * Values and URLs for keys that also appear in the collection map are resolved
 * through `getDisplayFields` (so URL templates stay in one place). Keys not in
 * the collection map resolve their plain value straight from the document; if a
 * key is absent in the data, that field simply does not render.
 */
/**
 * The filtering criteria section is static text: it describes how CKN selects
 * cells rather than reporting anything the document carries, and reads the
 * same on every card that shows it.
 */
const CKN_FILTERING_CRITERIA = {
  section: "CKN Filtering Criteria",
  info: "Criteria used in CKN to filter human normal adult cells",
  description:
    "Only human normal adult cells are included in CKN v1.0. Cells are filtered based on NCBI " +
    "Taxonomy ID for species, UBERON IDs for tissues traced back to the parent term of the " +
    "Anatomical Structure Collection, Human Developmental Stages (HSAPDV) Ontology for age, and " +
    "the Phenotype And Trait Ontology PATO:0000461 for normal or healthy tissue.",
  fields: [],
};

export const fieldSections = {
  // Cell sets carry three unrelated kinds of attribute — what the set *is*, how
  // well NS-Forest classifies it, and how tightly it clusters. Flat, they read
  // as one undifferentiated list of numbers.
  CS: [
    {
      section: "Overview",
      fields: [
        { key: "author_cell_term", label: "Author cell term" },
        // Only ~27% of cell sets carry an ontology_purl; the rest omit the row.
        { key: "ontology_purl", label: "Cell Ontology term" },
        { key: "species", label: "Species" },
        { key: "anatomical_structure", label: "Anatomical structure" },
        { key: "cell_count", label: "Cell count" },
        { key: "cluster_cell_count", label: "Cluster cell count" },
        { key: "dataset_name", label: "Dataset name" },
        { key: "publication", label: "Publication (DOI)" },
        { key: "cellxgene_collection", label: "CELLxGENE collection" },
        // Not a page: every cell set's dataset URL is a raw .h5ad, so the label
        // has to warn before the click does.
        { key: "cellxgene_dataset", label: "CELLxGENE data file (.h5ad download)" },
      ],
    },
    {
      // The marker genes, then the NS-Forest metrics that score them. Kept
      // adjacent because the scores are meaningless without the combination
      // they grade. true_negative belongs here too but is absent from the data.
      section: "Biomarker & classification metrics",
      fields: [
        { key: "biomarker_combination", label: "Biomarker combination" },
        { key: "binary_gene_set", label: "Binary gene set" },
        { key: "expressed_genes", label: "Expressed genes" },
        { key: "f_beta_score", label: "F-beta score" },
        { key: "precision", label: "Precision" },
        { key: "recall", label: "Recall" },
        { key: "on_target", label: "On target" },
        { key: "true_positive", label: "True positives" },
        { key: "false_positive", label: "False positives" },
        { key: "false_negative", label: "False negatives" },
      ],
    },
    {
      // Silhouette summary statistics over the cells in the set. ~6% of cell
      // sets have none, in which case the whole section drops out.
      section: "Quality metrics",
      fields: [
        { key: "silhouette_score", label: "Silhouette score" },
        { key: "mean_silhouette", label: "Mean silhouette" },
        { key: "median_silhouette", label: "Median silhouette" },
        { key: "first_quartile_silhouette", label: "First quartile silhouette" },
        { key: "third_quartile_silhouette", label: "Third quartile silhouette" },
        { key: "standard_deviation_of_silhouette", label: "Silhouette standard deviation" },
      ],
    },
  ],
  // Section order and slot names follow the node card specification sheet
  // attached to nlm-ckn#327. Slots the sheet asks for that no CSD document
  // carries — PMID and sex — are omitted rather than configured, so they
  // cannot render as blank rows; they are tracked as data gaps on that issue.
  CSD: [
    {
      section: "Context",
      // Citation reads "Muto (2021) Nat Commun"; the collection map hangs the
      // DOI URL off the separate `publication` key.
      fields: [{ key: "Citation", label: "Publication" }],
    },
    {
      section: "Provenance",
      fields: [
        { key: "cellxgene_collection", label: "CELLxGENE collection" },
        { key: "dataset_name", label: "Dataset name" },
        // Not a page: this URL serves the raw .h5ad, hundreds of MB for a
        // typical dataset, so the label has to warn before the click does.
        { key: "cellxgene_dataset", label: "CELLxGENE data download (.h5ad)" },
      ],
    },
    {
      section: "Analysis Metadata",
      fields: [
        { key: "cluster_annotation", label: "Cluster annotation level" },
        { key: "embedding", label: "Embedding" },
      ],
    },
    CKN_FILTERING_CRITERIA,
    {
      section: "Post-filtering Dataset Metadata",
      fields: [
        { key: "species", label: "Species" },
        {
          key: "anatomical_structure",
          label: "Anatomical Structure Collection",
          transform: humanizeSlug,
        },
        { key: "tissue_annotation", label: "Tissue" },
        { key: "disease_status", label: "Disease" },
        { key: "donor_age", label: "Age" },
        // Still a bare EFO CURIE: no EFO collection exists in either graph, so
        // the UI has nothing to resolve the term name against (nlm-ckn#311).
        { key: "assay_summary", label: "Assay" },
      ],
    },
    {
      section: "Post-filtering Dataset Statistics",
      fields: [
        { key: "donor_id_count", label: "Donor count" },
        { key: "filtered_cell_count", label: "Cell count" },
        { key: "cluster_summary", label: "Cluster count" },
        { key: "median_of_median_silhouette", label: "Median of median silhouette score" },
        { key: "median_of_f_beta_scores", label: "Median F-beta score" },
      ],
    },
    {
      // The sheet's "Additional" is the four secondary quality statistics. Any
      // other populated attribute is merged in here by getSectionedFields, so
      // naming these does not hide the rest.
      section: "Additional",
      fields: [
        { key: "mean_silhouette", label: "Mean of median silhouette score" },
        {
          key: "standard_deviation_of_silhouette",
          label: "Standard deviation of median silhouette score",
        },
        { key: "mean_f_beta_score", label: "Mean F-beta score" },
      ],
    },
  ],
  // Slots follow the Publication sheet attached to nlm-ckn#330. PMID is left
  // out because no PUB document carries it. The citation stays plain text: the
  // card shows only what the node holds, and the collection map puts no URL on
  // Citation.
  PUB: [
    {
      section: "Overview",
      fields: [
        { key: "Citation", label: "Publication" },
        { key: "author_list", label: "Authors" },
        { key: "year", label: "Year" },
        { key: "title", label: "Title" },
        { key: "journal", label: "Journal" },
      ],
    },
  ],
};

/**
 * Collection-map attributes the node card leaves out of the "Additional"
 * catch-all, keyed by collection abbreviation.
 */
export const omittedFields = {
  // The specification drops the pre-filtering total; every other figure on the
  // card is post-filtering, so showing it in the catch-all invites a misread.
  CSD: ["cell_count"],
  // The specification removes the DOI row.
  PUB: ["publication_doi"],
};
