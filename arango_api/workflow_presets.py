"""
Pre-built workflow presets for the Workflow Builder.

These contain only query-semantic fields (no UI state like collapseLeafNodes,
useFocusNodes, showAdvancedSettings, or result). Frontend clients apply their
own UI defaults at load time.

This module is consumed by WorkflowPresetsView to serve presets over the API,
making them discoverable by non-browser clients (MCP tools, agents, etc.).
"""

PRESET_CATEGORIES = [
    {"id": "Ontology Exploration", "label": "Ontology Exploration"},
    {"id": "Cell Type Discovery", "label": "Cell Type Discovery"},
    {"id": "Marker Gene Analysis", "label": "Marker Gene Analysis"},
    {"id": "Disease Analysis", "label": "Disease Analysis"},
    {"id": "Example: Pulmonary Hypertension", "label": "Example: Pulmonary Hypertension"},
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
    "graphType": "ontologies",
    "includeInterNodeEdges": True,
}

_PH_DRUGS_PHASE_SETTINGS = {
    "depth": 1,
    "edgeDirection": "ANY",
    "allowedCollections": ["CHEMBL"],
    "edgeFilters": {"Label": ["IS_SUBSTANCE_THAT_TREATS"], "Source": []},
    "setOperation": "Union",
    "graphType": "ontologies",
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
    "graphType": "ontologies",
    "includeInterNodeEdges": True,
    "returnCollections": ["GS", "PR"],
}

_PH_CELL_TYPES_PHASE_SETTINGS = {
    "depth": 1,
    "edgeDirection": "ANY",
    "allowedCollections": ["CL"],
    "edgeFilters": {"Label": [], "Source": []},
    "setOperation": "Union",
    "graphType": "ontologies",
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
        "phases": [
            {
                "id": "preset-hierarchy-phase-1",
                "name": "Traverse cell type subclass hierarchy",
                "originSource": "manual",
                "originNodeIds": ["CL/0000235"],
                "previousPhaseId": None,
                "originFilter": "all",
                "settings": {
                    "depth": 3,
                    "edgeDirection": "INBOUND",
                    "allowedCollections": ["CL"],
                    "edgeFilters": {"Label": ["SUB_CLASS_OF"], "Source": []},
                    "setOperation": "Union",
                    "graphType": "ontologies",
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
                    "graphType": "ontologies",
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
                    "graphType": "ontologies",
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
                    "depth": 2,
                    "edgeDirection": "ANY",
                    "allowedCollections": ["CL", "BMC", "GS"],
                    "edgeFilters": {"Label": [], "Source": []},
                    "setOperation": "Union",
                    "graphType": "ontologies",
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
                    "graphType": "ontologies",
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
                    "depth": 2,
                    "edgeDirection": "ANY",
                    "allowedCollections": ["BMC", "GS", "UBERON"],
                    "edgeFilters": {"Label": [], "Source": []},
                    "setOperation": "Union",
                    "graphType": "ontologies",
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
                    "graphType": "ontologies",
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
                    "graphType": "ontologies",
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
                    "edgeFilters": {"Label": ["SUB_CLASS_OF", "GENETIC_BASIS_FOR"], "Source": []},
                    "setOperation": "Union",
                    "graphType": "ontologies",
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
                    "depth": 1,
                    "edgeDirection": "ANY",
                    "allowedCollections": ["BMC", "CL", "GS", "PR"],
                    "edgeFilters": {"Label": [], "Source": []},
                    "setOperation": "Union",
                    "graphType": "ontologies",
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
            "Identifies genes that both underlie a disease (GENETIC_BASIS_FOR) "
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
                    "edgeFilters": {"Label": ["GENETIC_BASIS_FOR"], "Source": []},
                    "setOperation": "Union",
                    "graphType": "ontologies",
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
                    "graphType": "ontologies",
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
                    "graphType": "ontologies",
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
