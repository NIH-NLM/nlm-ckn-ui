/**
 * Pre-built workflow examples (recipes) for the Workflow Builder.
 *
 * These presets help users understand how to use the workflow builder
 * by providing real-world examples they can load, explore, and modify.
 */

/**
 * Default settings for a new phase.
 */
export const DEFAULT_PHASE_SETTINGS = {
  depth: 2,
  edgeDirection: "ANY",
  allowedCollections: [],
  edgeFilters: { Label: [], Source: [] },
  setOperation: "Union",
  graphType: "ontologies",
  collapseLeafNodes: true,
  useFocusNodes: true,
  includeInterNodeEdges: true,
};

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
  previousPhaseId: null,
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
 */
export const WORKFLOW_PRESETS = [
  {
    id: "epithelial-cells-lung",
    name: "Epithelial cells in the lung",
    description:
      "Find cell types that are both epithelial AND located in the lung using intersection.",
    category: "Cell Type Discovery",
    phases: [
      {
        id: "preset-epithelial-phase-1",
        name: "Intersect Lung + Epithelium",
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
          graphType: "ontologies",
          collapseLeafNodes: false,
          useFocusNodes: true,
          includeInterNodeEdges: true,
        },
        // Per-node settings - different depths for each origin node
        perNodeSettings: {
          "CL/0000066": { depth: 9 },
          "UBERON/0002048": { depth: 1 },
        },
        showAdvancedSettings: true,
        result: null,
      },
    ],
  },
  {
    id: "dendritic-marker-genes",
    name: "Marker genes for lung dendritic cells",
    description:
      "Two-phase query: first find dendritic cells in lung, then expand to their marker genes.",
    category: "Marker Gene Analysis",
    phases: [
      {
        id: "preset-dendritic-phase-1",
        name: "Find dendritic cells in lung",
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
          graphType: "ontologies",
          collapseLeafNodes: false,
          useFocusNodes: true,
          includeInterNodeEdges: true,
        },
        perNodeSettings: {
          "CL/0000451": { depth: 9 },
          "UBERON/0002048": { depth: 1 },
        },
        showAdvancedSettings: true,
        result: null,
      },
      {
        id: "preset-dendritic-phase-2",
        name: "Expand to marker genes",
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
          graphType: "ontologies",
          collapseLeafNodes: false,
          useFocusNodes: true,
          includeInterNodeEdges: true,
        },
        perNodeSettings: {},
        showAdvancedSettings: false,
        result: null,
      },
    ],
  },
  {
    id: "cell-type-hierarchy",
    name: "Explore cell type hierarchy",
    description: "Start from a cell type and explore its parent/child relationships.",
    category: "Ontology Exploration",
    phases: [
      {
        id: "preset-hierarchy-phase-1",
        name: "Cell type hierarchy",
        originSource: "manual",
        originNodeIds: [], // User will fill this in
        previousPhaseId: null,
        originFilter: "all",
        settings: {
          depth: 3,
          edgeDirection: "ANY",
          allowedCollections: ["CL"],
          edgeFilters: { Label: ["SUB_CLASS_OF"], Source: [] },
          setOperation: "Union",
          graphType: "ontologies",
          collapseLeafNodes: true,
          useFocusNodes: true,
          includeInterNodeEdges: true,
        },
        perNodeSettings: {},
        showAdvancedSettings: false,
        result: null,
      },
    ],
  },
];

/**
 * Categories for organizing presets in the UI.
 */
export const PRESET_CATEGORIES = [
  { id: "Cell Type Discovery", label: "Cell Type Discovery" },
  { id: "Marker Gene Analysis", label: "Marker Gene Analysis" },
  { id: "Ontology Exploration", label: "Ontology Exploration" },
];
