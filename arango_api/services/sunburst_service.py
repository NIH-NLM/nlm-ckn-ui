"""
Service for sunburst visualization data.
"""
import logging

from arango_api.db import (
    db_ontologies,
    db_phenotypes,
    GRAPH_NAME_ONTOLOGIES,
    GRAPH_NAME_PHENOTYPES,
)

logger = logging.getLogger(__name__)


class SunburstServiceError(Exception):
    """Custom exception for sunburst service errors."""

    def __init__(self, message, db_error=None):
        super().__init__(message)
        self.db_error = db_error


def get_phenotypes_sunburst(ignored_parent_id=None):
    """
    Fetch the entire phenotype sunburst structure.

    Traverses: NCBITaxon -> UBERON (filtered) -> CL -> GS -> (MONDO or (PR -> CHEMBL)).

    Args:
        ignored_parent_id: Ignored - always loads full structure.

    Returns:
        dict: The hierarchical sunburst data structure.

    Raises:
        SunburstServiceError: If database is unavailable or query fails.
    """
    db = db_phenotypes
    graph_name = GRAPH_NAME_PHENOTYPES

    initial_root_ids = ["NCBITaxon/9606"]
    uberon_terms = [
        "UBERON/0002048",  # lung
        "UBERON/0000966",  # retina
        "UBERON/0000955",  # brain
    ]
    graph_root_id = "root_phenotypes_full"

    # Collection and Edge Names
    EDGE_NC_UB = "UBERON-NCBITaxon"
    EDGE_UB_CL = "UBERON-CL"
    EDGE_CL_UB = "CL-UBERON"
    EDGE_CL_GS = "CL-GS"
    EDGE_GS_MO = "GS-MONDO"
    EDGE_GS_PR = "GS-PR"
    EDGE_PR_CH = "CHEMBL-PR"

    VC_NCBITAXON = "NCBITaxon"
    VC_UBERON = "UBERON"
    VC_CL = "CL"
    VC_GS = "GS"
    VC_MONDO = "MONDO"
    VC_CHEMBL = "CHEMBL"
    VC_PR = "PR"

    allowed_edges_aql_string = (
        f'["{EDGE_NC_UB}", "{EDGE_UB_CL}", "{EDGE_CL_UB}", "{EDGE_CL_GS}", '
        f'"{EDGE_GS_MO}", "{EDGE_GS_PR}", "{EDGE_PR_CH}"]'
    )

    if db is None:
        raise SunburstServiceError("Database connection not available.")

    query_full_structure = f"""
                LET ncbi_level_nodes = (
                    FOR ncbi_id IN @initial_root_ids
                        LET ncbi_node = DOCUMENT(ncbi_id)
                        FILTER ncbi_node != null AND IS_SAME_COLLECTION("{VC_NCBITAXON}", ncbi_node)

                        LET uberon_level_nodes = (
                            FOR uberon_node, edge1 IN 1..1 INBOUND ncbi_node._id GRAPH @graph_name
                                OPTIONS {{ edgeCollections: {allowed_edges_aql_string} }}
                                FILTER IS_SAME_COLLECTION("{VC_UBERON}", uberon_node)
                                FILTER uberon_node._id IN @uberon_terms

                                LET cl_level_nodes = (
                                    FOR cl_node, edge2 IN 1..1 INBOUND uberon_node._id GRAPH @graph_name
                                        OPTIONS {{ edgeCollections: {allowed_edges_aql_string} }}
                                        FILTER IS_SAME_COLLECTION("{VC_CL}", cl_node)

                                        LET gs_level_nodes = (
                                            FOR gs_node, edge3 IN 1..1 OUTBOUND cl_node._id GRAPH @graph_name
                                                OPTIONS {{ edgeCollections: {allowed_edges_aql_string} }}
                                                FILTER IS_SAME_COLLECTION("{VC_GS}", gs_node)

                                                LET gs_children_processed = (
                                                    FOR gs_child_node, edge_gs_to_child IN 1..1 OUTBOUND gs_node._id GRAPH @graph_name
                                                        OPTIONS {{ edgeCollections: {allowed_edges_aql_string} }}
                                                        FILTER IS_SAME_COLLECTION("{VC_MONDO}", gs_child_node) OR
                                                               IS_SAME_COLLECTION("{VC_PR}", gs_child_node)

                                                        LET processed_node_details = (
                                                            IS_SAME_COLLECTION("{VC_MONDO}", gs_child_node)
                                                            ?
                                                                MERGE(gs_child_node, {{ value: 1, _hasChildren: false, children: [] }})
                                                            :
                                                                (
                                                                    NOOPT((
                                                                        LET pr_node_intermediate = gs_child_node
                                                                        LET chembl_children_of_pr = (
                                                                            FOR chembl_node, edge_pr_to_chembl IN 1..1 INBOUND pr_node_intermediate._id GRAPH @graph_name
                                                                                OPTIONS {{ edgeCollections: {allowed_edges_aql_string} }}
                                                                                FILTER IS_SAME_COLLECTION("{VC_CHEMBL}", chembl_node)
                                                                                AND IS_SAME_COLLECTION("{EDGE_PR_CH}", edge_pr_to_chembl)
                                                                            RETURN MERGE(chembl_node, {{ value: 1, _hasChildren: false, children: [] }})
                                                                        )
                                                                        RETURN MERGE(pr_node_intermediate, {{
                                                                            value: 1,
                                                                            _hasChildren: COUNT(chembl_children_of_pr) > 0,
                                                                            children: chembl_children_of_pr
                                                                        }})
                                                                    ))
                                                                )[0]
                                                        )
                                                        RETURN processed_node_details
                                                )

                                                RETURN MERGE(gs_node, {{ value: 1, _hasChildren: COUNT(gs_children_processed) > 0, children: gs_children_processed }})
                                        )

                                        RETURN MERGE(cl_node, {{ value: 1, _hasChildren: COUNT(gs_level_nodes) > 0, children: gs_level_nodes }})
                                )

                                RETURN MERGE(uberon_node, {{ value: 1, _hasChildren: COUNT(cl_level_nodes) > 0, children: cl_level_nodes }})
                        )

                        RETURN MERGE(ncbi_node, {{ value: 1, _hasChildren: COUNT(uberon_level_nodes) > 0, children: uberon_level_nodes }})
                )

                LET root_node = {{
                    _id: @graph_root_id,
                    label: "NLM Cell Knowledge Network",
                    _hasChildren: COUNT(ncbi_level_nodes) > 0,
                    children: ncbi_level_nodes
                }}

                RETURN root_node
            """

    bind_vars = {
        "graph_name": graph_name,
        "initial_root_ids": initial_root_ids,
        "uberon_terms": uberon_terms,
        "graph_root_id": graph_root_id,
    }

    try:
        cursor = db.aql.execute(query_full_structure, bind_vars=bind_vars, stream=False)
        result_list = list(cursor)

        if not result_list:
            logger.warning("Full structure query returned no results")
            return {
                "_id": graph_root_id,
                "label": "Phenotype Associations - No Data",
                "_hasChildren": False,
                "children": [],
            }

        return result_list[0]

    except Exception as e:
        logger.exception("AQL execution failed for full structure load")
        db_error = None
        if hasattr(e, "response") and hasattr(e.response, "text"):
            db_error = e.response.text
        raise SunburstServiceError(
            "Failed to fetch full phenotype structure.", db_error=db_error
        )


def get_ontologies_sunburst(parent_id=None):
    """
    Fetch ontologies sunburst data.

    Supports initial load (L0+L1) and loading children + grandchildren on demand.

    Args:
        parent_id (str, optional): If provided, fetches children of this node.
            If None, fetches initial root nodes.

    Returns:
        dict or list: Root structure (dict) for initial load,
            or list of children for on-demand loading.

    Raises:
        SunburstServiceError: If database is unavailable or query fails.
    """
    db = db_ontologies
    graph_name = GRAPH_NAME_ONTOLOGIES
    label_filter = "subClassOf"
    initial_root_ids = [
        "CL/0000000",
        "GO/0008150",  # biological_process
        "GO/0003674",  # molecular_function
        "GO/0005575",  # cellular_component
        "PATO/0000001",
        "MONDO/0000001",
        "UBERON/0000000",
    ]

    if db is None:
        raise SunburstServiceError("Database connection not available.")

    if parent_id:
        # Fetch children and grandchildren for a specific parent
        query_children_grandchildren = """
            LET start_node_id = @parent_id

            FOR child_node, edge1 IN 1..1 INBOUND start_node_id GRAPH @graph_name
                FILTER edge1.label == @label_filter

                LET grandchildren = (
                    FOR grandchild_node, edge2 IN 1..1 INBOUND child_node._id GRAPH @graph_name
                        FILTER edge2.label == @label_filter

                        LET grandchild_has_children = COUNT(
                            FOR great_grandchild, edge3 IN 1..1 INBOUND grandchild_node._id GRAPH @graph_name
                                FILTER edge3.label == @label_filter
                                LIMIT 1 RETURN 1
                        ) > 0

                        RETURN {
                            _id: grandchild_node._id,
                            label: grandchild_node.label || grandchild_node.name || grandchild_node._key,
                            value: 1,
                            _hasChildren: grandchild_has_children,
                            children: null
                        }
                )

                LET child_has_children = COUNT(grandchildren) > 0

                RETURN {
                    _id: child_node._id,
                    label: child_node.label || child_node.name || child_node._key,
                    value: 1,
                    _hasChildren: child_has_children,
                    children: grandchildren
                }
        """
        bind_vars = {
            "parent_id": parent_id,
            "graph_name": graph_name,
            "label_filter": label_filter,
        }

        try:
            cursor = db.aql.execute(query_children_grandchildren, bind_vars=bind_vars)
            return list(cursor)
        except Exception as e:
            raise SunburstServiceError(
                f"Failed to fetch nested children data for {parent_id}: {e}"
            )

    else:
        # Fetch initial roots and their children
        initial_nodes_with_children = []
        graph_root_id = "root_nlm"

        for node_id in initial_root_ids:
            query_initial = """
                LET start_node_id = @node_id

                LET start_node_doc = DOCUMENT(start_node_id)
                FILTER start_node_doc != null

                LET start_node_has_children = COUNT(
                    FOR c1, e1 IN 1..1 INBOUND start_node_id GRAPH @graph_name
                        FILTER e1.label == @label_filter
                        LIMIT 1 RETURN 1
                ) > 0

                LET children_level1 = (
                    FOR child1_node, edge1 IN 1..1 INBOUND start_node_id GRAPH @graph_name
                        FILTER edge1.label == @label_filter

                        LET child1_has_children = COUNT(
                            FOR c2, e2 IN 1..1 INBOUND child1_node._id GRAPH @graph_name
                                FILTER e2.label == @label_filter
                                LIMIT 1 RETURN 1
                        ) > 0

                        RETURN {
                            _id: child1_node._id,
                            label: child1_node.label || child1_node.name || child1_node._key,
                            value: 1,
                            _hasChildren: child1_has_children,
                            children: null
                        }
                )

                RETURN {
                    _id: start_node_doc._id,
                    label: start_node_doc.label || start_node_doc.name || start_node_doc._key,
                    value: 1,
                    _hasChildren: start_node_has_children,
                    children: children_level1
                }
            """
            bind_vars = {
                "node_id": node_id,
                "graph_name": graph_name,
                "label_filter": label_filter,
            }

            try:
                cursor = db.aql.execute(query_initial, bind_vars=bind_vars)
                node_data_list = list(cursor)
                if node_data_list:
                    initial_nodes_with_children.append(node_data_list[0])
            except Exception:
                logger.exception("AQL execution failed for initial node %s", node_id)

        return {
            "_id": graph_root_id,
            "label": "NLM Cell Knowledge Network",
            "_hasChildren": len(initial_nodes_with_children) > 0,
            "children": initial_nodes_with_children,
        }
