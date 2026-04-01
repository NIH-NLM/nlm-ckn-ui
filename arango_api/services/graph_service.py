"""
Service for graph traversal operations.
"""
import logging
import re

from arango_api.db import db_ontologies, GRAPH_NAME_ONTOLOGIES
from arango_api.services.base import get_db_and_graph

logger = logging.getLogger(__name__)


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
    if edge_filters:
        positive_conditions = []
        negative_conditions = []

        for key, values in edge_filters.items():
            safe_key = re.sub(r'[^a-zA-Z0-9_]', '', key)

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

        if positive_conditions:
            filter_string = f"FILTER {' AND '.join(positive_conditions)}"
            prune_string = f"PRUNE {' OR '.join(negative_conditions)}"

    # Build inter-node edges query section if enabled
    inter_node_edges_query = ""
    if include_inter_node_edges:
        inter_node_edges_query = f"""
         LET all_node_ids = all_nodes[*]._id

         LET inter_node_edges = (
             FOR v IN all_nodes
                 FOR neighbor, e IN 1..1 ANY v._id GRAPH @graph
                     OPTIONS {{ vertexCollections: @allowed_collections }}
                     FILTER neighbor._id IN all_node_ids
                     RETURN DISTINCT e
         )

         LET combined_links = UNION_DISTINCT(all_links, inter_node_edges)
        """
        links_field = "combined_links"
    else:
        links_field = "all_links"

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

         {inter_node_edges_query}

         RETURN {{
             "start_node_id": start_node_id,
             "data": {{
                 "nodes": all_nodes,
                 "links": {links_field}
             }}
         }}
     """

    cursor = db.aql.execute(aql_query, bind_vars=bind_vars)
    results = {item["start_node_id"]: item["data"] for item in cursor}

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
