/**
 * Pre-built workflow presets for the Workflow Builder.
 *
 * Organized into categories (simple -> complex):
 * - Ontology Exploration: navigate ontology hierarchies
 * - Cell Type Discovery: identify cell types within anatomical structures
 * - Marker Gene Analysis: find biomarker and gene associations for cell types
 * - Disease Analysis: trace disease-gene-drug-cell relationships
 * - Example: Pulmonary Hypertension: progressive multi-phase example using PH
 */

import { DEFAULT_GRAPH_TYPE } from "./graph";

/**
 * Query-semantic defaults -- what an MCP tool / agent cares about.
 */
export const QUERY_DEFAULTS = {
  depth: 2,
  edgeDirection: "ANY",
  allowedCollections: [],
  edgeFilters: { Label: [], Source: [] },
  setOperation: "Union",
  graphType: DEFAULT_GRAPH_TYPE,
  returnCollections: [],
  includeInterNodeEdges: true,
};

/**
 * UI/visualization defaults -- only the frontend needs these.
 */
export const UI_DEFAULTS = {
  collapseLeafNodes: true,
  useFocusNodes: true,
};

/**
 * Combined defaults for frontend use (backward compatible).
 */
export const DEFAULT_PHASE_SETTINGS = { ...QUERY_DEFAULTS, ...UI_DEFAULTS };

/**
 * Creates a new empty phase with default settings.
 * @param {number} index - The phase index (0-based).
 * @returns {Object} A new phase object.
 */
export const createEmptyPhase = (index) => ({
  id: `phase-${Date.now()}-${index}`,
  name: "",
  originSource: index === 0 ? "manual" : "previousPhase",
  originNodeIds: [],
  // For "collection" origin: which collection to use as source
  originCollection: null,
  previousPhaseId: null,
  // For "multiplePhases" origin: IDs of upstream phases to combine
  previousPhaseIds: [],
  // Set operation for combining multiple phase results
  phaseCombineOperation: "Intersection",
  originFilter: "all",
  settings: { ...DEFAULT_PHASE_SETTINGS },
  // Per-node settings overrides (nodeId -> settings object)
  perNodeSettings: {},
  // Whether to show advanced per-node settings UI
  showAdvancedSettings: false,
  result: null,
});

/**
 * Pre-built workflow presets.
 *
 * Presets contain only query-semantic fields. UI-only fields (collapseLeafNodes,
 * useFocusNodes, showAdvancedSettings, result) are applied at load time by the
 * Redux slice via UI_DEFAULTS.
 */
export const WORKFLOW_PRESETS = [
  // ---------------------------------------------------------------------------
  // Ontology Exploration
  // ---------------------------------------------------------------------------
  {
    id: "cell-type-hierarchy",
    name: "Cell type hierarchy",
    description:
      "Navigates SUB_CLASS_OF relationships to display parent and child cell types. Add a starting cell type to begin.",
    category: "Ontology Exploration",
    phases: [
      {
        id: "preset-hierarchy-phase-1",
        name: "Traverse cell type subclass hierarchy",
        originSource: "manual",
        originNodeIds: ["CL/0000235"], // Macrophage
        previousPhaseId: null,
        originFilter: "all",
        settings: {
          depth: 3,
          edgeDirection: "INBOUND",
          allowedCollections: ["CL"],
          edgeFilters: { Label: ["SUB_CLASS_OF"], Source: [] },
          setOperation: "Union",
          graphType: DEFAULT_GRAPH_TYPE,
          includeInterNodeEdges: true,
        },
        perNodeSettings: {},
      },
    ],
  },

  // ---------------------------------------------------------------------------
  // Cell Type Discovery
  // ---------------------------------------------------------------------------
  {
    id: "cell-types-in-lung",
    name: "Cell types in the lung",
    description:
      "Retrieves all cell types associated with lung anatomy via PART_OF and SUB_CLASS_OF relationships.",
    category: "Cell Type Discovery",
    phases: [
      {
        id: "preset-lung-cells-phase-1",
        name: "Traverse lung cell type hierarchy",
        originSource: "manual",
        originNodeIds: ["UBERON/0002048"], // Lung
        previousPhaseId: null,
        originFilter: "all",
        settings: {
          depth: 9,
          edgeDirection: "INBOUND",
          allowedCollections: ["CL"],
          edgeFilters: { Label: ["PART_OF", "SUB_CLASS_OF"], Source: [] },
          setOperation: "Union",
          graphType: DEFAULT_GRAPH_TYPE,
          includeInterNodeEdges: true,
          returnCollections: ["CL"],
        },
        perNodeSettings: {},
      },
    ],
  },
  {
    id: "epithelial-cells-lung",
    name: "Epithelial cells in the lung",
    description:
      "Intersects the epithelial cell hierarchy with lung anatomy to identify shared cell types.",
    category: "Cell Type Discovery",
    phases: [
      {
        id: "preset-epithelial-phase-1",
        name: "Intersect lung and epithelial hierarchies",
        originSource: "manual",
        originNodeIds: ["CL/0000066", "UBERON/0002048"], // Epithelial cell + Lung
        previousPhaseId: null,
        originFilter: "all",
        settings: {
          depth: 9,
          edgeDirection: "INBOUND",
          allowedCollections: ["CL", "UBERON"],
          edgeFilters: { Label: ["PART_OF", "SUB_CLASS_OF"], Source: [] },
          setOperation: "Intersection",
          graphType: DEFAULT_GRAPH_TYPE,
          includeInterNodeEdges: true,
        },
        perNodeSettings: {
          "CL/0000066": { depth: 9 },
          "UBERON/0002048": { depth: 1 },
        },
      },
    ],
  },

  // ---------------------------------------------------------------------------
  // Marker Gene Analysis
  // ---------------------------------------------------------------------------
  {
    id: "lung-marker-gene-panel",
    name: "Lung cell type marker gene panel",
    description:
      "Returns gene symbols linked to lung cell types through evidence-based biomarker relationships.",
    category: "Marker Gene Analysis",
    phases: [
      {
        id: "preset-lung-panel-phase-1",
        name: "Retrieve lung cell type marker genes",
        originSource: "manual",
        originNodeIds: ["UBERON/0002048"], // Lung
        previousPhaseId: null,
        originFilter: "all",
        settings: {
          depth: 2,
          edgeDirection: "ANY",
          allowedCollections: ["CL", "BMC", "GS"],
          edgeFilters: { Label: [], Source: [] },
          setOperation: "Union",
          graphType: DEFAULT_GRAPH_TYPE,
          includeInterNodeEdges: true,
          returnCollections: ["GS"],
        },
        perNodeSettings: {},
      },
    ],
  },
  {
    id: "dendritic-marker-genes",
    name: "Marker genes for lung dendritic cells",
    description:
      "Identifies dendritic cells in the lung via intersection, then retrieves their associated biomarker combinations.",
    category: "Marker Gene Analysis",
    phases: [
      {
        id: "preset-dendritic-phase-1",
        name: "Identify dendritic cells in lung",
        originSource: "manual",
        originNodeIds: ["CL/0000451", "UBERON/0002048"], // Dendritic cell + Lung
        previousPhaseId: null,
        originFilter: "all",
        settings: {
          depth: 9,
          edgeDirection: "INBOUND",
          allowedCollections: ["CL", "UBERON"],
          edgeFilters: { Label: ["PART_OF", "SUB_CLASS_OF"], Source: [] },
          setOperation: "Intersection",
          graphType: DEFAULT_GRAPH_TYPE,
          includeInterNodeEdges: true,
        },
        perNodeSettings: {
          "CL/0000451": { depth: 9 },
          "UBERON/0002048": { depth: 1 },
        },
      },
      {
        id: "preset-dendritic-phase-2",
        name: "Retrieve biomarker combinations",
        originSource: "previousPhase",
        originNodeIds: [],
        previousPhaseId: "preset-dendritic-phase-1",
        originFilter: "all",
        settings: {
          depth: 2,
          edgeDirection: "ANY",
          allowedCollections: ["BMC", "GS", "UBERON"],
          edgeFilters: { Label: [], Source: [] },
          setOperation: "Union",
          graphType: DEFAULT_GRAPH_TYPE,
          includeInterNodeEdges: true,
          returnCollections: ["BMC"],
        },
        perNodeSettings: {},
      },
    ],
  },

  // ---------------------------------------------------------------------------
  // Disease Analysis
  // ---------------------------------------------------------------------------
  {
    id: "lung-markers-to-diseases",
    name: "Lung biomarkers to diseases",
    description:
      "Identifies biomarker combinations in the lung, then traces them to associated disease entities.",
    category: "Disease Analysis",
    phases: [
      {
        id: "preset-lung-disease-phase-1",
        name: "Identify lung biomarkers",
        originSource: "manual",
        originNodeIds: ["UBERON/0002048"], // Lung
        previousPhaseId: null,
        originFilter: "all",
        settings: {
          depth: 2,
          edgeDirection: "ANY",
          allowedCollections: ["BMC", "CS", "UBERON"],
          edgeFilters: { Label: [], Source: [] },
          setOperation: "Union",
          graphType: DEFAULT_GRAPH_TYPE,
          includeInterNodeEdges: true,
          returnCollections: ["BMC"],
        },
        perNodeSettings: {},
      },
      {
        id: "preset-lung-disease-phase-2",
        name: "Trace to associated diseases",
        originSource: "previousPhase",
        originNodeIds: [],
        previousPhaseId: "preset-lung-disease-phase-1",
        originFilter: "all",
        settings: {
          depth: 2,
          edgeDirection: "ANY",
          allowedCollections: ["BMC", "GS", "MONDO"],
          edgeFilters: { Label: [], Source: [] },
          setOperation: "Union",
          graphType: DEFAULT_GRAPH_TYPE,
          includeInterNodeEdges: true,
          returnCollections: ["MONDO"],
        },
        perNodeSettings: {},
      },
    ],
  },
  {
    id: "disease-cellular-pathogenesis",
    name: "Disease to cell type involvement",
    description:
      "Starting from a disease, identifies associated genes and the cell types involved. Uses pulmonary hypertension as a default; replace with any disease of interest.",
    category: "Disease Analysis",
    phases: [
      {
        id: "preset-pathogenesis-phase-1",
        name: "Identify disease-associated genes",
        originSource: "manual",
        originNodeIds: ["MONDO/0005149"], // Pulmonary hypertension
        previousPhaseId: null,
        originFilter: "all",
        settings: {
          depth: 9,
          edgeDirection: "INBOUND",
          allowedCollections: ["MONDO", "GS"],
          edgeFilters: { Label: ["SUB_CLASS_OF", "GENETIC_BASIS_FOR"], Source: [] },
          setOperation: "Union",
          graphType: DEFAULT_GRAPH_TYPE,
          includeInterNodeEdges: true,
        },
        perNodeSettings: {},
      },
      {
        id: "preset-pathogenesis-phase-2",
        name: "Identify involved cell types",
        originSource: "previousPhase",
        originNodeIds: [],
        previousPhaseId: "preset-pathogenesis-phase-1",
        originFilter: "all",
        settings: {
          depth: 1,
          edgeDirection: "ANY",
          allowedCollections: ["BMC", "CL", "GS", "PR"],
          edgeFilters: { Label: [], Source: [] },
          setOperation: "Union",
          graphType: DEFAULT_GRAPH_TYPE,
          includeInterNodeEdges: true,
          returnCollections: ["CL"],
        },
        perNodeSettings: {},
      },
    ],
  },
  {
    id: "druggable-disease-genes",
    name: "Druggable disease genes",
    description:
      "Identifies genes that both underlie a disease (GENETIC_BASIS_FOR) and are targeted by compounds that treat it. Combines two independent traversals across all MONDO diseases and intersects the results.",
    category: "Disease Analysis",
    phases: [
      {
        id: "preset-druggable-genes-phase-1",
        name: "Disease-associated genes (all diseases)",
        originSource: "collection",
        originNodeIds: [],
        originCollection: "MONDO",
        previousPhaseId: null,
        previousPhaseIds: [],
        phaseCombineOperation: "Intersection",
        originFilter: "all",
        settings: {
          depth: 1,
          edgeDirection: "INBOUND",
          allowedCollections: ["GS"],
          edgeFilters: { Label: ["GENETIC_BASIS_FOR"], Source: [] },
          setOperation: "Union",
          graphType: DEFAULT_GRAPH_TYPE,
          includeInterNodeEdges: true,
          returnCollections: ["GS"],
        },
        perNodeSettings: {},
      },
      {
        id: "preset-druggable-genes-phase-2",
        name: "Drug gene targets (all diseases)",
        originSource: "collection",
        originNodeIds: [],
        originCollection: "MONDO",
        previousPhaseId: null,
        previousPhaseIds: [],
        phaseCombineOperation: "Intersection",
        originFilter: "all",
        settings: {
          depth: 3,
          edgeDirection: "ANY",
          allowedCollections: ["CHEMBL", "GS", "PR"],
          edgeFilters: { Label: ["IS_SUBSTANCE_THAT_TREATS", "PRODUCES", "MOLECULARLY_INTERACTS_WITH"], Source: [] },
          setOperation: "Union",
          graphType: DEFAULT_GRAPH_TYPE,
          includeInterNodeEdges: true,
          returnCollections: ["GS"],
        },
        perNodeSettings: {},
      },
      {
        id: "preset-druggable-genes-phase-3",
        name: "Intersect druggable disease genes",
        originSource: "multiplePhases",
        originNodeIds: [],
        previousPhaseId: null,
        previousPhaseIds: [
          "preset-druggable-genes-phase-1",
          "preset-druggable-genes-phase-2",
        ],
        phaseCombineOperation: "Intersection",
        originFilter: "all",
        settings: {
          ...QUERY_DEFAULTS,
          returnCollections: ["GS"],
        },
        perNodeSettings: {},
      },
    ],
  },

  // ---------------------------------------------------------------------------
  // Example: Pulmonary Hypertension
  //
  // A progressive series of workflows that build on each other, demonstrating
  // how to chain phases for increasingly complex queries. Each preset extends
  // the previous one with an additional phase.
  // ---------------------------------------------------------------------------
  {
    id: "ph-subtypes",
    name: "Disease subtypes",
    description:
      "Collects all pulmonary hypertension subtypes by traversing the SUB_CLASS_OF hierarchy inward from the root disease term.",
    category: "Example: Pulmonary Hypertension",
    phases: [
      {
        id: "preset-ph-subtypes-phase-1",
        name: "Collect PH disease subtypes",
        originSource: "manual",
        originNodeIds: ["MONDO/0005149"], // Pulmonary hypertension
        previousPhaseId: null,
        originFilter: "all",
        settings: {
          depth: 9,
          edgeDirection: "INBOUND",
          allowedCollections: ["MONDO"],
          edgeFilters: { Label: ["SUB_CLASS_OF"], Source: [] },
          setOperation: "Union",
          graphType: DEFAULT_GRAPH_TYPE,
          includeInterNodeEdges: true,
        },
        perNodeSettings: {},
      },
    ],
  },
  {
    id: "ph-drugs",
    name: "Therapeutic compounds",
    description:
      "Extends the disease subtypes workflow by identifying compounds used to treat each subtype.",
    category: "Example: Pulmonary Hypertension",
    phases: [
      {
        id: "preset-ph-drugs-phase-1",
        name: "Collect PH disease subtypes",
        originSource: "manual",
        originNodeIds: ["MONDO/0005149"], // Pulmonary hypertension
        previousPhaseId: null,
        originFilter: "all",
        settings: {
          depth: 9,
          edgeDirection: "INBOUND",
          allowedCollections: ["MONDO"],
          edgeFilters: { Label: ["SUB_CLASS_OF"], Source: [] },
          setOperation: "Union",
          graphType: DEFAULT_GRAPH_TYPE,
          includeInterNodeEdges: true,
        },
        perNodeSettings: {},
      },
      {
        id: "preset-ph-drugs-phase-2",
        name: "Identify therapeutic compounds",
        originSource: "previousPhase",
        originNodeIds: [],
        previousPhaseId: "preset-ph-drugs-phase-1",
        originFilter: "all",
        settings: {
          depth: 1,
          edgeDirection: "ANY",
          allowedCollections: ["CHEMBL"],
          edgeFilters: { Label: ["IS_SUBSTANCE_THAT_TREATS"], Source: [] },
          setOperation: "Union",
          graphType: DEFAULT_GRAPH_TYPE,
          includeInterNodeEdges: true,
          returnCollections: ["CHEMBL"],
        },
        perNodeSettings: {},
      },
    ],
  },
  {
    id: "ph-drug-targets",
    name: "Drug molecular targets",
    description:
      "Extends the therapeutic compounds workflow by tracing each drug to its gene and protein targets via molecular interaction and production relationships.",
    category: "Example: Pulmonary Hypertension",
    phases: [
      {
        id: "preset-ph-targets-phase-1",
        name: "Collect PH disease subtypes",
        originSource: "manual",
        originNodeIds: ["MONDO/0005149"], // Pulmonary hypertension
        previousPhaseId: null,
        originFilter: "all",
        settings: {
          depth: 9,
          edgeDirection: "INBOUND",
          allowedCollections: ["MONDO"],
          edgeFilters: { Label: ["SUB_CLASS_OF"], Source: [] },
          setOperation: "Union",
          graphType: DEFAULT_GRAPH_TYPE,
          includeInterNodeEdges: true,
        },
        perNodeSettings: {},
      },
      {
        id: "preset-ph-targets-phase-2",
        name: "Identify therapeutic compounds",
        originSource: "previousPhase",
        originNodeIds: [],
        previousPhaseId: "preset-ph-targets-phase-1",
        originFilter: "all",
        settings: {
          depth: 1,
          edgeDirection: "ANY",
          allowedCollections: ["CHEMBL"],
          edgeFilters: { Label: ["IS_SUBSTANCE_THAT_TREATS"], Source: [] },
          setOperation: "Union",
          graphType: DEFAULT_GRAPH_TYPE,
          includeInterNodeEdges: true,
          returnCollections: ["CHEMBL"],
        },
        perNodeSettings: {},
      },
      {
        id: "preset-ph-targets-phase-3",
        name: "Trace to gene/protein targets",
        originSource: "previousPhase",
        originNodeIds: [],
        previousPhaseId: "preset-ph-targets-phase-2",
        originFilter: "all",
        settings: {
          depth: 2,
          edgeDirection: "ANY",
          allowedCollections: ["GS", "PR"],
          edgeFilters: { Label: ["MOLECULARLY_INTERACTS_WITH", "PRODUCES"], Source: [] },
          setOperation: "Union",
          graphType: DEFAULT_GRAPH_TYPE,
          includeInterNodeEdges: true,
          returnCollections: ["GS", "PR"],
        },
        perNodeSettings: {},
      },
    ],
  },
  {
    id: "ph-drug-target-cell-types",
    name: "Cell types expressing drug targets",
    description:
      "Extends the drug molecular targets workflow by identifying the cell types that express those gene and protein targets.",
    category: "Example: Pulmonary Hypertension",
    phases: [
      {
        id: "preset-ph-cells-phase-1",
        name: "Collect PH disease subtypes",
        originSource: "manual",
        originNodeIds: ["MONDO/0005149"], // Pulmonary hypertension
        previousPhaseId: null,
        originFilter: "all",
        settings: {
          depth: 9,
          edgeDirection: "INBOUND",
          allowedCollections: ["MONDO"],
          edgeFilters: { Label: ["SUB_CLASS_OF"], Source: [] },
          setOperation: "Union",
          graphType: DEFAULT_GRAPH_TYPE,
          includeInterNodeEdges: true,
        },
        perNodeSettings: {},
      },
      {
        id: "preset-ph-cells-phase-2",
        name: "Identify therapeutic compounds",
        originSource: "previousPhase",
        originNodeIds: [],
        previousPhaseId: "preset-ph-cells-phase-1",
        originFilter: "all",
        settings: {
          depth: 1,
          edgeDirection: "ANY",
          allowedCollections: ["CHEMBL"],
          edgeFilters: { Label: ["IS_SUBSTANCE_THAT_TREATS"], Source: [] },
          setOperation: "Union",
          graphType: DEFAULT_GRAPH_TYPE,
          includeInterNodeEdges: true,
          returnCollections: ["CHEMBL"],
        },
        perNodeSettings: {},
      },
      {
        id: "preset-ph-cells-phase-3",
        name: "Trace to gene/protein targets",
        originSource: "previousPhase",
        originNodeIds: [],
        previousPhaseId: "preset-ph-cells-phase-2",
        originFilter: "all",
        settings: {
          depth: 2,
          edgeDirection: "ANY",
          allowedCollections: ["GS", "PR"],
          edgeFilters: { Label: ["MOLECULARLY_INTERACTS_WITH", "PRODUCES"], Source: [] },
          setOperation: "Union",
          graphType: DEFAULT_GRAPH_TYPE,
          includeInterNodeEdges: true,
          returnCollections: ["GS", "PR"],
        },
        perNodeSettings: {},
      },
      {
        id: "preset-ph-cells-phase-4",
        name: "Identify expressing cell types",
        originSource: "previousPhase",
        originNodeIds: [],
        previousPhaseId: "preset-ph-cells-phase-3",
        originFilter: "all",
        settings: {
          depth: 1,
          edgeDirection: "ANY",
          allowedCollections: ["CL"],
          edgeFilters: { Label: [], Source: [] },
          setOperation: "Union",
          graphType: DEFAULT_GRAPH_TYPE,
          includeInterNodeEdges: true,
          returnCollections: ["CL"],
        },
        perNodeSettings: {},
      },
    ],
  },
];

/**
 * Categories for organizing presets in the UI.
 */
export const PRESET_CATEGORIES = [
  { id: "Ontology Exploration", label: "Ontology Exploration" },
  { id: "Cell Type Discovery", label: "Cell Type Discovery" },
  { id: "Marker Gene Analysis", label: "Marker Gene Analysis" },
  { id: "Disease Analysis", label: "Disease Analysis" },
  { id: "Example: Pulmonary Hypertension", label: "Example: Pulmonary Hypertension" },
];
