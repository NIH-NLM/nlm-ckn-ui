import plotManifest from "assets/plot-manifest.json";

/**
 * Resolves a cell set dataset document to the quality-control figures published
 * for it (nlm-ckn#283).
 *
 * The figures are static files served from the same origin as the app, under
 * `/plots/<nlm-ckn tag>/`. Nothing in the graph records their paths, and they
 * cannot be reconstructed from a CSD document: the plot pipeline writes its own
 * author, journal and year strings, which disagree with `Citation` for enough
 * datasets to matter. `scripts/dev/build-plot-manifest.py` enumerates them
 * instead, and this module reads that manifest.
 */

const PLOTS_BASE = "/plots";

// Display order and labels for the three figures the issue asks for. Captions
// say what the reader is looking at, since the figures carry only terse titles.
const FIGURE_DEFINITIONS = [
  {
    key: "silhouette_fscore_summary",
    label: "Silhouette and F-beta scores",
    caption:
      "Box-and-whisker plots of silhouette scores with NS-Forest F-beta scores for each cell set in the dataset.",
  },
  {
    key: "dendrogram",
    label: "Cell set dendrogram",
    caption: "Hierarchical clustering of the dataset's cell sets.",
  },
  {
    key: "stacked_violin",
    label: "Marker gene expression",
    caption: "Expression of each cell set's NS-Forest marker genes across all cell sets.",
  },
];

/**
 * Percent-encodes a plot path without touching its separators.
 *
 * Published directory names contain spaces ("respiratory_system-Guo-Nat
 * Commun-2023.0-3058a2"), which have to survive into the request as %20.
 * @param {string} path - An absolute, unencoded path.
 */
const encodePlotUrl = (path) => path.split("/").map(encodeURIComponent).join("/");

/**
 * Derives a manifest key from a cell set dataset document.
 *
 * Published plot directories are named for the anatomical structure and the last
 * six characters of the dataset UUID, which is what a CSD `_key` carries:
 * `ba0fb2d9-28c9-4149-8591-694e0b7d9c31__skin_of_body` -> `skin_of_body/7d9c31`.
 * @param {object} document - A document from any collection.
 * @returns {string|null} The manifest key, or null when the document is not a
 *   cell set dataset or its key is not shaped as expected.
 */
export const getDatasetPlotKey = (document) => {
  const [collection, key] = document?._id?.split("/") ?? [];
  if (collection !== "CSD" || !key) {
    return null;
  }
  const [uuid, anatomy] = key.split("__");
  if (!anatomy || uuid.length < 6) {
    return null;
  }
  return `${anatomy}/${uuid.slice(-6)}`;
};

/**
 * Lists the figures published for a cell set dataset document.
 *
 * Coverage is not uniform across datasets — five have no stacked violin plot,
 * one has no interactive silhouette page, and five cell set datasets have no
 * figures at all — so this returns only what the manifest actually records.
 * @param {object} document - The document being inspected.
 * @param {object} [manifest] - Manifest override, for tests.
 * @returns {Array<{key: string, label: string, caption: string, src: string,
 *   interactiveUrl: string|null}>} Figures in display order.
 */
export const getDatasetFigures = (document, manifest = plotManifest) => {
  const entry = manifest?.datasets?.[getDatasetPlotKey(document)];
  if (!entry) {
    return [];
  }
  const directory = `${PLOTS_BASE}/${manifest.tag}/${entry.dir}`;
  return FIGURE_DEFINITIONS.flatMap(({ key, label, caption }) => {
    const files = entry.figures?.[key];
    if (!files) {
      return [];
    }
    // Always show the SVG: it scales to the inspector column, where the plotly
    // page cannot — that page is authored at a fixed 1800x900 and framed this
    // narrow shows one corner of itself. The page is offered as a link instead,
    // for the datasets that have one.
    if (!files.svg) {
      return [];
    }
    return [
      {
        key,
        label,
        caption,
        src: encodePlotUrl(`${directory}/${files.svg}`),
        interactiveUrl: files.html ? encodePlotUrl(`${directory}/${files.html}`) : null,
      },
    ];
  });
};

/** The nlm-ckn release tag the committed manifest was built from. */
export const plotManifestTag = plotManifest.tag;
