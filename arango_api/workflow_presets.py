"""
Pre-built workflow presets for the Workflow Builder.

These contain query-semantic fields and optional UI overrides (e.g.
collapseLeafNodes). Frontend clients merge UI_DEFAULTS at load time;
preset values take precedence when present.

This module is consumed by WorkflowPresetsView to serve presets over the API,
making them discoverable by non-browser clients (MCP tools, agents, etc.).
"""

PRESET_SECTIONS = [
    {"id": "graph-results", "label": "Graph Result Examples"},
    {"id": "list-results", "label": "List Result Examples"},
]

PRESET_CATEGORIES = [
    # Graph result examples
    {"id": "Use Cases", "label": "Use Cases", "section": "graph-results"},
    # List result examples
    {
        "id": "Ontology Exploration",
        "label": "Ontology Exploration",
        "section": "list-results",
    },
    {
        "id": "Cell Type Discovery",
        "label": "Cell Type Discovery",
        "section": "list-results",
    },
    {
        "id": "Marker Gene Analysis",
        "label": "Marker Gene Analysis",
        "section": "list-results",
    },
    {"id": "Disease Analysis", "label": "Disease Analysis", "section": "list-results"},
    {
        "id": "Example: Pulmonary Hypertension",
        "label": "Example: Pulmonary Hypertension",
        "section": "list-results",
    },
]

# ---------------------------------------------------------------------------
# Shared phase settings for Pulmonary Hypertension presets
#
# The four PH presets (ph-subtypes, ph-drugs, ph-drug-targets,
# ph-drug-target-cell-types) form an incremental chain where each preset
# extends the previous one with an additional phase. The shared settings
# below eliminate duplication; each preset composes its phases list by
# referencing these constants and supplying only the per-phase id/name.
# ---------------------------------------------------------------------------

_PH_SUBTYPES_PHASE_SETTINGS = {
    "depth": 9,
    "edgeDirection": "INBOUND",
    "allowedCollections": ["MONDO"],
    "edgeFilters": {"Label": ["SUB_CLASS_OF"], "Source": []},
    "setOperation": "Union",
    "graphType": "phenotypes",
    "includeInterNodeEdges": True,
}

_PH_DRUGS_PHASE_SETTINGS = {
    "depth": 1,
    "edgeDirection": "ANY",
    "allowedCollections": ["CHEMBL"],
    "edgeFilters": {"Label": ["IS_SUBSTANCE_THAT_TREATS"], "Source": []},
    "setOperation": "Union",
    "graphType": "phenotypes",
    "includeInterNodeEdges": True,
    "returnCollections": ["CHEMBL"],
}

_PH_TARGETS_PHASE_SETTINGS = {
    "depth": 2,
    "edgeDirection": "ANY",
    "allowedCollections": ["GS", "PR"],
    "edgeFilters": {
        "Label": ["MOLECULARLY_INTERACTS_WITH", "PRODUCES"],
        "Source": [],
    },
    "setOperation": "Union",
    "graphType": "phenotypes",
    "includeInterNodeEdges": True,
    "returnCollections": ["GS", "PR"],
}

_PH_CELL_TYPES_PHASE_SETTINGS = {
    "depth": 3,
    "edgeDirection": "ANY",
    "allowedCollections": ["GS", "CS", "CL"],
    "edgeFilters": {
        "Label": ["PRODUCES", "EXPRESSES", "COMPOSED_PRIMARILY_OF"],
        "Source": [],
    },
    "setOperation": "Union",
    "graphType": "phenotypes",
    "includeInterNodeEdges": True,
    "returnCollections": ["CL"],
}


_PH_PHASE_TEMPLATES = [
    {
        "name": "Collect PH disease subtypes",
        "originSource": "manual",
        "originNodeIds": ["MONDO/0005149"],
        "settings": _PH_SUBTYPES_PHASE_SETTINGS,
    },
    {
        "name": "Identify therapeutic compounds",
        "settings": _PH_DRUGS_PHASE_SETTINGS,
    },
    {
        "name": "Trace to gene/protein targets",
        "settings": _PH_TARGETS_PHASE_SETTINGS,
    },
    {
        "name": "Identify expressing cell types",
        "settings": _PH_CELL_TYPES_PHASE_SETTINGS,
    },
]


def _build_ph_phases(id_prefix, count):
    """Build the first *count* PH phases with preset-specific IDs."""
    phases = []
    for i in range(count):
        template = _PH_PHASE_TEMPLATES[i]
        phase_id = f"{id_prefix}-phase-{i + 1}"
        phases.append(
            {
                "id": phase_id,
                "name": template["name"],
                "originSource": template.get("originSource", "previousPhase"),
                "originNodeIds": list(template.get("originNodeIds", [])),
                "previousPhaseId": phases[-1]["id"] if phases else None,
                "originFilter": "all",
                "settings": {**template["settings"]},
                "perNodeSettings": {},
            }
        )
    return phases


WORKFLOW_PRESETS = [
    # -------------------------------------------------------------------------
    # Use Cases
    # -------------------------------------------------------------------------
    {
        "id": "hlca-lung-cell-types",
        "name": "HLCA lung cell types (UC1)",
        "description": (
            "Displays cell sets from the HLCA respiratory system dataset "
            "(Sikkema et al.) and their mapped Cell Ontology terms. "
            "The dataset node is at the center, connected to ~61 cell "
            "sets (orange) mapped to cell types (blue)."
        ),
        "category": "Use Cases",
        "layoutMode": "force",
        "phases": [
            {
                "id": "preset-hlca-lung-phase-1",
                "name": "Traverse HLCA dataset to cell types",
                "originSource": "manual",
                "originNodeIds": [
                    "CSD/4cb45d80-499a-48ae-a056-c71ac3552c94",
                ],
                "previousPhaseId": None,
                "originFilter": "all",
                "settings": {
                    "depth": 1,
                    "edgeDirection": "INBOUND",
                    "allowedCollections": ["CS", "CL"],
                    "edgeFilters": {"Label": [], "Source": []},
                    "setOperation": "Union",
                    "graphType": "phenotypes",
                    "includeInterNodeEdges": True,
                },
                "perNodeSettings": {},
            },
        ],
    },
    {
        "id": "datasets-epithelial-respiratory-uc2",
        "name": "Datasets for epithelial cells in the respiratory system (UC2)",
        "description": (
            "Finds the datasets relevant to epithelial cell types in the "
            "respiratory system. Phase 1 intersects the epithelial cell "
            "hierarchy (INBOUND SUB_CLASS_OF from epithelial cell) with "
            "cell types that are part of respiratory-system anatomy "
            "(INBOUND PART_OF from respiratory system) to identify the "
            "epithelial respiratory cell types. Phase 2 attaches the "
            "datasets that exemplify those cell types (HAS_EXEMPLAR_DATA) "
            "and the datasets about their anatomy (IS_ABOUT)."
        ),
        "category": "Use Cases",
        "layoutMode": "force",
        "phases": [
            {
                "id": "preset-uc2-phase-1",
                "name": "Epithelial cell types in respiratory anatomy",
                "originSource": "manual",
                "originNodeIds": ["CL/0000066", "UBERON/0001004"],
                "previousPhaseId": None,
                "originFilter": "all",
                "settings": {
                    "depth": 9,
                    "edgeDirection": "INBOUND",
                    "allowedCollections": ["CL", "UBERON"],
                    "edgeFilters": {
                        "Label": ["PART_OF", "SUB_CLASS_OF"],
                        "Source": [],
                    },
                    "setOperation": "Intersection",
                    "graphType": "phenotypes",
                    "includeInterNodeEdges": True,
                },
                # Per-origin filters: cell types descend by SUB_CLASS_OF;
                # anatomy descends by PART_OF (anatomical parts, not
                # subclasses). The intersection keeps cell types that are
                # both epithelial subclasses and part of respiratory anatomy.
                "perNodeSettings": {
                    "CL/0000066": {
                        "depth": 9,
                        "edgeDirection": "INBOUND",
                        "allowedCollections": ["CL"],
                        "edgeFilters": {
                            "Label": ["SUB_CLASS_OF"],
                            "Source": [],
                        },
                    },
                    "UBERON/0001004": {
                        "depth": 9,
                        "edgeDirection": "INBOUND",
                        "allowedCollections": ["CL", "UBERON"],
                        "edgeFilters": {"Label": ["PART_OF"], "Source": []},
                    },
                },
            },
            {
                "id": "preset-uc2-phase-2",
                "name": "Datasets for the epithelial respiratory cell types",
                "originSource": "previousPhase",
                "originNodeIds": [],
                # Source from the Phase-1 answer cells (not the full
                # hierarchy) so datasets stay scoped to the answer.
                "previousPhaseId": "preset-uc2-phase-1",
                "originFilter": "all",
                "settings": {
                    # Exemplar datasets (HAS_EXEMPLAR_DATA) plus datasets
                    # about the answer's anatomy (PART_OF to anatomy, then
                    # IS_ABOUT from datasets) — ANY direction, depth 2.
                    "depth": 2,
                    "edgeDirection": "ANY",
                    "allowedCollections": ["UBERON", "CSD"],
                    "edgeFilters": {
                        "Label": ["PART_OF", "HAS_EXEMPLAR_DATA", "IS_ABOUT"],
                        "Source": [],
                    },
                    "setOperation": "Union",
                    "graphType": "phenotypes",
                    "includeInterNodeEdges": True,
                },
                "perNodeSettings": {},
            },
            {
                "id": "preset-uc2-phase-3",
                "name": "Datasets only",
                "originSource": "filter",
                "originNodeIds": [],
                # Filter the prior phase down to just the datasets — the
                # answer to "which datasets cover epithelial cells in the
                # respiratory system".
                "previousPhaseId": "preset-uc2-phase-2",
                "originFilter": "all",
                "settings": {
                    "returnCollections": ["CSD"],
                },
                "perNodeSettings": {},
            },
        ],
    },
    {
        "id": "epithelial-marker-genes-uc3",
        "name": "Marker genes for epithelial cells in the respiratory system (UC3)",
        "description": (
            "Finds marker genes for epithelial cell types in the "
            "respiratory system. Phase 1 intersects the epithelial cell "
            "hierarchy (INBOUND SUB_CLASS_OF from epithelial cell) with "
            "cell types part of respiratory-system anatomy (INBOUND "
            "PART_OF from respiratory system). Phase 2 follows those cell "
            "types to their cell sets (COMPOSED_PRIMARILY_OF), then to the "
            "cell sets' biomarker combinations "
            "(HAS_CHARACTERIZING_MARKER_SET) and marker genes (EXPRESSES). "
            "Cell-type-to-cell-set mappings are still being populated, so "
            "coverage grows as the ETL fills them in."
        ),
        "category": "Use Cases",
        "layoutMode": "force",
        "phases": [
            {
                "id": "preset-uc3-phase-1",
                "name": "Epithelial cell types in respiratory anatomy",
                "originSource": "manual",
                "originNodeIds": ["CL/0000066", "UBERON/0001004"],
                "previousPhaseId": None,
                "originFilter": "all",
                "settings": {
                    "depth": 9,
                    "edgeDirection": "INBOUND",
                    "allowedCollections": ["CL", "UBERON"],
                    "edgeFilters": {
                        "Label": ["PART_OF", "SUB_CLASS_OF"],
                        "Source": [],
                    },
                    "setOperation": "Intersection",
                    "graphType": "phenotypes",
                    "includeInterNodeEdges": True,
                },
                "perNodeSettings": {
                    "CL/0000066": {
                        "depth": 9,
                        "edgeDirection": "INBOUND",
                        "allowedCollections": ["CL"],
                        "edgeFilters": {
                            "Label": ["SUB_CLASS_OF"],
                            "Source": [],
                        },
                    },
                    "UBERON/0001004": {
                        "depth": 9,
                        "edgeDirection": "INBOUND",
                        "allowedCollections": ["CL", "UBERON"],
                        "edgeFilters": {"Label": ["PART_OF"], "Source": []},
                    },
                },
            },
            {
                "id": "preset-uc3-phase-2",
                "name": "Cell sets, biomarker combinations, marker genes",
                "originSource": "previousPhase",
                "originNodeIds": [],
                "previousPhaseId": "preset-uc3-phase-1",
                "originFilter": "all",
                "settings": {
                    # CL -> CS (COMPOSED_PRIMARILY_OF) -> the cell set's
                    # biomarker combination (HAS_CHARACTERIZING_MARKER_SET)
                    # and marker genes (EXPRESSES). Depth 2 keeps it to the
                    # cell types' own cell sets — deeper would hop
                    # GS -> other cell sets via shared genes.
                    "depth": 2,
                    "edgeDirection": "ANY",
                    "allowedCollections": ["CS", "BMC", "GS"],
                    "edgeFilters": {
                        "Label": [
                            "COMPOSED_PRIMARILY_OF",
                            "HAS_CHARACTERIZING_MARKER_SET",
                            "EXPRESSES",
                            "PART_OF",
                        ],
                        "Source": [],
                    },
                    "setOperation": "Union",
                    "graphType": "phenotypes",
                    "includeInterNodeEdges": True,
                    # Marker genes are the deliverable; the default "standard"
                    # leaf collapse hides the single-cell-set ones, so disable
                    # it to keep every marker gene visible.
                    "collapseLeafNodes": "off",
                },
                "perNodeSettings": {},
            },
        ],
    },
    {
        "id": "lung-spatial-panel-uc4",
        "name": "Lung spatial transcriptomics panel (UC4)",
        "description": (
            "Builds a lung-specific marker gene panel for targeted "
            "spatial transcriptomics. Phase 1 starts from lung "
            "(UBERON) and traverses through cell sets to their "
            "datasets (CSD), anchoring results to lung experiments. "
            "Phase 2 fans out from those datasets to cell sets, "
            "biomarker combinations, marker genes, and cell types."
        ),
        "category": "Use Cases",
        "layoutMode": "strict-cluster",
        "phases": [
            {
                "id": "preset-uc4-phase-1",
                "name": "Lung cell set datasets",
                "originSource": "manual",
                "originNodeIds": ["UBERON/0002048"],
                "previousPhaseId": None,
                "originFilter": "all",
                "settings": {
                    "depth": 2,
                    "edgeDirection": "ANY",
                    "allowedCollections": ["CS", "CSD"],
                    "edgeFilters": {
                        "Label": [],
                        "Source": [],
                    },
                    "setOperation": "Union",
                    "graphType": "phenotypes",
                    "includeInterNodeEdges": True,
                    "returnCollections": ["CSD"],
                    "collapseLeafNodes": "off",
                },
                "perNodeSettings": {},
            },
            {
                "id": "preset-uc4-phase-2",
                "name": "Cell types and marker genes",
                "originSource": "previousPhase",
                "originNodeIds": [],
                "previousPhaseId": "preset-uc4-phase-1",
                "originFilter": "all",
                "settings": {
                    "depth": 3,
                    "edgeDirection": "ANY",
                    "allowedCollections": ["CS", "BMC", "GS", "CL"],
                    "edgeFilters": {
                        "Label": [
                            "MEMBER_OF",
                            "PART_OF",
                            "HAS_CHARACTERIZING_MARKER_SET",
                            "COMPOSED_PRIMARILY_OF",
                            "EXPRESSES",
                        ],
                        "Source": [],
                    },
                    "setOperation": "Union",
                    "graphType": "phenotypes",
                    "includeInterNodeEdges": True,
                    "collapseLeafNodes": "off",
                },
                "perNodeSettings": {},
            },
            {
                "id": "preset-uc4-phase-3",
                "name": "Marker gene panel",
                "originSource": "filter",
                "originNodeIds": [],
                "previousPhaseId": "preset-uc4-phase-2",
                "originFilter": "all",
                "settings": {
                    "returnCollections": ["GS"],
                    "collapseLeafNodes": "off",
                },
                "perNodeSettings": {},
            },
        ],
    },
    {
        "id": "dataset-comparison-uc5",
        "name": "Compare datasets: HLCA vs CellRef (UC5)",
        "description": (
            "Compares cell types between the HLCA (Sikkema et al.) and "
            "CellRef (Guo et al.) lung datasets. Each dataset hub is "
            "shown with its cell sets and the cell types it exemplifies; "
            "cell types exemplified by both datasets appear between the "
            "hubs, while dataset-specific cell types stay on their side."
        ),
        "category": "Use Cases",
        "layoutMode": "force",
        "phases": [
            {
                "id": "preset-uc5-phase-1",
                "name": "Show both datasets with their cell sets and cell types",
                "originSource": "manual",
                "originNodeIds": [
                    "CSD/4cb45d80-499a-48ae-a056-c71ac3552c94",
                    "CSD/8b459307-bce0-45f9-9e45-a0a3673058a2",
                ],
                "previousPhaseId": None,
                "originFilter": "all",
                "settings": {
                    # depth-1 INBOUND from each dataset picks up its cell sets
                    # (CS -MEMBER_OF-> CSD) and its exemplar cell types
                    # (CL -HAS_EXEMPLAR_DATA-> CSD). Cell types exemplified by
                    # both datasets become a shared CL node bridging the two
                    # hubs. (Once the schema's CS -EXACT_MATCH-> CS edge is
                    # populated by the ETL it will also bridge equivalent cell
                    # sets directly; not present as of v1.4.6-alpha.34.)
                    "depth": 1,
                    "edgeDirection": "INBOUND",
                    "allowedCollections": ["CS", "CL"],
                    "edgeFilters": {"Label": [], "Source": []},
                    "setOperation": "Union",
                    "graphType": "phenotypes",
                    "includeInterNodeEdges": True,
                },
                "perNodeSettings": {},
            },
        ],
    },
    {
        "id": "cystic-fibrosis-uc6",
        "name": "Cystic fibrosis pathogenesis (UC6)",
        "description": (
            "Big Dipper exploration of cystic fibrosis. Starting "
            "from the disease, finds causal genes and treatments, "
            "then traces genes to expressing cell types and their "
            "anatomical locations."
        ),
        "category": "Use Cases",
        "layoutMode": "force",
        "phases": [
            {
                "id": "preset-uc6-phase-1",
                "name": "Disease genes and treatments",
                "originSource": "manual",
                "originNodeIds": ["MONDO/0009061"],
                "previousPhaseId": None,
                "originFilter": "all",
                "settings": {
                    "depth": 1,
                    "edgeDirection": "ANY",
                    "allowedCollections": ["GS", "CHEMBL"],
                    "edgeFilters": {
                        "Label": [
                            "IS_GENETIC_BASIS_FOR_CONDITION",
                            "IS_SUBSTANCE_THAT_TREATS",
                        ],
                        "Source": [],
                    },
                    "setOperation": "Union",
                    "graphType": "phenotypes",
                    "includeInterNodeEdges": True,
                    "collapseLeafNodes": "off",
                },
                "perNodeSettings": {},
            },
            {
                "id": "preset-uc6-phase-2",
                "name": "Gene to cell types and anatomy",
                "originSource": "previousPhase",
                "originNodeIds": [],
                "previousPhaseId": "preset-uc6-phase-1",
                "originFilter": "all",
                "settings": {
                    "depth": 3,
                    "edgeDirection": "ANY",
                    "allowedCollections": [
                        "CL",
                        "UBERON",
                        "NCBITaxon",
                        "PR",
                        "CS",
                    ],
                    "edgeFilters": {
                        "Label": [
                            "PART_OF",
                            "PRESENT_IN_TAXON",
                            "PRODUCES",
                            "EXPRESSES",
                            "COMPOSED_PRIMARILY_OF",
                        ],
                        "Source": [],
                    },
                    "setOperation": "Union",
                    "graphType": "phenotypes",
                    "includeInterNodeEdges": True,
                    "collapseLeafNodes": "all",
                },
                "perNodeSettings": {},
            },
        ],
    },
    {
        "id": "leber-rpe65-uc7",
        "name": "RPE65-related Leber congenital amaurosis (UC7)",
        "description": (
            "Big Dipper exploration of RPE65-related Leber congenital "
            "amaurosis. Starting from the disease, finds the causal "
            "gene (RPE65) and gene therapy (voretigene neparvovec-rzyl), "
            "then traces to expressing cell types and anatomy."
        ),
        "category": "Use Cases",
        "layoutMode": "force",
        "phases": [
            {
                "id": "preset-uc7-phase-1",
                "name": "Disease genes and treatments",
                "originSource": "manual",
                "originNodeIds": ["MONDO/0008765"],
                "previousPhaseId": None,
                "originFilter": "all",
                "settings": {
                    "depth": 1,
                    "edgeDirection": "ANY",
                    "allowedCollections": ["GS", "CHEMBL"],
                    "edgeFilters": {
                        "Label": [
                            "IS_GENETIC_BASIS_FOR_CONDITION",
                            "IS_SUBSTANCE_THAT_TREATS",
                        ],
                        "Source": [],
                    },
                    "setOperation": "Union",
                    "graphType": "phenotypes",
                    "includeInterNodeEdges": True,
                    "collapseLeafNodes": "off",
                },
                "perNodeSettings": {},
            },
            {
                "id": "preset-uc7-phase-2",
                "name": "Gene to cell types, protein, and drugs",
                "originSource": "previousPhase",
                "originNodeIds": [],
                "previousPhaseId": "preset-uc7-phase-1",
                "originFilter": "all",
                "settings": {
                    "depth": 3,
                    "edgeDirection": "ANY",
                    "allowedCollections": [
                        "CL",
                        "UBERON",
                        "NCBITaxon",
                        "PR",
                        "CHEMBL",
                        "CS",
                    ],
                    "edgeFilters": {
                        "Label": [
                            "PART_OF",
                            "PRESENT_IN_TAXON",
                            "PRODUCES",
                            "MOLECULARLY_INTERACTS_WITH",
                            "EXPRESSES",
                            "COMPOSED_PRIMARILY_OF",
                        ],
                        "Source": [],
                    },
                    "setOperation": "Union",
                    "graphType": "phenotypes",
                    "includeInterNodeEdges": True,
                    "collapseLeafNodes": "off",
                },
                "perNodeSettings": {},
            },
        ],
    },
    {
        "id": "parkinsons-disease-uc8",
        "name": "Parkinson's disease exploration (UC8)",
        "description": (
            "Multi-phase exploration of Parkinson's disease. Phase 1 "
            "identifies causal genes and therapeutic compounds. "
            "Phase 2 traces genes to selectively expressing cell "
            "types and their anatomical locations."
        ),
        "category": "Use Cases",
        "layoutMode": "strict-cluster",
        "phases": [
            {
                "id": "preset-uc8-phase-1",
                "name": "Disease-associated genes",
                "originSource": "manual",
                "originNodeIds": ["MONDO/0005180"],
                "previousPhaseId": None,
                "originFilter": "all",
                "settings": {
                    "depth": 1,
                    "edgeDirection": "ANY",
                    "allowedCollections": ["GS"],
                    "edgeFilters": {
                        "Label": [
                            "IS_GENETIC_BASIS_FOR_CONDITION",
                        ],
                        "Source": [],
                    },
                    "setOperation": "Union",
                    "graphType": "phenotypes",
                    "includeInterNodeEdges": True,
                    "collapseLeafNodes": "off",
                },
                "perNodeSettings": {},
            },
            {
                "id": "preset-uc8-phase-2",
                "name": "Genes to cell types, drugs, and shared diseases",
                "originSource": "previousPhase",
                "originNodeIds": [],
                "previousPhaseId": "preset-uc8-phase-1",
                "originFilter": "all",
                "settings": {
                    "depth": 3,
                    "edgeDirection": "ANY",
                    "allowedCollections": [
                        "CL",
                        "UBERON",
                        "NCBITaxon",
                        "PR",
                        "CHEMBL",
                        "MONDO",
                        "CS",
                    ],
                    "edgeFilters": {
                        "Label": [
                            "PART_OF",
                            "PRESENT_IN_TAXON",
                            "PRODUCES",
                            "MOLECULARLY_INTERACTS_WITH",
                            "IS_GENETIC_BASIS_FOR_CONDITION",
                            "IS_SUBSTANCE_THAT_TREATS",
                            "EXPRESSES",
                            "COMPOSED_PRIMARILY_OF",
                        ],
                        "Source": [],
                    },
                    "setOperation": "Union",
                    "graphType": "phenotypes",
                    "includeInterNodeEdges": True,
                    "collapseLeafNodes": "all",
                },
                "perNodeSettings": {},
            },
        ],
    },
    {
        "id": "pah-kcnk3-uc9",
        "name": "Pulmonary arterial hypertension / KCNK3 (UC9)",
        "description": (
            "Big Dipper exploration of KCNK3-related pulmonary "
            "arterial hypertension. Finds the causal gene (KCNK3), "
            "its protein targets and interacting compounds, and the "
            "cell types that selectively express it (lung pericyte)."
        ),
        "category": "Use Cases",
        "layoutMode": "clustered",
        "phases": [
            {
                "id": "preset-uc9-phase-1",
                "name": "Disease-associated genes",
                "originSource": "manual",
                "originNodeIds": ["MONDO/0014136"],
                "previousPhaseId": None,
                "originFilter": "all",
                "settings": {
                    "depth": 1,
                    "edgeDirection": "ANY",
                    "allowedCollections": ["GS"],
                    "edgeFilters": {
                        "Label": [
                            "IS_GENETIC_BASIS_FOR_CONDITION",
                        ],
                        "Source": [],
                    },
                    "setOperation": "Union",
                    "graphType": "phenotypes",
                    "includeInterNodeEdges": True,
                    "collapseLeafNodes": "off",
                },
                "perNodeSettings": {},
            },
            {
                "id": "preset-uc9-phase-2",
                "name": "Gene to cell types, protein, drugs, and variants",
                "originSource": "previousPhase",
                "originNodeIds": [],
                "previousPhaseId": "preset-uc9-phase-1",
                "originFilter": "all",
                "settings": {
                    "depth": 3,
                    "edgeDirection": "ANY",
                    "allowedCollections": [
                        "CL",
                        "UBERON",
                        "NCBITaxon",
                        "PR",
                        "CHEMBL",
                        "BMC",
                        "MONDO",
                        "CS",
                    ],
                    "edgeFilters": {
                        "Label": [
                            "PART_OF",
                            "PRESENT_IN_TAXON",
                            "PRODUCES",
                            "MOLECULARLY_INTERACTS_WITH",
                            "HAS_QUALITY",
                            "IS_GENETIC_BASIS_FOR_CONDITION",
                            "EXPRESSES",
                            "COMPOSED_PRIMARILY_OF",
                        ],
                        "Source": [],
                    },
                    "setOperation": "Union",
                    "graphType": "phenotypes",
                    "includeInterNodeEdges": True,
                    "collapseLeafNodes": "off",
                },
                "perNodeSettings": {},
            },
        ],
    },
    # -------------------------------------------------------------------------
    # Ontology Exploration
    # -------------------------------------------------------------------------
    {
        "id": "cell-type-hierarchy",
        "name": "Cell type hierarchy",
        "description": (
            "Navigates SUB_CLASS_OF relationships to display parent and child "
            "cell types. Add a starting cell type to begin."
        ),
        "category": "Ontology Exploration",
        "layoutMode": "hierarchical",
        "phases": [
            {
                "id": "preset-hierarchy-phase-1",
                "name": "Traverse cell type subclass hierarchy",
                "originSource": "manual",
                "originNodeIds": ["CL/0000451"],
                "previousPhaseId": None,
                "originFilter": "all",
                "settings": {
                    "depth": 3,
                    "edgeDirection": "INBOUND",
                    "allowedCollections": ["CL"],
                    "edgeFilters": {"Label": ["SUB_CLASS_OF"], "Source": []},
                    "setOperation": "Union",
                    "graphType": "phenotypes",
                    "includeInterNodeEdges": True,
                },
                "perNodeSettings": {},
            },
        ],
    },
    # -------------------------------------------------------------------------
    # Cell Type Discovery
    # -------------------------------------------------------------------------
    {
        "id": "cell-types-in-respiratory-system",
        "name": "Cell types in the respiratory system",
        "description": (
            "Lists the cell types located in the respiratory system. "
            "Phase 1 collects all anatomical structures under the "
            "respiratory system (INBOUND PART_OF + SUB_CLASS_OF over "
            "UBERON only). Phase 2 takes a single hop from those "
            "structures to adjacent cell types — deliberately not "
            "traversing the cell-type (CL-CL) ontology. Returns the cell "
            "types only."
        ),
        "category": "Cell Type Discovery",
        "layoutMode": "force",
        "phases": [
            {
                "id": "preset-resp-cells-phase-1",
                "name": "Respiratory-system anatomy",
                "originSource": "manual",
                "originNodeIds": ["UBERON/0001004"],
                "previousPhaseId": None,
                "originFilter": "all",
                "settings": {
                    "depth": 9,
                    "edgeDirection": "INBOUND",
                    "allowedCollections": ["UBERON"],
                    "edgeFilters": {
                        "Label": ["PART_OF", "SUB_CLASS_OF"],
                        "Source": [],
                    },
                    "setOperation": "Union",
                    "graphType": "phenotypes",
                    "includeInterNodeEdges": True,
                },
                "perNodeSettings": {},
            },
            {
                "id": "preset-resp-cells-phase-2",
                "name": "Adjacent cell types (single hop, no CL-CL)",
                "originSource": "previousPhase",
                "originNodeIds": [],
                "previousPhaseId": "preset-resp-cells-phase-1",
                "originFilter": "all",
                "settings": {
                    "depth": 1,
                    "edgeDirection": "ANY",
                    "allowedCollections": ["CL"],
                    "edgeFilters": {"Label": [], "Source": []},
                    "setOperation": "Union",
                    "graphType": "phenotypes",
                    "includeInterNodeEdges": False,
                    "returnCollections": ["CL"],
                },
                "perNodeSettings": {},
            },
        ],
    },
    {
        "id": "epithelial-cells-respiratory-system",
        "name": "Epithelial cells in the respiratory system",
        "description": (
            "Lists epithelial cell types located in the respiratory "
            "system: the intersection of the epithelial cell hierarchy "
            "(INBOUND SUB_CLASS_OF from epithelial cell) with cell types "
            "part of respiratory-system anatomy (INBOUND PART_OF from "
            "respiratory system). Returns the cell types only."
        ),
        "category": "Cell Type Discovery",
        "layoutMode": "force",
        "phases": [
            {
                "id": "preset-epithelial-phase-1",
                "name": "Epithelial cell types in respiratory anatomy",
                "originSource": "manual",
                "originNodeIds": ["CL/0000066", "UBERON/0001004"],
                "previousPhaseId": None,
                "originFilter": "all",
                "settings": {
                    "depth": 9,
                    "edgeDirection": "INBOUND",
                    "allowedCollections": ["CL", "UBERON"],
                    "edgeFilters": {
                        "Label": ["PART_OF", "SUB_CLASS_OF"],
                        "Source": [],
                    },
                    "setOperation": "Intersection",
                    "graphType": "phenotypes",
                    "includeInterNodeEdges": True,
                    "returnCollections": ["CL"],
                },
                "perNodeSettings": {
                    "CL/0000066": {
                        "depth": 9,
                        "edgeDirection": "INBOUND",
                        "allowedCollections": ["CL"],
                        "edgeFilters": {
                            "Label": ["SUB_CLASS_OF"],
                            "Source": [],
                        },
                    },
                    "UBERON/0001004": {
                        "depth": 9,
                        "edgeDirection": "INBOUND",
                        "allowedCollections": ["CL", "UBERON"],
                        "edgeFilters": {"Label": ["PART_OF"], "Source": []},
                    },
                },
            },
        ],
    },
    # -------------------------------------------------------------------------
    # Marker Gene Analysis
    # -------------------------------------------------------------------------
    {
        "id": "lung-marker-gene-panel",
        "name": "Lung cell type marker gene panel",
        "description": (
            "Returns gene symbols linked to lung cell types through "
            "evidence-based biomarker relationships."
        ),
        "category": "Marker Gene Analysis",
        "layoutMode": "force",
        "phases": [
            {
                "id": "preset-lung-panel-phase-1",
                "name": "Retrieve lung cell type marker genes",
                "originSource": "manual",
                "originNodeIds": ["UBERON/0002048"],
                "previousPhaseId": None,
                "originFilter": "all",
                "settings": {
                    "depth": 4,
                    "edgeDirection": "ANY",
                    "allowedCollections": ["CL", "CS", "BMC", "GS"],
                    "edgeFilters": {
                        "Label": [
                            "PART_OF",
                            "COMPOSED_PRIMARILY_OF",
                            "HAS_CHARACTERIZING_MARKER_SET",
                            "EXPRESSES",
                        ],
                        "Source": [],
                    },
                    "setOperation": "Union",
                    "graphType": "phenotypes",
                    "includeInterNodeEdges": True,
                    "returnCollections": ["GS"],
                },
                "perNodeSettings": {},
            },
        ],
    },
    {
        "id": "epithelial-marker-gene-panel",
        "name": "Marker gene panel for epithelial cells in the respiratory system",
        "description": (
            "A marker gene panel for epithelial cell types in the "
            "respiratory system. Phase 1 intersects the epithelial cell "
            "hierarchy (INBOUND SUB_CLASS_OF) with cell types part of "
            "respiratory-system anatomy (INBOUND PART_OF). Phase 2 follows "
            "those cell types to their cell sets and marker genes. Phase 3 "
            "returns just the marker genes as the panel. Coverage grows as "
            "cell-type-to-cell-set mappings are populated by the ETL."
        ),
        "category": "Marker Gene Analysis",
        "layoutMode": "force",
        "phases": [
            {
                "id": "preset-epithelial-panel-phase-1",
                "name": "Epithelial cell types in respiratory anatomy",
                "originSource": "manual",
                "originNodeIds": ["CL/0000066", "UBERON/0001004"],
                "previousPhaseId": None,
                "originFilter": "all",
                "settings": {
                    "depth": 9,
                    "edgeDirection": "INBOUND",
                    "allowedCollections": ["CL", "UBERON"],
                    "edgeFilters": {
                        "Label": ["PART_OF", "SUB_CLASS_OF"],
                        "Source": [],
                    },
                    "setOperation": "Intersection",
                    "graphType": "phenotypes",
                    "includeInterNodeEdges": True,
                },
                "perNodeSettings": {
                    "CL/0000066": {
                        "depth": 9,
                        "edgeDirection": "INBOUND",
                        "allowedCollections": ["CL"],
                        "edgeFilters": {
                            "Label": ["SUB_CLASS_OF"],
                            "Source": [],
                        },
                    },
                    "UBERON/0001004": {
                        "depth": 9,
                        "edgeDirection": "INBOUND",
                        "allowedCollections": ["CL", "UBERON"],
                        "edgeFilters": {"Label": ["PART_OF"], "Source": []},
                    },
                },
            },
            {
                "id": "preset-epithelial-panel-phase-2",
                "name": "Cell sets and marker genes",
                "originSource": "previousPhase",
                "originNodeIds": [],
                "previousPhaseId": "preset-epithelial-panel-phase-1",
                "originFilter": "all",
                "settings": {
                    "depth": 2,
                    "edgeDirection": "ANY",
                    "allowedCollections": ["CS", "BMC", "GS"],
                    "edgeFilters": {
                        "Label": [
                            "COMPOSED_PRIMARILY_OF",
                            "HAS_CHARACTERIZING_MARKER_SET",
                            "EXPRESSES",
                            "PART_OF",
                        ],
                        "Source": [],
                    },
                    "setOperation": "Union",
                    "graphType": "phenotypes",
                    "includeInterNodeEdges": True,
                },
                "perNodeSettings": {},
            },
            {
                "id": "preset-epithelial-panel-phase-3",
                "name": "Marker gene panel",
                "originSource": "filter",
                "originNodeIds": [],
                "previousPhaseId": "preset-epithelial-panel-phase-2",
                "originFilter": "all",
                "settings": {
                    "returnCollections": ["GS"],
                },
                "perNodeSettings": {},
            },
        ],
    },
    # -------------------------------------------------------------------------
    # Disease Analysis
    # -------------------------------------------------------------------------
    {
        "id": "lung-markers-to-diseases",
        "name": "Lung biomarkers to diseases",
        "description": (
            "Identifies biomarker combinations in the lung, then traces them "
            "to associated disease entities."
        ),
        "category": "Disease Analysis",
        "layoutMode": "force",
        "phases": [
            {
                "id": "preset-lung-disease-phase-1",
                "name": "Identify lung biomarkers",
                "originSource": "manual",
                "originNodeIds": ["UBERON/0002048"],
                "previousPhaseId": None,
                "originFilter": "all",
                "settings": {
                    "depth": 2,
                    "edgeDirection": "ANY",
                    "allowedCollections": ["BMC", "CS", "UBERON"],
                    "edgeFilters": {"Label": [], "Source": []},
                    "setOperation": "Union",
                    "graphType": "phenotypes",
                    "includeInterNodeEdges": True,
                    "returnCollections": ["BMC"],
                },
                "perNodeSettings": {},
            },
            {
                "id": "preset-lung-disease-phase-2",
                "name": "Trace to associated diseases",
                "originSource": "previousPhase",
                "originNodeIds": [],
                "previousPhaseId": "preset-lung-disease-phase-1",
                "originFilter": "all",
                "settings": {
                    "depth": 2,
                    "edgeDirection": "ANY",
                    "allowedCollections": ["BMC", "GS", "MONDO"],
                    "edgeFilters": {"Label": [], "Source": []},
                    "setOperation": "Union",
                    "graphType": "phenotypes",
                    "includeInterNodeEdges": True,
                    "returnCollections": ["MONDO"],
                },
                "perNodeSettings": {},
            },
        ],
    },
    {
        "id": "disease-cellular-pathogenesis",
        "name": "Disease to cell type involvement",
        "description": (
            "Starting from a disease, identifies associated genes and the "
            "cell types involved. Uses pulmonary hypertension as a default; "
            "replace with any disease of interest."
        ),
        "category": "Disease Analysis",
        "layoutMode": "force",
        "phases": [
            {
                "id": "preset-pathogenesis-phase-1",
                "name": "Identify disease-associated genes",
                "originSource": "manual",
                "originNodeIds": ["MONDO/0005149"],
                "previousPhaseId": None,
                "originFilter": "all",
                "settings": {
                    "depth": 9,
                    "edgeDirection": "INBOUND",
                    "allowedCollections": ["MONDO", "GS"],
                    "edgeFilters": {
                        "Label": ["SUB_CLASS_OF", "IS_GENETIC_BASIS_FOR_CONDITION"],
                        "Source": [],
                    },
                    "setOperation": "Union",
                    "graphType": "phenotypes",
                    "includeInterNodeEdges": True,
                },
                "perNodeSettings": {},
            },
            {
                "id": "preset-pathogenesis-phase-2",
                "name": "Identify involved cell types",
                "originSource": "previousPhase",
                "originNodeIds": [],
                "previousPhaseId": "preset-pathogenesis-phase-1",
                "originFilter": "all",
                "settings": {
                    "depth": 2,
                    "edgeDirection": "ANY",
                    "allowedCollections": ["BMC", "CL", "GS", "PR", "CS"],
                    "edgeFilters": {
                        "Label": [
                            "EXPRESSES",
                            "COMPOSED_PRIMARILY_OF",
                            "HAS_CHARACTERIZING_MARKER_SET",
                            "PRODUCES",
                        ],
                        "Source": [],
                    },
                    "setOperation": "Union",
                    "graphType": "phenotypes",
                    "includeInterNodeEdges": True,
                    "returnCollections": ["CL"],
                },
                "perNodeSettings": {},
            },
        ],
    },
    {
        "id": "druggable-disease-genes",
        "name": "Druggable disease genes",
        "description": (
            "Identifies genes that both underlie a disease (IS_GENETIC_BASIS_FOR_CONDITION) "
            "and are targeted by compounds that treat it. Combines two "
            "independent traversals across all MONDO diseases and intersects "
            "the results."
        ),
        "category": "Disease Analysis",
        "layoutMode": "force",
        "phases": [
            {
                "id": "preset-druggable-genes-phase-1",
                "name": "Disease-associated genes (all diseases)",
                "originSource": "collection",
                "originNodeIds": [],
                "originCollection": "MONDO",
                "previousPhaseId": None,
                "previousPhaseIds": [],
                "phaseCombineOperation": "Intersection",
                "originFilter": "all",
                "settings": {
                    "depth": 1,
                    "edgeDirection": "INBOUND",
                    "allowedCollections": ["GS"],
                    "edgeFilters": {
                        "Label": ["IS_GENETIC_BASIS_FOR_CONDITION"],
                        "Source": [],
                    },
                    "setOperation": "Union",
                    "graphType": "phenotypes",
                    "includeInterNodeEdges": True,
                    "returnCollections": ["GS"],
                },
                "perNodeSettings": {},
            },
            {
                "id": "preset-druggable-genes-phase-2",
                "name": "Drug gene targets (all diseases)",
                "originSource": "collection",
                "originNodeIds": [],
                "originCollection": "MONDO",
                "previousPhaseId": None,
                "previousPhaseIds": [],
                "phaseCombineOperation": "Intersection",
                "originFilter": "all",
                "settings": {
                    "depth": 3,
                    "edgeDirection": "ANY",
                    "allowedCollections": ["CHEMBL", "GS", "PR"],
                    "edgeFilters": {
                        "Label": [
                            "IS_SUBSTANCE_THAT_TREATS",
                            "PRODUCES",
                            "MOLECULARLY_INTERACTS_WITH",
                        ],
                        "Source": [],
                    },
                    "setOperation": "Union",
                    "graphType": "phenotypes",
                    "includeInterNodeEdges": True,
                    "returnCollections": ["GS"],
                },
                "perNodeSettings": {},
            },
            {
                "id": "preset-druggable-genes-phase-3",
                "name": "Intersect druggable disease genes",
                "originSource": "multiplePhases",
                "originNodeIds": [],
                "previousPhaseId": None,
                "previousPhaseIds": [
                    "preset-druggable-genes-phase-1",
                    "preset-druggable-genes-phase-2",
                ],
                "phaseCombineOperation": "Intersection",
                "originFilter": "all",
                "settings": {
                    "depth": 2,
                    "edgeDirection": "ANY",
                    "allowedCollections": [],
                    "edgeFilters": {"Label": [], "Source": []},
                    "setOperation": "Union",
                    "graphType": "phenotypes",
                    "includeInterNodeEdges": True,
                    "returnCollections": ["GS"],
                },
                "perNodeSettings": {},
            },
        ],
    },
    {
        "id": "broken-dipper-candidates",
        "name": "Broken Big Dipper: candidate genes",
        "description": (
            "Step 1 of the Broken Big Dipper. Surfaces drug-repurposing "
            "candidate genes: disease -> gene -> protein -> drug paths where "
            "a drug targets a protein produced by a gene that is the genetic "
            "basis of the disease, but the drug does NOT already treat that "
            "disease (the dipper's closing 4th side is missing). Returns the "
            "genes that sit on at least one broken dipper, using a path-aware "
            "anti-edge (NAC) filter that excludes paths whose drug connects "
            "back to the disease via IS_SUBSTANCE_THAT_TREATS. Then pick a "
            "gene and run 'Big Dipper: explore a candidate' to see its "
            "full dipper. (Note: phase 1 uses a default sample of the disease "
            "collection; raise the collection-origin count on that phase — up "
            "to All — to scan more diseases.)"
        ),
        "category": "Disease Analysis",
        "layoutMode": "force",
        "phases": [
            {
                "id": "preset-bbd-phase-1",
                "name": "Discovery: genes on a broken dipper (all diseases)",
                "originSource": "collection",
                "originCollection": "MONDO",
                "originNodeIds": [],
                "previousPhaseId": None,
                "originFilter": "all",
                "settings": {
                    "depth": 3,
                    "edgeDirection": "ANY",
                    "allowedCollections": ["GS", "PR", "CHEMBL"],
                    "edgeFilters": {
                        "Label": [
                            "IS_GENETIC_BASIS_FOR_CONDITION",
                            "PRODUCES",
                            "MOLECULARLY_INTERACTS_WITH",
                        ],
                        "Source": [],
                    },
                    # Anti-edge (NAC): drop paths whose drug treats the
                    # origin disease — keep only the "broken" dippers.
                    "excludeClosingEdges": {"Label": ["IS_SUBSTANCE_THAT_TREATS"]},
                    "setOperation": "Union",
                    "graphType": "phenotypes",
                    "includeInterNodeEdges": False,
                    "returnCollections": ["GS"],
                },
                "perNodeSettings": {},
            },
        ],
    },
    {
        "id": "clean-dipper-candidates",
        "name": "Complete Big Dipper: candidate genes",
        "description": (
            "The positive counterpart of 'Broken Big Dipper: candidate "
            "genes'. Surfaces genes that sit on a COMPLETE dipper: "
            "disease -> gene -> protein -> drug paths where a drug targets a "
            "protein produced by a gene that is the genetic basis of the "
            "disease AND the drug already treats that disease (the dipper's "
            "closing 4th side is present). Returns the genes on at least one "
            "complete dipper, using a path-aware require-closing filter that "
            "keeps only paths whose drug connects back to the disease via "
            "IS_SUBSTANCE_THAT_TREATS. Useful as a validation/positive-control "
            "set against the broken (repurposing) candidates. (Note: phase 1 "
            "uses a default sample of the disease collection; raise the "
            "collection-origin count on that phase — up to All — to scan more "
            "diseases.)"
        ),
        "category": "Disease Analysis",
        "layoutMode": "force",
        "phases": [
            {
                "id": "preset-cbd-phase-1",
                "name": "Discovery: genes on a complete dipper (all diseases)",
                "originSource": "collection",
                "originCollection": "MONDO",
                "originNodeIds": [],
                "previousPhaseId": None,
                "originFilter": "all",
                "settings": {
                    "depth": 3,
                    "edgeDirection": "ANY",
                    "allowedCollections": ["GS", "PR", "CHEMBL"],
                    "edgeFilters": {
                        "Label": [
                            "IS_GENETIC_BASIS_FOR_CONDITION",
                            "PRODUCES",
                            "MOLECULARLY_INTERACTS_WITH",
                        ],
                        "Source": [],
                    },
                    # Require-closing: keep only paths whose drug treats the
                    # origin disease — the "complete" dippers.
                    "requireClosingEdges": {"Label": ["IS_SUBSTANCE_THAT_TREATS"]},
                    "setOperation": "Union",
                    "graphType": "phenotypes",
                    "includeInterNodeEdges": False,
                    "returnCollections": ["GS"],
                },
                "perNodeSettings": {},
            },
        ],
    },
    {
        "id": "dipper-explorer",
        "name": "Big Dipper: explore a candidate",
        "description": (
            "A Big Dipper builder for one candidate gene — works for both the "
            "broken and complete candidate lists. Pick a gene by name (default "
            "FLT1) and this renders its full Big Dipper: the gene's diseases "
            "(IS_GENETIC_BASIS_FOR_CONDITION), the gene's protein and the "
            "candidate drugs that target it (PRODUCES, "
            "MOLECULARLY_INTERACTS_WITH), the cell types that express the gene "
            "(gene <- cell set -> cell type, GS-CS-CL), and the candidate "
            "drugs' closing treatment edges back to the gene's own diseases "
            "(IS_SUBSTANCE_THAT_TREATS). A closing edge present = a complete "
            "dipper for that disease; absent = the broken (repurposing) "
            "dipper. The cell leg keeps only the cell sets that bridge the "
            "gene to a cell type — those that map to no cell type are dropped "
            "as noise. The closing scan only links existing nodes, so it adds "
            "no extra diseases."
        ),
        "category": "Disease Analysis",
        "layoutMode": "force",
        "phases": [
            # The cell leg is built FIRST and cleaned, so the final phase
            # (what the viewer shows) carries only bridging cell sets. A plain
            # gene -> cell set -> cell type traversal would pull in every cell
            # set that expresses the gene (dozens), most of which never reach
            # a cell type — pure clutter. Instead:
            #   phase 1: gene -> cell types, returning ONLY the gene + cell
            #            types (every cell set dropped via returnCollections).
            #   phase 2: Connected Paths between the gene and those cell types
            #            over CS — reintroduces ONLY the cell sets that lie on
            #            a complete gene -> cell set -> cell type path.
            #   phase 3: expand the dipper (diseases, protein, drugs) outward
            #            from that clean cell scaffold.
            {
                "id": "preset-bbd-explore-phase-1",
                "name": "Cell types that express the gene",
                "originSource": "manual",
                "originNodeIds": ["GS/FLT1"],
                "previousPhaseId": None,
                "originFilter": "all",
                "settings": {
                    "depth": 2,
                    "edgeDirection": "ANY",
                    "allowedCollections": ["CS", "CL"],
                    "edgeFilters": {
                        "Label": ["EXPRESSES", "COMPOSED_PRIMARILY_OF"],
                        "Source": [],
                    },
                    "setOperation": "Union",
                    # Drop the cell sets here; phase 2 brings back only the
                    # bridging ones.
                    "returnCollections": ["GS", "CL"],
                    "graphType": "phenotypes",
                    "includeInterNodeEdges": True,
                    # The explorer is a curated, complete dipper — leaf-node
                    # collapse would hide the endpoints (cell types, and any
                    # disease/drug without a closing edge), so disable it.
                    "collapseLeafNodes": "off",
                },
                "perNodeSettings": {},
            },
            {
                "id": "preset-bbd-explore-phase-2",
                "name": "Bridging cell sets (drop dangling ones)",
                "originSource": "previousPhase",
                "originNodeIds": [],
                "previousPhaseId": "preset-bbd-explore-phase-1",
                "originFilter": "all",
                "settings": {
                    # Connected Paths keeps only nodes on a path between the
                    # origins (gene + cell types), so cell sets that dangle off
                    # the gene without reaching a cell type are excluded.
                    "depth": 2,
                    "edgeDirection": "ANY",
                    "allowedCollections": ["CS", "GS", "CL"],
                    "setOperation": "Connected Paths",
                    "graphType": "phenotypes",
                    "includeInterNodeEdges": True,
                    "collapseLeafNodes": "off",
                },
                "perNodeSettings": {},
            },
            {
                "id": "preset-bbd-explore-phase-3",
                "name": "Dipper: diseases, protein, candidate drugs",
                "originSource": "previousPhase",
                "originNodeIds": [],
                "previousPhaseId": "preset-bbd-explore-phase-2",
                "originFilter": "all",
                "settings": {
                    # Expand the dipper outward from the clean cell scaffold.
                    # Only the gene carries these edges, so cell sets / cell
                    # types contribute nothing new — they ride along as nodes.
                    # A traversal phase keeps only its own edges, so this phase
                    # carries the dipper edges but DROPS the cell leg's
                    # EXPRESSES / COMPOSED_PRIMARILY_OF edges — phase 4 merges
                    # them back.
                    "depth": 2,
                    "edgeDirection": "ANY",
                    "allowedCollections": ["MONDO", "PR", "CHEMBL"],
                    "edgeFilters": {
                        "Label": [
                            "IS_GENETIC_BASIS_FOR_CONDITION",
                            "PRODUCES",
                            "MOLECULARLY_INTERACTS_WITH",
                        ],
                        "Source": [],
                    },
                    "setOperation": "Union",
                    "graphType": "phenotypes",
                    "includeInterNodeEdges": True,
                    "collapseLeafNodes": "off",
                },
                "perNodeSettings": {},
            },
            {
                "id": "preset-bbd-explore-phase-4",
                "name": "Merge cell leg + dipper",
                "originSource": "multiplePhases",
                "originNodeIds": [],
                "previousPhaseIds": [
                    "preset-bbd-explore-phase-2",
                    "preset-bbd-explore-phase-3",
                ],
                "phaseCombineOperation": "Union",
                "originFilter": "all",
                "settings": {
                    # Union the clean cell leg (phase 2: bridging cell sets +
                    # their EXPRESSES / COMPOSED_PRIMARILY_OF edges) with the
                    # dipper (phase 3: diseases, protein, drugs + their edges).
                    # The inter-node scan is scoped to IS_SUBSTANCE_THAT_TREATS
                    # ONLY, so it draws the dipper's closing 4th side (candidate
                    # drug -> the gene's own disease) without re-discovering the
                    # unrelated edges (e.g. cell-type SUB_CLASS_OF) an unfiltered
                    # scan would add. It links existing nodes only, so no extra
                    # diseases appear: a closing edge present = a complete dipper
                    # for that disease, absent = the broken one.
                    "graphType": "phenotypes",
                    "includeInterNodeEdges": True,
                    "edgeFilters": {
                        "Label": ["IS_SUBSTANCE_THAT_TREATS"],
                        "Source": [],
                    },
                    # Displayed phase — keep every endpoint visible.
                    "collapseLeafNodes": "off",
                },
                "perNodeSettings": {},
            },
        ],
    },
    # -------------------------------------------------------------------------
    # Example: Pulmonary Hypertension
    #
    # These four presets form an incremental chain. Each extends the previous
    # with one additional phase. Shared phase definitions are composed from
    # the _ph_*_phase() helpers above to avoid duplication.
    # -------------------------------------------------------------------------
    {
        "id": "ph-subtypes",
        "name": "Disease subtypes",
        "description": (
            "Collects all pulmonary hypertension subtypes by traversing the "
            "SUB_CLASS_OF hierarchy inward from the root disease term."
        ),
        "category": "Example: Pulmonary Hypertension",
        "layoutMode": "force",
        "phases": _build_ph_phases("preset-ph-subtypes", 1),
    },
    {
        "id": "ph-drugs",
        "name": "Therapeutic compounds",
        "description": (
            "Extends the disease subtypes workflow by identifying compounds "
            "used to treat each subtype."
        ),
        "category": "Example: Pulmonary Hypertension",
        "layoutMode": "force",
        "phases": _build_ph_phases("preset-ph-drugs", 2),
    },
    {
        "id": "ph-drug-targets",
        "name": "Drug molecular targets",
        "description": (
            "Extends the therapeutic compounds workflow by tracing each drug "
            "to its gene and protein targets via molecular interaction and "
            "production relationships."
        ),
        "category": "Example: Pulmonary Hypertension",
        "layoutMode": "force",
        "phases": _build_ph_phases("preset-ph-targets", 3),
    },
    {
        "id": "ph-drug-target-cell-types",
        "name": "Cell types expressing drug targets",
        "description": (
            "Extends the drug molecular targets workflow by identifying the "
            "cell types that express those gene and protein targets."
        ),
        "category": "Example: Pulmonary Hypertension",
        "layoutMode": "force",
        "phases": _build_ph_phases("preset-ph-cells", 4),
    },
]
