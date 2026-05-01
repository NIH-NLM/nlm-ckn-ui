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
    {"id": "Ontology Exploration", "label": "Ontology Exploration", "section": "list-results"},
    {"id": "Cell Type Discovery", "label": "Cell Type Discovery", "section": "list-results"},
    {"id": "Marker Gene Analysis", "label": "Marker Gene Analysis", "section": "list-results"},
    {"id": "Disease Analysis", "label": "Disease Analysis", "section": "list-results"},
    {"id": "Example: Pulmonary Hypertension", "label": "Example: Pulmonary Hypertension", "section": "list-results"},
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
    "depth": 2,
    "edgeDirection": "ANY",
    "allowedCollections": ["CS", "CL"],
    "edgeFilters": {
        "Label": ["EXPRESSES", "COMPOSED_PRIMARILY_OF"],
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
        phases.append({
            "id": phase_id,
            "name": template["name"],
            "originSource": template.get("originSource", "previousPhase"),
            "originNodeIds": list(template.get("originNodeIds", [])),
            "previousPhaseId": phases[-1]["id"] if phases else None,
            "originFilter": "all",
            "settings": {**template["settings"]},
            "perNodeSettings": {},
        })
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
        "phases": [
            {
                "id": "preset-hlca-lung-phase-1",
                "name": "Traverse HLCA dataset to cell types",
                "originSource": "manual",
                "originNodeIds": [
                    "CSD/b351804c-293e-4aeb-9c4c-043db67f4540",
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
        "id": "epithelial-cells-lung-uc2",
        "name": "Epithelial cells in the lung (UC2)",
        "description": (
            "Shows all paths connecting epithelial cell to lung "
            "through the Cell Ontology hierarchy, revealing the "
            "intermediate cell types that bridge between them."
        ),
        "category": "Use Cases",
        "phases": [
            {
                "id": "preset-uc2-phase-1",
                "name": "Find paths between epithelial cell and lung",
                "originSource": "manual",
                "originNodeIds": ["CL/0000066", "UBERON/0002048"],
                "previousPhaseId": None,
                "originFilter": "all",
                "settings": {
                    "depth": 3,
                    "allowedCollections": ["CL", "UBERON"],
                    "setOperation": "Connected Paths",
                    "graphType": "phenotypes",
                    "includeInterNodeEdges": True,
                },
                "perNodeSettings": {},
            },
        ],
    },
    {
        "id": "dendritic-marker-genes-uc3",
        "name": "Dendritic cell marker genes in lung (UC3)",
        "description": (
            "Identifies dendritic cell subtypes in lung via "
            "intersection, then retrieves their biomarker "
            "combinations and associated marker genes."
        ),
        "category": "Use Cases",
        "layoutMode": "force",
        "phases": [
            {
                "id": "preset-uc3-phase-1",
                "name": "Find dendritic cells in lung",
                "originSource": "manual",
                "originNodeIds": ["CL/0000451", "UBERON/0002048"],
                "previousPhaseId": None,
                "originFilter": "all",
                "settings": {
                    "depth": 9,
                    "edgeDirection": "INBOUND",
                    "allowedCollections": ["CL"],
                    "edgeFilters": {
                        "Label": ["PART_OF", "SUB_CLASS_OF"],
                        "Source": [],
                    },
                    "setOperation": "Intersection with Origins",
                    "graphType": "phenotypes",
                    "includeInterNodeEdges": True,
                },
                "perNodeSettings": {
                    "CL/0000451": {"depth": 9},
                    "UBERON/0002048": {"depth": 1},
                },
            },
            {
                "id": "preset-uc3-phase-2",
                "name": "Compare marker genes",
                "originSource": "previousPhase",
                "originNodeIds": [],
                "previousPhaseId": "preset-uc3-phase-1",
                "originFilter": "all",
                "settings": {
                    "depth": 3,
                    "edgeDirection": "ANY",
                    "allowedCollections": ["BMC", "GS", "CS"],
                    "edgeFilters": {
                        "Label": [
                            "EXPRESSES",
                            "PART_OF",
                            "HAS_CHARACTERIZING_MARKER_SET",
                            "COMPOSED_PRIMARILY_OF",
                            "SUB_CLASS_OF",
                        ],
                        "Source": [],
                    },
                    "setOperation": "Intersection with Origins",
                    "graphType": "phenotypes",
                    "includeInterNodeEdges": True,
                    "minOverlap": 2,
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
            "Compares cell types between the HLCA (Sikkema et al.) "
            "and CellRef (Guo et al.) lung datasets. Shared cell "
            "types appear between the two dataset hubs."
        ),
        "category": "Use Cases",
        "phases": [
            {
                "id": "preset-uc5-phase-1",
                "name": "Show both datasets with cell types",
                "originSource": "manual",
                "originNodeIds": [
                    "CSD/b351804c-293e-4aeb-9c4c-043db67f4540",
                    "CSD/443f7fb8-2a27-47c3-98f6-6a603c7a294e",
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
        "id": "cystic-fibrosis-uc6",
        "name": "Cystic fibrosis pathogenesis (UC6)",
        "description": (
            "Big Dipper exploration of cystic fibrosis. Starting "
            "from the disease, finds causal genes and treatments, "
            "then traces genes to expressing cell types and their "
            "anatomical locations."
        ),
        "category": "Use Cases",
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
                        "CL", "UBERON", "NCBITaxon", "PR", "CS",
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
                        "CL", "UBERON", "NCBITaxon", "PR", "CHEMBL", "CS",
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
                        "CL", "UBERON", "NCBITaxon", "PR",
                        "CHEMBL", "MONDO", "CS",
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
                        "CL", "UBERON", "NCBITaxon", "PR",
                        "CHEMBL", "BMC", "MONDO", "CS",
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
        "id": "cell-types-in-lung",
        "name": "Cell types in the lung",
        "description": (
            "Retrieves all cell types associated with lung anatomy via "
            "PART_OF and SUB_CLASS_OF relationships."
        ),
        "category": "Cell Type Discovery",
        "phases": [
            {
                "id": "preset-lung-cells-phase-1",
                "name": "Traverse lung cell type hierarchy",
                "originSource": "manual",
                "originNodeIds": ["UBERON/0002048"],
                "previousPhaseId": None,
                "originFilter": "all",
                "settings": {
                    "depth": 9,
                    "edgeDirection": "INBOUND",
                    "allowedCollections": ["CL"],
                    "edgeFilters": {"Label": ["PART_OF", "SUB_CLASS_OF"], "Source": []},
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
        "id": "epithelial-cells-lung",
        "name": "Epithelial cells in the lung",
        "description": (
            "Intersects the epithelial cell hierarchy with lung anatomy to "
            "identify shared cell types."
        ),
        "category": "Cell Type Discovery",
        "phases": [
            {
                "id": "preset-epithelial-phase-1",
                "name": "Intersect lung and epithelial hierarchies",
                "originSource": "manual",
                "originNodeIds": ["CL/0000066", "UBERON/0002048"],
                "previousPhaseId": None,
                "originFilter": "all",
                "settings": {
                    "depth": 9,
                    "edgeDirection": "INBOUND",
                    "allowedCollections": ["CL", "UBERON"],
                    "edgeFilters": {"Label": ["PART_OF", "SUB_CLASS_OF"], "Source": []},
                    "setOperation": "Intersection",
                    "graphType": "phenotypes",
                    "includeInterNodeEdges": True,
                },
                "perNodeSettings": {
                    "CL/0000066": {"depth": 9},
                    "UBERON/0002048": {"depth": 1},
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
        "id": "dendritic-marker-genes",
        "name": "Marker genes for lung dendritic cells",
        "description": (
            "Identifies dendritic cells in the lung via intersection, then "
            "retrieves their associated biomarker combinations."
        ),
        "category": "Marker Gene Analysis",
        "phases": [
            {
                "id": "preset-dendritic-phase-1",
                "name": "Identify dendritic cells in lung",
                "originSource": "manual",
                "originNodeIds": ["CL/0000451", "UBERON/0002048"],
                "previousPhaseId": None,
                "originFilter": "all",
                "settings": {
                    "depth": 9,
                    "edgeDirection": "INBOUND",
                    "allowedCollections": ["CL", "UBERON"],
                    "edgeFilters": {"Label": ["PART_OF", "SUB_CLASS_OF"], "Source": []},
                    "setOperation": "Intersection",
                    "graphType": "phenotypes",
                    "includeInterNodeEdges": True,
                },
                "perNodeSettings": {
                    "CL/0000451": {"depth": 9},
                    "UBERON/0002048": {"depth": 1},
                },
            },
            {
                "id": "preset-dendritic-phase-2",
                "name": "Retrieve biomarker combinations",
                "originSource": "previousPhase",
                "originNodeIds": [],
                "previousPhaseId": "preset-dendritic-phase-1",
                "originFilter": "all",
                "settings": {
                    "depth": 3,
                    "edgeDirection": "ANY",
                    "allowedCollections": ["BMC", "GS", "UBERON", "CS"],
                    "edgeFilters": {"Label": [], "Source": []},
                    "setOperation": "Union",
                    "graphType": "phenotypes",
                    "includeInterNodeEdges": True,
                    "returnCollections": ["BMC"],
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
                    "edgeFilters": {"Label": ["SUB_CLASS_OF", "IS_GENETIC_BASIS_FOR_CONDITION"], "Source": []},
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
                    "edgeFilters": {"Label": [], "Source": []},
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
                    "edgeFilters": {"Label": ["IS_GENETIC_BASIS_FOR_CONDITION"], "Source": []},
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
        "phases": _build_ph_phases("preset-ph-cells", 4),
    },
]
