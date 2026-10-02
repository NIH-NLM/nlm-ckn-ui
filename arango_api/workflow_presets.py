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
        "Label": [
            "PRODUCES",
            "EXPRESSES",
            "SELECTIVELY_EXPRESSES",
            "COMPOSED_PRIMARILY_OF",
        ],
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
        "id": "datasets-provenance-uc1",
        "name": "Single-cell datasets and their provenance (UC1)",
        "description": (
            "Every single-cell dataset in NLM-CKN with the publication it is "
            "attributed to and the organ it is about. Select a dataset to see "
            "its provenance (CELLxGENE collection, assay, donors, cell counts) "
            "and quality evidence (mean F-beta and silhouette scores)."
        ),
        "category": "Use Cases",
        "layoutMode": "force",
        "phases": [
            {
                "id": "preset-uc1-phase-1",
                "name": "Datasets, publications, and organs",
                "originSource": "collection",
                "originCollection": "CSD",
                "originNodeIds": [],
                "previousPhaseId": None,
                "originFilter": "all",
                "settings": {
                    # CSD -WAS_ATTRIBUTED_TO-> PUB and CSD -IS_ABOUT-> UBERON.
                    # IS_ABOUT also reaches every cell set in the dataset;
                    # allowedCollections keeps those out.
                    "depth": 1,
                    "edgeDirection": "OUTBOUND",
                    "allowedCollections": ["PUB", "UBERON"],
                    "edgeFilters": {
                        "Label": ["WAS_ATTRIBUTED_TO", "IS_ABOUT"],
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
        "id": "hlca-lung-cell-types",
        "name": "HLCA lung cell types (UC2)",
        "description": (
            "The HLCA respiratory dataset (Sikkema et al.) with its ~61 cell "
            "sets and the cell types they map to. The dataset sits at the "
            "center, cell sets in orange, cell types in blue."
        ),
        "category": "Use Cases",
        "layoutMode": "force",
        "phases": [
            {
                "id": "preset-hlca-lung-phase-1",
                "name": "Traverse HLCA dataset to cell types",
                "originSource": "manual",
                # CSD keys are `<dataset uuid>__<anatomical structure>`: ETL
                # v1.6.0-rc.2 split each dataset per anatomy, so the bare uuid
                # this preset used to point at no longer resolves.
                "originNodeIds": [
                    "CSD/4cb45d80-499a-48ae-a056-c71ac3552c94__respiratory_system",
                ],
                "previousPhaseId": None,
                "originFilter": "all",
                "settings": {
                    "depth": 1,
                    # ANY, not INBOUND: the dataset reaches its cell sets
                    # outbound (CSD -IS_ABOUT-> CS) while its exemplar cell
                    # types point back inbound (CL -HAS_EXEMPLAR_DATA-> CSD).
                    # INBOUND alone drops all 61 cell sets.
                    "edgeDirection": "ANY",
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
        "id": "epithelial-marker-genes-uc3",
        "name": "Marker genes for epithelial cells in the respiratory system (UC3)",
        "description": (
            "Marker genes for epithelial cell types in the respiratory "
            "system. Narrows to epithelial cells in respiratory anatomy, "
            "then follows them to their cell sets, biomarker combinations, "
            "and marker genes. Coverage grows as the ETL fills in "
            "cell-type-to-cell-set mappings."
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
                            "SELECTIVELY_EXPRESSES",
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
        "id": "respiratory-spatial-panel-uc4",
        "name": "Respiratory system spatial transcriptomics panel (UC4)",
        "description": (
            "A respiratory-system marker gene panel for targeted spatial "
            "transcriptomics. Starts from respiratory anatomy to anchor on "
            "respiratory experiments, then fans out to their cell sets, "
            "biomarker combinations, marker genes, and cell types."
        ),
        "category": "Use Cases",
        "layoutMode": "strict-cluster",
        "phases": [
            {
                "id": "preset-uc4-phase-1",
                "name": "Respiratory system cell set datasets",
                "originSource": "manual",
                "originNodeIds": ["UBERON/0001004"],
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
                            "IS_ABOUT",
                            "PART_OF",
                            "HAS_CHARACTERIZING_MARKER_SET",
                            "COMPOSED_PRIMARILY_OF",
                            "EXPRESSES",
                            "SELECTIVELY_EXPRESSES",
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
            "Cell types shared and unique between the HLCA (Sikkema et al.) "
            "and CellRef (Guo et al.) lung datasets. Shared cell types sit "
            "between the two dataset hubs; dataset-specific ones stay on "
            "their own side."
        ),
        "category": "Use Cases",
        "layoutMode": "force",
        "phases": [
            {
                "id": "preset-uc5-phase-1",
                "name": "Show both datasets with their cell sets and cell types",
                "originSource": "manual",
                "originNodeIds": [
                    "CSD/4cb45d80-499a-48ae-a056-c71ac3552c94__respiratory_system",
                    "CSD/8b459307-bce0-45f9-9e45-a0a3673058a2__respiratory_system",
                ],
                "previousPhaseId": None,
                "originFilter": "all",
                "settings": {
                    # depth-1 ANY from each dataset picks up its cell sets
                    # (CSD -IS_ABOUT-> CS, outbound) and its exemplar cell
                    # types (CL -HAS_EXEMPLAR_DATA-> CSD, inbound). Cell types
                    # exemplified by both datasets become a shared CL node
                    # bridging the two hubs. (Once the schema's
                    # CS -EXACT_MATCH-> CS edge is populated by the ETL it will
                    # also bridge equivalent cell sets directly; not present as
                    # of v1.6.0-rc.2.)
                    "depth": 1,
                    "edgeDirection": "ANY",
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
            "Cystic fibrosis as a Big Dipper: its causal genes and "
            "treatments, then the cell types that express those genes and "
            "where they sit anatomically."
        ),
        "category": "Use Cases",
        "layoutMode": "big-dipper",
        # A dipper is edge-dense (the FLT1 explorer draws ~150 edges).
        # Labeling every one of them buries the shape, so start with
        # edge labels off; the Labels panel can turn them back on.
        "labelStates": {"link-label": False},
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
                            "SELECTIVELY_EXPRESSES",
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
        "id": "leber-congenital-amaurosis-uc7",
        "name": "Leber congenital amaurosis (UC7)",
        "description": (
            "Leber congenital amaurosis as a Big Dipper: causal genes "
            "(ABCA4, AIPL1, LRAT, KCNJ13), treating compounds, expressing "
            "cell types, and anatomy. Anchored on the parent disease term "
            "because the RPE65-specific subtype is not in the current data "
            "release."
        ),
        "category": "Use Cases",
        "layoutMode": "big-dipper",
        # A dipper is edge-dense (the FLT1 explorer draws ~150 edges).
        # Labeling every one of them buries the shape, so start with
        # edge labels off; the Labels panel can turn them back on.
        "labelStates": {"link-label": False},
        "phases": [
            {
                "id": "preset-uc7-phase-1",
                "name": "Disease genes and treatments",
                "originSource": "manual",
                "originNodeIds": ["MONDO/0018998"],
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
                            "SELECTIVELY_EXPRESSES",
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
        "id": "alzheimers-disease-uc8",
        "name": "Alzheimer's disease exploration (UC8)",
        "description": (
            "Alzheimer's disease: its causal genes and therapeutic "
            "compounds, then the cell types that selectively express those "
            "genes and where they sit anatomically."
        ),
        "category": "Use Cases",
        # NOT the big-dipper layout: this preset fans out to ~3,100 nodes
        # (1,647 compounds, 1,052 diseases), and a single star holding 1,647
        # nodes needs more room than the whole asterism. The dipper layout
        # suits single-dipper results in the tens of nodes; this is a bulk
        # scan, so it keeps the clustered layout it was built with.
        "layoutMode": "strict-cluster",
        # Still worth suppressing edge labels at this density.
        "labelStates": {"link-label": False},
        "phases": [
            {
                "id": "preset-uc8-phase-1",
                "name": "Disease-associated genes",
                "originSource": "manual",
                "originNodeIds": ["MONDO/0004975"],
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
                            "SELECTIVELY_EXPRESSES",
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
            "KCNK3-related pulmonary arterial hypertension as a Big "
            "Dipper: the causal gene, its protein targets and interacting "
            "compounds, and the cell types that selectively express it "
            "(lung pericyte)."
        ),
        "category": "Use Cases",
        "layoutMode": "big-dipper",
        # A dipper is edge-dense (the FLT1 explorer draws ~150 edges).
        # Labeling every one of them buries the shape, so start with
        # edge labels off; the Labels panel can turn them back on.
        "labelStates": {"link-label": False},
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
                            "SELECTIVELY_EXPRESSES",
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
        "id": "datasets-for-cell-type",
        "name": "Datasets and cell sets for a cell type",
        "description": (
            "Every dataset that samples a given cell type or any of its "
            "subtypes, and the cell sets connecting them. Swap the origin in "
            "phase 1 for the cell type you care about; the rest of the "
            "workflow follows from it."
        ),
        "category": "Cell Type Discovery",
        "layoutMode": "force",
        "phases": [
            {
                # Walking INBOUND from the cell type is what keeps the answer
                # clean: every cell set the later phases reach is reached
                # THROUGH a qualifying cell type, so it is on a real
                # dataset -> cell set -> cell type path. Starting at the
                # datasets instead collects every cell type their cell sets
                # mention, and no set operation can recover the difference —
                # the cell sets are absent from the cell-type side entirely.
                "id": "preset-dsct-phase-1",
                "name": "The cell type and its subtypes",
                "originSource": "manual",
                "originNodeIds": ["CL/0000066"],
                "previousPhaseId": None,
                "originFilter": "all",
                "settings": {
                    "depth": 9,
                    "edgeDirection": "INBOUND",
                    "allowedCollections": ["CL"],
                    "edgeFilters": {"Label": ["SUB_CLASS_OF"], "Source": []},
                    "setOperation": "Union",
                    "graphType": "phenotypes",
                    "includeInterNodeEdges": True,
                },
                "perNodeSettings": {},
            },
            {
                "id": "preset-dsct-phase-2",
                "name": "Cell sets composed of those cell types",
                "originSource": "previousPhase",
                "originNodeIds": [],
                "previousPhaseId": "preset-dsct-phase-1",
                "originFilter": "all",
                "settings": {
                    # CS -COMPOSED_PRIMARILY_OF-> CL, so INBOUND from the
                    # cell types. Return cell sets only; the subtype hierarchy
                    # comes back in phase 6 trimmed to what is actually used.
                    "depth": 1,
                    "edgeDirection": "INBOUND",
                    "allowedCollections": ["CS"],
                    "edgeFilters": {
                        "Label": ["COMPOSED_PRIMARILY_OF"],
                        "Source": [],
                    },
                    "setOperation": "Union",
                    "graphType": "phenotypes",
                    "includeInterNodeEdges": True,
                    "returnCollections": ["CS"],
                },
                "perNodeSettings": {},
            },
            {
                "id": "preset-dsct-phase-3",
                "name": "Their datasets",
                "originSource": "previousPhase",
                "originNodeIds": [],
                "previousPhaseId": "preset-dsct-phase-2",
                "originFilter": "all",
                "settings": {
                    # CSD -IS_ABOUT-> CS, so INBOUND from the cell sets.
                    # Datasets only: the cell types come from phase 4, which
                    # gets trimmed to the subtree before anything is drawn.
                    "depth": 1,
                    "edgeDirection": "INBOUND",
                    "allowedCollections": ["CSD"],
                    "edgeFilters": {"Label": ["IS_ABOUT"], "Source": []},
                    "setOperation": "Union",
                    "graphType": "phenotypes",
                    "includeInterNodeEdges": True,
                },
                "perNodeSettings": {},
            },
            {
                # This phase does the pruning. Starting from the cell sets,
                # the only cell types that survive are ones a cell set points
                # at — subtypes nothing was sampled for never enter the graph.
                #
                # A cell set has exactly one COMPOSED_PRIMARILY_OF target in
                # the data today, which would make every cell type here a
                # phase-1 one by construction. That is not a guarantee the
                # schema makes, so nothing downstream relies on it: phase 6
                # intersects with the phase-1 subtree, and phase 3 no longer
                # contributes cell types, so a second target outside the
                # subtree is dropped rather than drawn.
                "id": "preset-dsct-phase-4",
                "name": "Cell types that have cell sets",
                "originSource": "previousPhase",
                "originNodeIds": [],
                "previousPhaseId": "preset-dsct-phase-2",
                "originFilter": "all",
                "settings": {
                    "depth": 1,
                    "edgeDirection": "OUTBOUND",
                    "allowedCollections": ["CL"],
                    "edgeFilters": {
                        "Label": ["COMPOSED_PRIMARILY_OF"],
                        "Source": [],
                    },
                    "setOperation": "Union",
                    "graphType": "phenotypes",
                    "includeInterNodeEdges": True,
                    "returnCollections": ["CL"],
                },
                "perNodeSettings": {},
            },
            {
                "id": "preset-dsct-phase-5",
                "name": "Ancestors of those cell types",
                "originSource": "previousPhase",
                "originNodeIds": [],
                "previousPhaseId": "preset-dsct-phase-4",
                "originFilter": "all",
                "settings": {
                    # Climbs past the origin cell type to the root of the
                    # ontology; phase 6 cuts it back down.
                    "depth": 9,
                    "edgeDirection": "OUTBOUND",
                    "allowedCollections": ["CL"],
                    "edgeFilters": {"Label": ["SUB_CLASS_OF"], "Source": []},
                    "setOperation": "Union",
                    "graphType": "phenotypes",
                    "includeInterNodeEdges": True,
                },
                "perNodeSettings": {},
            },
            {
                # Ancestors-of-the-used-cell-types INTERSECT the phase-1
                # subtree is exactly the SUB_CLASS_OF chain between them and
                # the origin cell type — no branches that lead nowhere, and
                # nothing above the origin.
                "id": "preset-dsct-phase-6",
                "name": "Trim the ancestors to the subtype tree",
                "originSource": "multiplePhases",
                "originNodeIds": [],
                "previousPhaseIds": [
                    "preset-dsct-phase-5",
                    "preset-dsct-phase-1",
                ],
                "phaseCombineOperation": "Intersection",
                "originFilter": "all",
                "settings": {
                    "graphType": "phenotypes",
                    "includeInterNodeEdges": True,
                    "edgeFilters": {"Label": ["SUB_CLASS_OF"], "Source": []},
                },
                "perNodeSettings": {},
            },
            {
                # Every dataset is about exactly one organ, so this adds one
                # node per organ and one edge per dataset — the datasets
                # cluster by organ with no other change to the graph. The
                # cell sets carry their own DERIVES_FROM organ, but it always
                # matches their dataset's, so attaching it there too would
                # only duplicate edges.
                "id": "preset-dsct-phase-7",
                "name": "Organs those datasets are about",
                "originSource": "previousPhase",
                "originNodeIds": [],
                "previousPhaseId": "preset-dsct-phase-3",
                "originFilter": "all",
                "settings": {
                    "depth": 1,
                    "edgeDirection": "OUTBOUND",
                    "allowedCollections": ["UBERON"],
                    "edgeFilters": {"Label": ["IS_ABOUT"], "Source": []},
                    "setOperation": "Union",
                    "graphType": "phenotypes",
                    "includeInterNodeEdges": True,
                },
                "perNodeSettings": {},
            },
            {
                "id": "preset-dsct-phase-8",
                "name": "Datasets by organ, cell sets, and the cell type hierarchy",
                "originSource": "multiplePhases",
                "originNodeIds": [],
                "previousPhaseIds": [
                    "preset-dsct-phase-3",
                    "preset-dsct-phase-6",
                    "preset-dsct-phase-7",
                ],
                "phaseCombineOperation": "Union",
                "originFilter": "all",
                "settings": {
                    # The inter-node scan reconnects the halves: the hierarchy
                    # spine from phase 6 to the cell types phase 3 attached its
                    # datasets and cell sets to, and each dataset to its organ.
                    "graphType": "phenotypes",
                    "includeInterNodeEdges": True,
                    "edgeFilters": {
                        "Label": [
                            "SUB_CLASS_OF",
                            "COMPOSED_PRIMARILY_OF",
                            "IS_ABOUT",
                        ],
                        "Source": [],
                    },
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
            "The parent and child cell types around a starting point in the "
            "cell ontology. Add a cell type to begin."
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
            "The cell types located in the respiratory system. Collects "
            "every anatomical structure under the respiratory system, then "
            "takes a single hop to the cell types next to them — the cell "
            "ontology itself is deliberately not traversed. Returns cell "
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
            "The epithelial cell types located in the respiratory system — "
            "everything under epithelial cell that is also part of "
            "respiratory anatomy. Returns cell types only."
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
        "id": "respiratory-marker-gene-panel",
        "name": "Respiratory system cell type marker gene panel",
        "description": (
            "Gene symbols linked to respiratory system cell types through "
            "evidence-based biomarker relationships."
        ),
        "category": "Marker Gene Analysis",
        "layoutMode": "force",
        "phases": [
            {
                "id": "preset-resp-panel-phase-1",
                "name": "Retrieve respiratory system cell type marker genes",
                "originSource": "manual",
                "originNodeIds": ["UBERON/0001004"],
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
                            "SELECTIVELY_EXPRESSES",
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
            "respiratory system. Narrows to epithelial cells in respiratory "
            "anatomy, follows them to cell sets and marker genes, and "
            "returns just the genes. Coverage grows as the ETL fills in "
            "cell-type-to-cell-set mappings."
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
                            "SELECTIVELY_EXPRESSES",
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
        "id": "respiratory-markers-to-diseases",
        "name": "Respiratory system biomarkers to diseases",
        "description": (
            "Biomarker combinations found in the respiratory system and the "
            "diseases they are associated with."
        ),
        "category": "Disease Analysis",
        "layoutMode": "force",
        "phases": [
            {
                "id": "preset-resp-disease-phase-1",
                "name": "Identify respiratory system biomarkers",
                "originSource": "manual",
                "originNodeIds": ["UBERON/0001004"],
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
                "id": "preset-resp-disease-phase-2",
                "name": "Trace to associated diseases",
                "originSource": "previousPhase",
                "originNodeIds": [],
                "previousPhaseId": "preset-resp-disease-phase-1",
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
            "The genes associated with a disease and the cell types they "
            "implicate. Defaults to pulmonary hypertension — swap in any "
            "disease."
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
                            "SELECTIVELY_EXPRESSES",
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
            "Genes that both underlie a disease and are targeted by a "
            "compound that treats it. Runs two traversals across all "
            "diseases and keeps the overlap."
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
            "Step 1 of the Broken Big Dipper. Finds drug-repurposing "
            "candidates: genes whose protein is hit by a drug that does not "
            "already treat the gene's disease, leaving the dipper's closing "
            "side missing. Pick a gene from the results and run 'Big Dipper: "
            "explore a candidate' to see its full dipper. Phase 1 samples "
            "the disease collection by default — raise its origin count to "
            "scan more."
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
            "The positive control for 'Broken Big Dipper: candidate genes'. "
            "Finds genes whose protein is hit by a drug that already treats "
            "the gene's disease, so the dipper's closing side is present. "
            "Phase 1 samples the disease collection by default — raise its "
            "origin count to scan more."
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
            "The full Big Dipper for one gene (default FLT1), for candidates "
            "from either the broken or the complete list. Shows the gene's "
            "diseases, its protein and the drugs targeting that protein, the "
            "cell types expressing it, and any treatment edges closing back "
            "to those diseases. A closing edge means a complete dipper; its "
            "absence is a repurposing candidate."
        ),
        "category": "Disease Analysis",
        "layoutMode": "big-dipper",
        # A dipper is edge-dense (the FLT1 explorer draws ~150 edges).
        # Labeling every one of them buries the shape, so start with
        # edge labels off; the Labels panel can turn them back on.
        "labelStates": {"link-label": False},
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
                        "Label": [
                            "EXPRESSES",
                            "SELECTIVELY_EXPRESSES",
                            "COMPOSED_PRIMARILY_OF",
                        ],
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
            "Every pulmonary hypertension subtype, collected down the "
            "subclass hierarchy from the root disease term."
        ),
        "category": "Example: Pulmonary Hypertension",
        "layoutMode": "force",
        "phases": _build_ph_phases("preset-ph-subtypes", 1),
    },
    {
        "id": "ph-drugs",
        "name": "Therapeutic compounds",
        "description": (
            "Pulmonary hypertension subtypes plus the compounds used to "
            "treat each one."
        ),
        "category": "Example: Pulmonary Hypertension",
        "layoutMode": "force",
        "phases": _build_ph_phases("preset-ph-drugs", 2),
    },
    {
        "id": "ph-drug-targets",
        "name": "Drug molecular targets",
        "description": (
            "Pulmonary hypertension treatments traced to the genes and "
            "proteins they target."
        ),
        "category": "Example: Pulmonary Hypertension",
        "layoutMode": "force",
        "phases": _build_ph_phases("preset-ph-targets", 3),
    },
    {
        "id": "ph-drug-target-cell-types",
        "name": "Cell types expressing drug targets",
        "description": (
            "Pulmonary hypertension drug targets traced to the cell types "
            "that express them."
        ),
        "category": "Example: Pulmonary Hypertension",
        "layoutMode": "force",
        "phases": _build_ph_phases("preset-ph-cells", 4),
    },
]
