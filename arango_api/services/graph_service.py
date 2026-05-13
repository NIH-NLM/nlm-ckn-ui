"""
Service for graph traversal operations.
"""

import logging
import re

from arango_api.db import db_ontologies, GRAPH_NAME_ONTOLOGIES
from arango_api.services.base import get_db_and_graph
from arango_api.services.collection_service import get_collections

logger = logging.getLogger(__name__)


def _build_edge_filter_clause(edge_filters, bind_vars):
    """
    Translate an edge_filters dict into AQL clause condition lists.

    Returns a (positive_conditions, negative_conditions) tuple of lists of
    raw clause strings (no FILTER/PRUNE keywords). Mutates bind_vars in
    place to add filter bind variables. Handles both categorical filters
    (list of values, matched with IN) and numeric range filters (dict with
    min/max keys, matched with TO_NUMBER).

    Callers compose the final AQL by joining positive_conditions with
    " AND " (for FILTER) and negative_conditions with " OR " (for PRUNE).
    """
    positive_conditions = []
    negative_conditions = []

    if not edge_filters:
        return positive_conditions, negative_conditions

    for key, values in edge_filters.items():
        safe_key = re.sub(r"[^a-zA-Z0-9_]", "", key)

        # Numeric range filter: values is a dict with min/max keys
        if isinstance(values, dict):
            filter_min = values.get("min")
            filter_max = values.get("max")
            if filter_min is None and filter_max is None:
                continue

            range_parts = [f"e.`{key}` != null", f'e.`{key}` != ""']
            if filter_min is not None:
                bind_min = f"filter_min_{safe_key}"
                range_parts.append(f"TO_NUMBER(e.`{key}`) >= @{bind_min}")
                bind_vars[bind_min] = filter_min
            if filter_max is not None:
                bind_max = f"filter_max_{safe_key}"
                range_parts.append(f"TO_NUMBER(e.`{key}`) <= @{bind_max}")
                bind_vars[bind_max] = filter_max

            pos_cond = f"({' AND '.join(range_parts)})"
            positive_conditions.append(pos_cond)

            neg_cond = f"(e.`{key}` != null AND NOT ({' AND '.join(range_parts[2:])}))"
            negative_conditions.append(neg_cond)
            continue

        # Categorical filter: values is a list
        if values:
            bind_key = f"filter_value_{safe_key}"

            pos_cond = (
                f"(e.`{key}` != null AND ("
                f"(IS_STRING(e.`{key}`) AND e.`{key}` IN @{bind_key}) OR "
                f"(IS_ARRAY(e.`{key}`) AND LENGTH(INTERSECTION(e.`{key}`, @{bind_key})) > 0)"
                f"))"
            )
            positive_conditions.append(pos_cond)

            neg_cond = (
                f"(e.`{key}` != null AND NOT ("
                f"(IS_STRING(e.`{key}`) AND e.`{key}` IN @{bind_key}) OR "
                f"(IS_ARRAY(e.`{key}`) AND LENGTH(INTERSECTION(e.`{key}`, @{bind_key})) > 0)"
                f"))"
            )
            negative_conditions.append(neg_cond)

            bind_vars[bind_key] = values

    return positive_conditions, negative_conditions


def traverse_graph(
    node_ids,
    depth,
    edge_direction,
    allowed_collections,
    graph,
    edge_filters,
    include_inter_node_edges=True,
):
    """
    Constructs and executes a graph traversal AQL query.

    Args:
        node_ids (list): A list of starting node _id strings.
        depth (int): The maximum depth for the graph traversal.
        edge_direction (str): 'INBOUND', 'OUTBOUND', or 'ANY'.
        allowed_collections (list): A list of vertex collection names to include.
        graph (str): The graph type ("ontologies" or "phenotypes").
        edge_filters (dict): A dictionary for filtering edges.
        include_inter_node_edges (bool): If True, includes edges between nodes
            in the result set.

    Returns:
        dict: A dictionary with start node IDs as keys, each containing
              'nodes' and 'links' from the traversal.

    Raises:
        ValueError: If edge_direction is not valid.
    """
    if edge_direction not in ["INBOUND", "OUTBOUND", "ANY"]:
        raise ValueError("edge_direction must be 'INBOUND', 'OUTBOUND', or 'ANY'")

    db, graph_name = get_db_and_graph(graph)

    bind_vars = {
        "node_ids": node_ids,
        "depth": depth,
        "graph": graph_name,
        "allowed_collections": allowed_collections,
    }

    # Build the filtering and pruning logic
    filter_string = ""
    prune_string = ""
    positive_conditions, negative_conditions = _build_edge_filter_clause(
        edge_filters, bind_vars
    )
    if positive_conditions:
        filter_string = f"FILTER {' AND '.join(positive_conditions)}"
        prune_string = f"PRUNE {' OR '.join(negative_conditions)}"

    aql_query = f"""
     FOR start_node_id IN @node_ids
         LET start_node_doc = DOCUMENT(start_node_id)

         LET traversal = (
             FOR v, e IN 1..@depth {edge_direction} start_node_id GRAPH @graph

                 {prune_string}

                 OPTIONS {{ vertexCollections: @allowed_collections }}

                 {filter_string}

                 RETURN DISTINCT {{ v: v, e: e }}
         )

         LET all_nodes = UNION_DISTINCT(
             traversal[*].v,
             [start_node_doc]
         )

         LET all_links = UNIQUE(traversal[*].e)

         RETURN {{
             "start_node_id": start_node_id,
             "data": {{
                 "nodes": all_nodes,
                 "links": all_links
             }}
         }}
     """

    cursor = db.aql.execute(aql_query, bind_vars=bind_vars)
    results = {item["start_node_id"]: item["data"] for item in cursor}

    if include_inter_node_edges:
        all_node_ids = set()
        for data in results.values():
            for node in data.get("nodes") or []:
                if node and node.get("_id"):
                    all_node_ids.add(node["_id"])

        if all_node_ids:
            inter_edges = find_inter_node_edges(
                list(all_node_ids), graph, edge_filters=edge_filters
            )
            inter_by_id = {e["_id"]: e for e in inter_edges if e and e.get("_id")}

            for data in results.values():
                node_ids_in_result = {
                    n["_id"] for n in (data.get("nodes") or []) if n and n.get("_id")
                }
                existing_ids = {
                    l["_id"] for l in (data.get("links") or []) if l and l.get("_id")
                }
                for eid, edge in inter_by_id.items():
                    if (
                        eid not in existing_ids
                        and edge.get("_from") in node_ids_in_result
                        and edge.get("_to") in node_ids_in_result
                    ):
                        data["links"].append(edge)

    return results


def traverse_graph_advanced(
    node_ids,
    advanced_settings,
    graph,
    include_inter_node_edges=True,
):
    """
    Orchestrates multiple graph traversals based on per-node settings.

    Args:
        node_ids (list): A list of starting node _id strings.
        advanced_settings (dict): A dictionary where keys are node_ids and
                                  values are settings objects for that node.
        graph (str): The graph type ("ontologies" or "phenotypes").
        include_inter_node_edges (bool): If True, includes edges between nodes.

    Returns:
        dict: A dictionary aggregating the results from all individual
              traversals, keyed by the start node ID.
    """
    aggregated_results = {}

    for node_id, settings in advanced_settings.items():
        if node_id not in node_ids:
            continue

        depth = settings.get("depth", 2)
        edge_direction = settings.get("edgeDirection", "ANY")
        allowed_collections = settings.get("allowedCollections", [])
        edge_filters = settings.get("edgeFilters", {})

        result_for_node = traverse_graph(
            node_ids=[node_id],
            depth=depth,
            edge_direction=edge_direction,
            allowed_collections=allowed_collections,
            graph=graph,
            edge_filters=edge_filters,
            include_inter_node_edges=include_inter_node_edges,
        )

        if result_for_node:
            aggregated_results.update(result_for_node)

    return aggregated_results


def get_neighbor_collections(node_id, graph="ontologies", edge_direction="ANY"):
    """
    Return the distinct vertex collection names reachable in exactly one hop
    from a given node.

    Args:
        node_id (str): The starting node _id (e.g. "CL/0000061").
        graph (str): The graph type ("ontologies" or "phenotypes").
        edge_direction (str): 'INBOUND', 'OUTBOUND', or 'ANY'.

    Returns:
        list: Sorted list of distinct collection name strings.

    Raises:
        ValueError: If edge_direction is not valid.
    """
    if edge_direction not in ["INBOUND", "OUTBOUND", "ANY"]:
        raise ValueError("edge_direction must be 'INBOUND', 'OUTBOUND', or 'ANY'")

    db, graph_name = get_db_and_graph(graph)

    aql_query = f"""
        FOR v IN 1..1 {edge_direction} @node_id GRAPH @graph
            OPTIONS {{ uniqueVertices: "global", bfs: true }}
            LIMIT 5000
            RETURN DISTINCT PARSE_COLLECTION(v._id)
    """

    bind_vars = {"node_id": node_id, "graph": graph_name}
    cursor = db.aql.execute(aql_query, bind_vars=bind_vars)
    return sorted(x for x in cursor if x is not None)


def find_inter_node_edges(node_ids, graph="ontologies", edge_filters=None):
    """
    Find all edges between a given set of nodes using direct edge collection scans.

    Args:
        node_ids (list): A list of node _id strings.
        graph (str): The graph type ("ontologies" or "phenotypes").
        edge_filters (dict): Optional edge attribute filters. Categorical
            filters use a list of values (matched with IN); numeric range
            filters use a dict with min/max keys (matched with TO_NUMBER).

    Returns:
        list: A list of edge documents connecting nodes in the set.
    """
    if not node_ids or len(node_ids) < 2:
        return []

    db, _ = get_db_and_graph(graph)
    edge_collections = get_collections("edge", graph)

    if not edge_collections:
        return []

    bind_vars = {"vertex_ids": node_ids}
    positive_conditions, _ = _build_edge_filter_clause(edge_filters, bind_vars)
    extra_filter = (
        f" AND ({' AND '.join(positive_conditions)})" if positive_conditions else ""
    )

    subqueries = []
    for i, coll in enumerate(edge_collections):
        bind_key = f"@coll_{i}"
        subqueries.append(
            f"(FOR e IN @@coll_{i} FILTER e._from IN @vertex_ids"
            f" AND e._to IN @vertex_ids{extra_filter} RETURN e)"
        )
        bind_vars[bind_key] = coll

    aql_query = f"RETURN UNION({', '.join(subqueries)})"
    cursor = db.aql.execute(aql_query, bind_vars=bind_vars)
    result = cursor.next()
    return result if result else []


def find_connecting_paths(
    node_ids,
    graph="phenotypes",
    allowed_collections=None,
    edge_filters=None,
    path_limit=100,
    max_depth=None,
):
    """
    Find paths between every pair of origin nodes via K_SHORTEST_PATHS.

    Returns all nodes and edges that lie on any path between any pair of
    the given origin nodes, restricted to the specified vertex collections
    and optionally bounded by a maximum path depth.

    Args:
        node_ids (list): 2+ node _id strings.
        graph (str): Graph type ("ontologies" or "phenotypes").
        allowed_collections (list): Vertex collections allowed on paths.
        edge_filters (dict): Reserved for future use.
        path_limit (int): Max paths to enumerate per origin pair.
        max_depth (int|None): Max number of edges per path. None = no limit.

    Returns:
        dict: {nodes: [...], links: [...]}
    """
    if not node_ids or len(node_ids) < 2:
        return {"nodes": [], "links": []}

    db, graph_name = get_db_and_graph(graph)

    bind_vars = {"node_ids": node_ids, "graph": graph_name}

    if max_depth is not None:
        # With depth limit: use traversal (natively supports depth + vertexCollections)
        options_parts = ['uniqueVertices: "path"']
        if allowed_collections:
            colls_str = ", ".join(f'"{c}"' for c in allowed_collections)
            options_parts.append(f"vertexCollections: [{colls_str}]")
        options_clause = ", ".join(options_parts)

        bind_vars["depth"] = int(max_depth)

        aql_query = f"""
            LET all_paths = (
                FOR start_node IN @node_ids
                    FOR end_node IN @node_ids
                        FILTER start_node < end_node
                        FOR v, e, p IN 1..@depth ANY start_node
                            GRAPH @graph
                            OPTIONS {{{options_clause}}}
                            FILTER v._id == end_node
                            RETURN p
            )

            LET all_nodes = UNIQUE(FLATTEN(all_paths[*].vertices))
            LET all_links = UNIQUE(FLATTEN(all_paths[*].edges))

            RETURN {{
                "nodes": all_nodes,
                "links": all_links
            }}
        """
    else:
        # Without depth limit: use K_SHORTEST_PATHS with collection filter
        coll_filter = ""
        if allowed_collections:
            coll_checks = " AND ".join(
                f'NOT IS_SAME_COLLECTION("{c}", CURRENT)' for c in allowed_collections
            )
            coll_filter = (
                f"FILTER LENGTH(path.vertices[* " f"FILTER {coll_checks}]) == 0"
            )

        bind_vars["path_limit"] = path_limit

        aql_query = f"""
            LET all_paths = (
                FOR start_node IN @node_ids
                    FOR end_node IN @node_ids
                        FILTER start_node < end_node
                        FOR path IN ANY K_SHORTEST_PATHS
                            start_node TO end_node
                            GRAPH @graph
                        {coll_filter}
                        LIMIT @path_limit
                        RETURN path
            )

            LET all_nodes = UNIQUE(FLATTEN(all_paths[*].vertices))
            LET all_links = UNIQUE(FLATTEN(all_paths[*].edges))

            RETURN {{
                "nodes": all_nodes,
                "links": all_links
            }}
        """

    cursor = db.aql.execute(aql_query, bind_vars=bind_vars, max_runtime=30)
    result = cursor.next()
    return result if result else {"nodes": [], "links": []}


def find_shortest_paths(node_ids, edge_direction="ANY"):
    """
    Finds all shortest paths between every unique pair of nodes.

    Args:
        node_ids (list): A list of 2 or more node _id strings.
        edge_direction (str): Traversal direction ('INBOUND', 'OUTBOUND', or 'ANY').

    Returns:
        dict: A dictionary with unique 'nodes' and 'links' from all paths.

    Raises:
        ValueError: If edge_direction is not valid.
    """
    if not isinstance(node_ids, list) or len(node_ids) < 2:
        return {"nodes": [], "links": []}

    if edge_direction not in ["INBOUND", "OUTBOUND", "ANY"]:
        raise ValueError("edge_direction must be 'INBOUND', 'OUTBOUND', or 'ANY'")

    bind_vars = {"node_ids": node_ids, "graph": GRAPH_NAME_ONTOLOGIES}

    aql_query = f"""
        LET all_paths = (
            FOR start_node IN @node_ids
                FOR end_node IN @node_ids
                    FILTER start_node < end_node

                    LET p = FIRST(
                        FOR path IN {edge_direction} ALL_SHORTEST_PATHS start_node TO end_node GRAPH @graph
                        RETURN path
                    )

                    FILTER p != null
                    RETURN p
        )

        LET all_nodes = UNIQUE(FLATTEN(all_paths[*].vertices))
        LET all_links = UNIQUE(FLATTEN(all_paths[*].edges))

        RETURN {{
            "nodes": all_nodes,
            "links": all_links
        }}
        """

    cursor = db_ontologies.aql.execute(aql_query, bind_vars=bind_vars)
    result = cursor.next()

    return result
