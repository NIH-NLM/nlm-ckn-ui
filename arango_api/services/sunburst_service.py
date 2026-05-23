"""
Service for sunburst visualization data.
"""

import logging
import threading
import time

from arango_api.db import (
    db_ontologies,
    db_phenotypes,
    GRAPH_NAME_ONTOLOGIES,
    GRAPH_NAME_PHENOTYPES,
)

logger = logging.getLogger(__name__)

# Per-process cache of {graph_name: {uberon_id: distinct_cl_count}}.
# Graph names embed a version (e.g. KN-Phenotypes-v2.0), so a DB re-ingest
# with a new version key triggers a rebuild automatically.
_UBERON_CL_COUNT_CACHE: dict = {}
_UBERON_CL_COUNT_LOCK = threading.Lock()


class SunburstServiceError(Exception):
    """Custom exception for sunburst service errors."""

    def __init__(self, message, db_error=None):
        super().__init__(message)
        self.db_error = db_error


# Top-level UBERON terms shown under Homo sapiens. Mirrors the ingested
# organ/system folders at https://github.com/NIH-NLM/cell-kn/tree/main/data/prod.
# Replace with a direct read once that repo publishes a summary file.
PHENOTYPES_TOP_ORGANS = [
    "UBERON/0001004",  # respiratory_system
    "UBERON/0001555",  # digestive_tract
    "UBERON/0002107",  # liver
    "UBERON/0002097",  # skin_of_body
    "UBERON/0001264",  # pancreas
    "UBERON/0000948",  # heart_plus_pericardium
    "UBERON/0002113",  # kidney
    "UBERON/0002371",  # bone_marrow
]
PHENOTYPES_HUMAN_ID = "NCBITaxon/9606"
UBERON_SUBTREE_DEPTH = 5


def _get_uberon_cl_counts(db, graph_name):
    """Return {uberon_id: distinct_cl_count} for every UBERON node that has
    at least one CL descendant within UBERON_SUBTREE_DEPTH hops. Built on
    first use and memoized per graph_name for the life of the process."""
    cached = _UBERON_CL_COUNT_CACHE.get(graph_name)
    if cached is not None:
        return cached
    with _UBERON_CL_COUNT_LOCK:
        cached = _UBERON_CL_COUNT_CACHE.get(graph_name)
        if cached is not None:
            return cached
        logger.info("Building UBERON CL-count cache for %s", graph_name)
        start = time.monotonic()
        query = """
            FOR u IN UBERON
                LET cls = (
                    FOR v IN 1..@depth INBOUND u._id GRAPH @g
                        OPTIONS { bfs: true, uniqueVertices: "global" }
                        FILTER IS_SAME_COLLECTION("CL", v)
                        RETURN DISTINCT v._id
                )
                FILTER LENGTH(cls) > 0
                RETURN [u._id, LENGTH(cls)]
        """
        cursor = db.aql.execute(
            query,
            bind_vars={"g": graph_name, "depth": UBERON_SUBTREE_DEPTH},
            batch_size=5000,
        )
        entries = {row[0]: row[1] for row in cursor}
        if not entries:
            logger.warning(
                "UBERON CL-count query returned no rows for %s; not caching",
                graph_name,
            )
            return entries
        _UBERON_CL_COUNT_CACHE[graph_name] = entries
        logger.info(
            "Cached CL counts for %d UBERON nodes (%.2fs)",
            len(entries),
            time.monotonic() - start,
        )
        return entries


def get_phenotypes_sunburst(parent_id=None):
    """
    Lazy-loading sunburst for phenotypes.

    Initial load (parent_id=None): root -> Homo sapiens -> top UBERON organs,
    each populated with ALL distinct CL cells reachable through the organ's
    UBERON subtree (flat aggregation — no intermediate anatomy shown).

    Expansion (parent_id provided): returns direct children:
      NCBITaxon -> the top UBERON organs (with aggregated CL)
      UBERON    -> aggregated CL from subtree
      CL        -> GS via CL-GS
      GS        -> MONDO via GS-MONDO

    Raises:
        SunburstServiceError: If database is unavailable or query fails.
    """
    db = db_phenotypes
    if db is None:
        raise SunburstServiceError("Database connection not available.")
    graph_name = GRAPH_NAME_PHENOTYPES

    try:
        if parent_id is None:
            return _phenotypes_initial_load(db, graph_name)

        collection = parent_id.split("/", 1)[0] if "/" in parent_id else ""
        if collection == "NCBITaxon":
            return _phenotypes_organ_children(db, graph_name)
        if collection == "UBERON":
            return _phenotypes_uberon_children(db, graph_name, parent_id)
        if collection == "CL":
            return _phenotypes_cl_children(db, graph_name, parent_id)
        if collection == "GS":
            return _phenotypes_gs_children(db, graph_name, parent_id)
        return []
    except SunburstServiceError:
        raise
    except Exception as e:
        logger.exception(
            "AQL execution failed for phenotypes sunburst (parent=%s)", parent_id
        )
        db_error = None
        if hasattr(e, "response") and hasattr(e.response, "text"):
            db_error = e.response.text
        raise SunburstServiceError(
            "Failed to fetch phenotype structure.", db_error=db_error
        ) from e


def _aggregate_cl_for_organ(db, graph_name, organ_id):
    """Return all distinct CL nodes reachable from an organ through its
    UBERON PART_OF/SUB_CLASS_OF subtree. Each CL node gets _hasChildren
    set based on whether it has GS outbound edges."""
    query = """
        LET uberon_descendants = (
            FOR v IN 1..@depth INBOUND @organ GRAPH @g
                OPTIONS { bfs: true, uniqueVertices: "global" }
                FILTER IS_SAME_COLLECTION("UBERON", v)
                RETURN v._id
        )
        LET all_uberon = APPEND([@organ], uberon_descendants)
        LET all_cl = (
            FOR ub_id IN all_uberon
                FOR cl IN 1..1 INBOUND ub_id GRAPH @g
                    FILTER IS_SAME_COLLECTION("CL", cl)
                    RETURN DISTINCT cl
        )
        FOR cl IN all_cl
            LET gs_children = (
                FOR gs IN 1..1 OUTBOUND cl._id GRAPH @g
                    FILTER IS_SAME_COLLECTION("GS", gs)
                    LET has_kids = LENGTH(
                        FOR v2 IN 1..1 OUTBOUND gs._id GRAPH @g
                            FILTER IS_SAME_COLLECTION("MONDO", v2)
                                OR IS_SAME_COLLECTION("CHEMBL", v2)
                                OR IS_SAME_COLLECTION("BMC", v2)
                                OR IS_SAME_COLLECTION("PR", v2)
                            LIMIT 1 RETURN 1
                    ) > 0
                    RETURN MERGE(gs, {
                        value: 1, subtree_size: 1,
                        _hasChildren: has_kids, children: null
                    })
            )
            RETURN MERGE(cl, {
                value: 1, subtree_size: 1,
                _hasChildren: LENGTH(gs_children) > 0,
                children: gs_children
            })
    """
    return list(
        db.aql.execute(
            query,
            bind_vars={
                "organ": organ_id,
                "g": graph_name,
                "depth": UBERON_SUBTREE_DEPTH,
            },
        )
    )


def _get_cl_names_for_organ(db, graph_name, organ_id):
    """Lightweight CL list for an organ — names only, no GS/leaf chain."""
    query = """
        LET uberon_descendants = (
            FOR v IN 1..@depth INBOUND @organ GRAPH @g
                OPTIONS { bfs: true, uniqueVertices: "global" }
                FILTER IS_SAME_COLLECTION("UBERON", v)
                RETURN v._id
        )
        LET all_uberon = APPEND([@organ], uberon_descendants)
        FOR ub_id IN all_uberon
            FOR cl IN 1..1 INBOUND ub_id GRAPH @g
                FILTER IS_SAME_COLLECTION("CL", cl)
                RETURN DISTINCT MERGE(cl, {
                    value: 1, subtree_size: 1,
                    _hasChildren: true, children: null
                })
    """
    return list(
        db.aql.execute(
            query,
            bind_vars={
                "organ": organ_id,
                "g": graph_name,
                "depth": UBERON_SUBTREE_DEPTH,
            },
        )
    )


def _phenotypes_initial_load(db, graph_name):
    """Return Homo sapiens -> organs -> CL names (lightweight, no GS chain).
    The full GS/leaf chain loads on drilldown into a specific organ."""
    counts = _get_uberon_cl_counts(db, graph_name)
    organ_nodes = []
    for organ_id in PHENOTYPES_TOP_ORGANS:
        cursor = db.aql.execute("RETURN DOCUMENT(@id)", bind_vars={"id": organ_id})
        doc_list = list(cursor)
        if not doc_list or doc_list[0] is None:
            continue
        doc = doc_list[0]
        cl_children = _get_cl_names_for_organ(db, graph_name, organ_id)
        cl_count = counts.get(organ_id, 1)
        doc["value"] = cl_count
        doc["subtree_size"] = cl_count
        doc["_hasChildren"] = len(cl_children) > 0
        doc["children"] = cl_children
        organ_nodes.append(doc)

    cursor = db.aql.execute(
        "RETURN DOCUMENT(@id)", bind_vars={"id": PHENOTYPES_HUMAN_ID}
    )
    human_list = list(cursor)
    human_doc = human_list[0] if human_list else None

    if human_doc:
        human_doc["value"] = 1
        human_doc["_hasChildren"] = len(organ_nodes) > 0
        human_doc["children"] = organ_nodes
        return human_doc

    return {
        "_id": PHENOTYPES_HUMAN_ID,
        "label": "Homo sapiens",
        "_hasChildren": False,
        "children": [],
    }


def _phenotypes_organ_children(db, graph_name):
    """Children of Homo sapiens: lightweight organ list."""
    counts = _get_uberon_cl_counts(db, graph_name)
    results = []
    for organ_id in PHENOTYPES_TOP_ORGANS:
        cursor = db.aql.execute("RETURN DOCUMENT(@id)", bind_vars={"id": organ_id})
        doc_list = list(cursor)
        if not doc_list or doc_list[0] is None:
            continue
        doc = doc_list[0]
        cl_count = counts.get(organ_id, 1)
        doc["value"] = cl_count
        doc["subtree_size"] = cl_count
        doc["_hasChildren"] = cl_count > 0
        doc["children"] = None
        results.append(doc)
    return results


def _phenotypes_uberon_children(db, graph_name, parent_id):
    """Full CL -> GS -> leaf chain for a single organ (drilldown payload)."""
    return _aggregate_cl_for_organ(db, graph_name, parent_id)


def _phenotypes_cl_children(db, graph_name, parent_id):
    """CL -> GS, each GS with its MONDO/CHEMBL/BMC/PR children."""
    query = """
        FOR gs IN 1..1 OUTBOUND @pid GRAPH @g
            FILTER IS_SAME_COLLECTION("GS", gs)
            LET gs_kids = (
                FOR v2 IN 1..1 OUTBOUND gs._id GRAPH @g
                    FILTER IS_SAME_COLLECTION("MONDO", v2)
                        OR IS_SAME_COLLECTION("CHEMBL", v2)
                        OR IS_SAME_COLLECTION("BMC", v2)
                        OR IS_SAME_COLLECTION("PR", v2)
                    RETURN MERGE(v2, {
                        value: 1, subtree_size: 1,
                        _hasChildren: false, children: null
                    })
            )
            RETURN MERGE(gs, {
                value: 1, subtree_size: 1,
                _hasChildren: LENGTH(gs_kids) > 0,
                children: gs_kids
            })
    """
    return list(db.aql.execute(query, bind_vars={"pid": parent_id, "g": graph_name}))


def _phenotypes_gs_children(db, graph_name, parent_id):
    """GS -> MONDO/CHEMBL/BMC/PR (leaf nodes)."""
    query = """
        FOR v IN 1..1 OUTBOUND @pid GRAPH @g
            FILTER IS_SAME_COLLECTION("MONDO", v)
                OR IS_SAME_COLLECTION("CHEMBL", v)
                OR IS_SAME_COLLECTION("BMC", v)
                OR IS_SAME_COLLECTION("PR", v)
            RETURN MERGE(v, { value: 1, subtree_size: 1, _hasChildren: false, children: null })
    """
    return list(db.aql.execute(query, bind_vars={"pid": parent_id, "g": graph_name}))


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
