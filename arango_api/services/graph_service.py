"""
Service for graph traversal operations.
"""

import json
import logging
import time

from arango_api.aql_safety import is_safe_aql_identifier
from arango_api.db import db_ontologies, GRAPH_NAME_ONTOLOGIES
from arango_api.services.base import get_db_and_graph
from arango_api.services.collection_service import get_collections

logger = logging.getLogger(__name__)

# Vertex-collection membership changes only when a dataset is restored, so a
# coarse TTL is plenty. Mirrors schema_guard.py's cache shape.
CACHE_TTL_SECONDS = 300

# Expiry-only, keyed by graph. Nothing to invalidate — a dataset restore
# replaces the process's view within one TTL.
_vertex_collections_cache = {}


def reset_vertex_collections_cache():
    """Clear the cached graph-membership sets. Intended for tests."""
    _vertex_collections_cache.clear()


def _get_graph_vertex_collections(graph):
    """Return the vertex collections that are members of the named graph.

    Args:
        graph (str): The graph type ("ontologies" or "phenotypes").

    Returns:
        frozenset | None: The collection names that are members of the
        graph, or None if membership could not be determined (Gharial
        unreachable). None is the caller's signal to fail open -- pass the
        caller's allowed_collections through unchanged rather than breaking
        every traversal because this lookup failed.
    """
    now = time.monotonic()
    cached = _vertex_collections_cache.get(graph)
    if cached and now < cached["expires_at"]:
        return cached["value"]

    try:
        db, graph_name = get_db_and_graph(graph)
        members = frozenset(db.graph(graph_name).vertex_collections())
    except Exception:
        logger.warning(
            "Could not read vertex collections for graph %r", graph, exc_info=True
        )
        return None

    if not members:
        # A graph with zero vertex collections is not a real answer -- treat it
        # as "could not determine" and fail open, the way schema_guard does.
        # Caching it would make every collection-filtered traversal return
        # nothing for a full TTL.
        logger.warning("Graph %r reported no vertex collections", graph)
        return None

    _vertex_collections_cache[graph] = {
        "value": members,
        "expires_at": now + CACHE_TTL_SECONDS,
    }
    return members


def _sanitize_allowed_collections(allowed_collections, graph):
    """Drop collections from allowed_collections that are not members of graph.

    ArangoDB's ERR 1926 (ERROR_GRAPH_VERTEX_COL_DOES_NOT_EXIST) aborts the
    whole traversal, with no partial data, the instant `vertexCollections`
    names a collection that is not part of the graph. This intersects the
    caller's list against the graph's real members so a stale or
    wrong-graph collection is dropped instead of aborting everything.

    `allowed_collections: []` already means "no restriction" to ArangoDB, so
    the empty-vs-sanitized-to-empty distinction must be tracked explicitly
    rather than collapsed to a bare list:
      - A genuinely empty input list is passed through as-is (unrestricted).
      - A non-empty input that sanitizes down to nothing must NOT silently
        become `[]`, because that would turn "show me only CHEBI" into "show
        me everything" -- a worse failure than the 500 it replaces.

    Args:
        allowed_collections (list): The caller's requested collections.
        graph (str): The graph type ("ontologies" or "phenotypes").

    Returns:
        tuple: (sanitized_collections, is_impossible).
        `is_impossible` is True only when the input was non-empty and
        sanitized down to nothing; callers must treat that as an explicit
        empty traversal rather than issuing a request with `[]`.
    """
    if not allowed_collections:
        return allowed_collections, False

    members = _get_graph_vertex_collections(graph)
    if members is None:
        # Fail open: Gharial is unreachable, so pass the caller's list
        # through unchanged rather than breaking every traversal.
        return allowed_collections, False

    sanitized = [c for c in allowed_collections if c in members]
    return sanitized, not sanitized


def _build_edge_filter_clause(
    edge_filters, bind_vars, exclude_filters=None, field_ref="e"
):
    """
    Translate an edge_filters dict into AQL clause condition lists.

    Returns a (positive_conditions, negative_conditions) tuple of lists of
    raw clause strings (no FILTER/PRUNE keywords). Mutates bind_vars in
    place to add filter bind variables. Handles both categorical filters
    (list of values, matched with IN) and numeric range filters (dict with
    min/max keys, matched with TO_NUMBER).

    Callers compose the final AQL by joining positive_conditions with
    " AND " (for FILTER) and negative_conditions with " OR " (for PRUNE).

    field_ref is the AQL variable the conditions read the edge attribute from
    (default "e" for the normal edge-traversal FILTER/PRUNE clauses; callers
    that filter per-path edges pass "CURRENT" so the conditions reference
    p.edges[* FILTER CURRENT.<field> ...]). Only the referenced variable
    changes; bind-var names are unaffected.
    """
    positive_conditions = []
    negative_conditions = []

    if not edge_filters and not exclude_filters:
        return positive_conditions, negative_conditions

    for key, values in (edge_filters or {}).items():
        if not is_safe_aql_identifier(key):
            logger.warning("Skipping edge filter with unsafe field name: %r", key)
            continue
        # The guard above already restricted key to an AQL identifier.
        safe_key = key

        # Numeric range filter: values is a dict with min/max keys
        if isinstance(values, dict):
            filter_min = values.get("min")
            filter_max = values.get("max")
            if filter_min is None and filter_max is None:
                continue

            range_parts = [f"{field_ref}.`{key}` != null", f'{field_ref}.`{key}` != ""']
            if filter_min is not None:
                bind_min = f"filter_min_{safe_key}"
                range_parts.append(f"TO_NUMBER({field_ref}.`{key}`) >= @{bind_min}")
                bind_vars[bind_min] = filter_min
            if filter_max is not None:
                bind_max = f"filter_max_{safe_key}"
                range_parts.append(f"TO_NUMBER({field_ref}.`{key}`) <= @{bind_max}")
                bind_vars[bind_max] = filter_max

            pos_cond = f"({' AND '.join(range_parts)})"
            positive_conditions.append(pos_cond)

            # PRUNE any real edge that does not satisfy the include condition —
            # including edges missing the attribute — so traversal does not walk
            # through a hidden edge and surface its descendants as orphans. The
            # `{field_ref} != null` guard keeps depth 0 (the start vertex, where
            # the edge is null) from being pruned, which would halt traversal.
            neg_cond = f"({field_ref} != null AND NOT {pos_cond})"
            negative_conditions.append(neg_cond)
            continue

        # Categorical filter: values is a list
        if values:
            bind_key = f"filter_value_{safe_key}"

            pos_cond = (
                f"({field_ref}.`{key}` != null AND ("
                f"(IS_STRING({field_ref}.`{key}`) AND {field_ref}.`{key}` IN @{bind_key}) OR "
                f"(IS_ARRAY({field_ref}.`{key}`) AND LENGTH(INTERSECTION({field_ref}.`{key}`, @{bind_key})) > 0)"
                f"))"
            )
            positive_conditions.append(pos_cond)

            # PRUNE any real edge that does not satisfy the include condition —
            # including edges missing the attribute — so traversal does not walk
            # through a hidden edge and surface its descendants as orphans. The
            # `{field_ref} != null` guard keeps depth 0 (the start vertex, where
            # the edge is null) from being pruned, which would halt traversal.
            neg_cond = f"({field_ref} != null AND NOT {pos_cond})"
            negative_conditions.append(neg_cond)

            bind_vars[bind_key] = values

    if exclude_filters:
        for key, values in exclude_filters.items():
            if not is_safe_aql_identifier(key):
                logger.warning("Skipping edge filter with unsafe field name: %r", key)
                continue
            if not values:
                continue
            # The guard above already restricted key to an AQL identifier.
            safe_key = key

            # Numeric range exclude: values is a dict with min/max keys
            if isinstance(values, dict):
                ex_min = values.get("min")
                ex_max = values.get("max")
                if ex_min is None and ex_max is None:
                    continue
                range_parts = []
                if ex_min is not None:
                    bind_min = f"exclude_min_{safe_key}"
                    range_parts.append(f"TO_NUMBER({field_ref}.`{key}`) >= @{bind_min}")
                    bind_vars[bind_min] = ex_min
                if ex_max is not None:
                    bind_max = f"exclude_max_{safe_key}"
                    range_parts.append(f"TO_NUMBER({field_ref}.`{key}`) <= @{bind_max}")
                    bind_vars[bind_max] = ex_max
                in_range = " AND ".join(range_parts)
                # Keep edges with no/empty attribute or outside the range.
                positive_conditions.append(
                    f'({field_ref}.`{key}` == null OR {field_ref}.`{key}` == "" OR NOT ({in_range}))'
                )
                # Prune traversal through edges that fall inside the excluded
                # range so their unique descendants are not walked (FILTER alone
                # hides the edge but does not stop descent).
                negative_conditions.append(
                    f'({field_ref}.`{key}` != null AND {field_ref}.`{key}` != "" AND ({in_range}))'
                )
                continue

            # Categorical exclude: values is a list
            bind_key = f"exclude_value_{safe_key}"
            match = (
                f"(IS_STRING({field_ref}.`{key}`) AND {field_ref}.`{key}` IN @{bind_key}) OR "
                f"(IS_ARRAY({field_ref}.`{key}`) AND LENGTH(INTERSECTION({field_ref}.`{key}`, @{bind_key})) > 0)"
            )
            # Keep edges that either lack the attribute or do not match.
            positive_conditions.append(
                f"({field_ref}.`{key}` == null OR NOT ({match}))"
            )
            # Prune traversal through edges that match the excluded value(s) so
            # their unique descendants are not walked.
            negative_conditions.append(f"({match})")
            bind_vars[bind_key] = values

    return positive_conditions, negative_conditions


def traverse_graph(
    node_ids,
    depth,
    edge_direction,
    allowed_collections,
    graph,
    edge_filters,
    exclude_edge_filters=None,
    terminal_collections=None,
    include_inter_node_edges=True,
    exclude_closing_edges=None,
    require_closing_edges=None,
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
        terminal_collections (list): Optional list of vertex collection names
            that are visited and returned but never expanded through. Uses
            PRUNE, which emits the matched vertex and stops descent past it.
            PRUNE is also evaluated at depth 0, where v is the traversal start
            vertex and e is null — even when the traversal range starts at 1 —
            and pruning there stops the traversal before it emits anything. The
            emitted condition is therefore guarded with `e != null`, which is
            what exempts the origin: an origin whose own collection is terminal
            still expands normally. Cannot be combined with
            exclude_closing_edges or require_closing_edges.
        include_inter_node_edges (bool): If True, includes edges between nodes
            in the result set. Ignored when exclude_closing_edges is active
            (the path-aware branch returns complete path links directly).
        exclude_closing_edges (dict): Optional path-aware anti-edge (NAC) filter,
            shape {"Label": [...]}. When set, only full-depth paths are kept whose
            endpoint has NO edge of the given label(s) back to that path's own
            origin (start node). Used to find "open" motifs, e.g. drug paths that
            do not close back to the disease via IS_SUBSTANCE_THAT_TREATS.
        require_closing_edges (dict): Positive complement of
            exclude_closing_edges, same shape {"Label": [...]}. When set, only
            full-depth paths are kept whose endpoint DOES have an edge of the
            given label(s) back to that path's own origin. Used to find "closed"
            motifs, e.g. complete drug-repurposing dippers where the drug treats
            the disease. Supplying both raises ValueError (they cannot compose).

    Returns:
        dict: A dictionary with start node IDs as keys, each containing
              'nodes' and 'links' from the traversal.

    Raises:
        ValueError: If edge_direction is not valid.
    """
    if edge_direction not in ["INBOUND", "OUTBOUND", "ANY"]:
        raise ValueError("edge_direction must be 'INBOUND', 'OUTBOUND', or 'ANY'")

    # The two path-closing filters cannot compose in one pass, so reject the
    # combination loudly rather than silently dropping one. require_mode keeps
    # paths that DO close; the default keeps paths that do NOT close.
    #
    # These guards depend only on the arguments, and they run BEFORE the
    # sanitize below on purpose: an impossible collection list returns an empty
    # traversal, which would otherwise mask a caller bug that deserves to raise.
    exclude_labels = (exclude_closing_edges or {}).get("Label") or []
    require_labels = (require_closing_edges or {}).get("Label") or []
    if exclude_labels and require_labels:
        raise ValueError(
            "Cannot set both exclude_closing_edges and require_closing_edges "
            "on one phase."
        )
    # Guard on the extracted labels, not the raw dicts: callers routinely send
    # {"Label": []} for a phase with no closing-edge filter at all, which is
    # truthy as a dict and would raise here for no reason.
    if terminal_collections and (exclude_labels or require_labels):
        raise ValueError(
            "terminal_collections cannot be combined with closing-edge filters; "
            "the closing-edge query needs complete fixed-depth paths, so it "
            "cannot stop at a terminal vertex."
        )

    db, graph_name = get_db_and_graph(graph)

    # Sanitize once, upstream of both unconditional `vertexCollections`
    # injection sites below (the closing-labels branch and the default
    # branch), so neither can hand ArangoDB a non-member collection and
    # abort the whole traversal with ERR 1926.
    allowed_collections, allowed_collections_impossible = _sanitize_allowed_collections(
        allowed_collections, graph
    )
    if allowed_collections_impossible:
        # Every requested collection was dropped. `[]` reads as "no
        # restriction" to ArangoDB, so returning it here would turn a narrow
        # request into an unrestricted one -- return an explicit empty
        # traversal instead (invariant 2a).
        return {node_id: {"nodes": [], "links": []} for node_id in node_ids}

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
        edge_filters, bind_vars, exclude_filters=exclude_edge_filters
    )
    if positive_conditions:
        filter_string = f"FILTER {' AND '.join(positive_conditions)}"

    # Terminal collections prune by *vertex* collection, unlike the edge-attribute
    # conditions above. PRUNE still returns the matched vertex, so the terminal
    # node and its connecting edge appear in the result; only descent past it
    # stops. OR-composed with the edge conditions so enabling one feature does
    # not silently disable the other.
    #
    # The `e != null` guard is required, not cosmetic. ArangoDB evaluates PRUNE
    # at depth 0 as well, where v is the start vertex and e is null, even though
    # the traversal range is 1..@depth. Without the guard, starting from a vertex
    # whose own collection is terminal prunes at depth 0 and the traversal
    # returns no neighbors at all — measured: origin UBERON/0000004 with terminal
    # ["UBERON"] at depth 1 returned 0 vertices unguarded vs 69 guarded.
    prune_conditions = list(negative_conditions)
    if terminal_collections:
        bind_vars["terminal_collections"] = terminal_collections
        prune_conditions.append(
            "(e != null AND PARSE_COLLECTION(v._id) IN @terminal_collections)"
        )

    # PRUNE is emitted whenever there are conditions to act on. Both categorical
    # and numeric exclude filters populate negative_conditions (to stop descent
    # through excluded edges), as do the "not matched" branches of include
    # filters. The guard only avoids emitting an empty (syntactically invalid)
    # PRUNE clause when there are genuinely no conditions.
    if prune_conditions:
        prune_string = f"PRUNE {' OR '.join(prune_conditions)}"

    # exclude_labels / require_labels are extracted and validated above, before
    # the collection sanitize, so a caller bug raises instead of being masked.
    require_mode = bool(require_labels)
    closing_labels = require_labels if require_mode else exclude_labels
    if closing_labels:
        # Path-aware closing-edge query. Unlike the default path, this must
        # traverse complete fixed-depth paths (@depth..@depth) so the closing-edge
        # check can test the true endpoint. Each origin's closing neighbours are
        # looked up once, before the walk; the path survives when its endpoint
        # is not among them (exclude / anti-edge) or is (require / dipper).
        # PRUNE stops descent through an edge the filter rejects. A path cut
        # short that way never reaches @depth, so it is not emitted, and the
        # conditions are null-guarded, so depth 0 is never pruned. On a
        # disease-collection scan this is the difference between ~2 s and
        # ~0.1 s per 500 origins.
        # The full include/exclude edge-filter clause is applied per path edge
        # (not just a Label include), so an exclude-mode edge filter combined
        # with a closing-edge setting is honored: a path is kept only when
        # every one of its edges satisfies the clause.
        # Build a dedicated bind-var set; the edge-filter clause helper may have
        # registered bind vars that this query does not reference, and ArangoDB
        # rejects declared-but-unused bind parameters.
        anti_bind_vars = {
            "node_ids": node_ids,
            "depth": depth,
            "graph": graph_name,
            "allowed_collections": allowed_collections,
            "closing_labels": closing_labels,
        }
        path_positive, _ = _build_edge_filter_clause(
            edge_filters,
            anti_bind_vars,
            exclude_filters=exclude_edge_filters,
            field_ref="CURRENT",
        )
        _, prune_conditions = _build_edge_filter_clause(
            edge_filters, anti_bind_vars, exclude_filters=exclude_edge_filters
        )
        path_prune = ""
        if prune_conditions:
            path_prune = f"PRUNE {' OR '.join(prune_conditions)}"
        path_label_filter = ""
        if path_positive:
            path_conditions = " AND ".join(path_positive)
            # Keep a path only if NONE of its edges violate the include/exclude
            # clause (i.e. every path edge satisfies it).
            path_label_filter = (
                f"FILTER LENGTH(p.edges[* FILTER NOT ({path_conditions})]) == 0"
            )
        aql_query = f"""
         FOR start_node_id IN @node_ids
             LET start_node_doc = DOCUMENT(start_node_id)
             LET closers = (
                 FOR cv, ce IN 1..1 ANY start_node_id GRAPH @graph
                     FILTER ce.Label IN @closing_labels
                     RETURN DISTINCT cv._id
             )
             LET surviving = (
                 FOR v, e, p IN @depth..@depth {edge_direction} start_node_id GRAPH @graph
                     {path_prune}
                     OPTIONS {{ vertexCollections: @allowed_collections }}
                     {path_label_filter}
                     FILTER {'' if require_mode else 'NOT '}(v._id IN closers)
                     RETURN p
             )
             LET all_nodes = (
                 FOR node IN UNION_DISTINCT(
                     FLATTEN(surviving[*].vertices), [start_node_doc]
                 )
                     FILTER node != null
                     RETURN node
             )
             LET all_links = UNIQUE(FLATTEN(surviving[*].edges))
             RETURN {{
                 "start_node_id": start_node_id,
                 "data": {{ "nodes": all_nodes, "links": all_links }}
             }}
         """
        cursor = db.aql.execute(aql_query, bind_vars=anti_bind_vars)
        return {item["start_node_id"]: item["data"] for item in cursor}

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

         // DOCUMENT() yields null when the start id is not in the collection,
         // which happens whenever a saved workflow outlives the key format it
         // was anchored on. Emitting that null hands the client a [null] node
         // list, so drop it here and let the phase come back empty instead.
         LET all_nodes = (
             FOR node IN UNION_DISTINCT(
                 traversal[*].v,
                 [start_node_doc]
             )
                 FILTER node != null
                 RETURN node
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
                list(all_node_ids),
                graph,
                edge_filters=edge_filters,
                exclude_edge_filters=exclude_edge_filters,
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
        exclude_edge_filters = settings.get("excludeEdgeFilters", {})
        terminal_collections = settings.get("terminalCollections", [])

        result_for_node = traverse_graph(
            node_ids=[node_id],
            depth=depth,
            edge_direction=edge_direction,
            allowed_collections=allowed_collections,
            graph=graph,
            edge_filters=edge_filters,
            exclude_edge_filters=exclude_edge_filters,
            terminal_collections=terminal_collections,
            include_inter_node_edges=include_inter_node_edges,
            exclude_closing_edges=settings.get("excludeClosingEdges"),
            require_closing_edges=settings.get("requireClosingEdges"),
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


def find_inter_node_edges(
    node_ids, graph="ontologies", edge_filters=None, exclude_edge_filters=None
):
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
    positive_conditions, _ = _build_edge_filter_clause(
        edge_filters, bind_vars, exclude_filters=exclude_edge_filters
    )
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
    exclude_edge_filters=None,
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
        edge_filters (dict): Edge attribute filters a path's edges must satisfy.
        path_limit (int): Max paths to enumerate per origin pair.
        max_depth (int|None): Max number of edges per path. None = no limit.
        exclude_edge_filters (dict): Edge attribute values a path may not contain.

    Returns:
        dict: {nodes: [...], links: [...]}
    """
    if not node_ids or len(node_ids) < 2:
        return {"nodes": [], "links": []}

    db, graph_name = get_db_and_graph(graph)

    # Same sanitize as traverse_graph: the max_depth branch below feeds
    # allowed_collections to `vertexCollections`, so a non-member would abort
    # the whole query with ERR 1926. Reachable from the Connected Paths
    # workflow.
    allowed_collections, allowed_collections_impossible = _sanitize_allowed_collections(
        allowed_collections, graph
    )
    if allowed_collections_impossible:
        # Every requested collection was dropped. An empty list reads as "no
        # restriction", so returning one here would widen a narrow request
        # into an unrestricted one (invariant 2a).
        return {"nodes": [], "links": []}

    bind_vars = {"node_ids": node_ids, "graph": graph_name}

    # Filters apply per path, not per edge: a path is only meaningful if every
    # edge on it is one the caller asked for. Mirrors the anti-edge path clause
    # built above.
    path_positive, _ = _build_edge_filter_clause(
        edge_filters,
        bind_vars,
        exclude_filters=exclude_edge_filters,
        field_ref="CURRENT",
    )

    if max_depth is not None:
        # With depth limit: use traversal (natively supports depth + vertexCollections)
        options_parts = ['uniqueVertices: "path"']
        if allowed_collections:
            # Bind rather than interpolate, matching traverse_graph. Collection
            # names originate in a caller-supplied ListField(CharField), so
            # splicing them into the query text put unvalidated strings in the
            # AQL; a bind var removes that surface entirely.
            options_parts.append("vertexCollections: @allowed_collections")
            bind_vars["allowed_collections"] = allowed_collections
        options_clause = ", ".join(options_parts)

        bind_vars["depth"] = int(max_depth)

        edge_filter_clause = ""
        if path_positive:
            conditions = " AND ".join(path_positive)
            edge_filter_clause = (
                f"FILTER LENGTH(p.edges[* FILTER NOT ({conditions})]) == 0"
            )

        aql_query = f"""
            LET all_paths = (
                FOR start_node IN @node_ids
                    FOR end_node IN @node_ids
                        FILTER start_node < end_node
                        FOR v, e, p IN 1..@depth ANY start_node
                            GRAPH @graph
                            OPTIONS {{{options_clause}}}
                            FILTER v._id == end_node
                            {edge_filter_clause}
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
        # IS_SAME_COLLECTION takes the name as a string literal, so this branch
        # cannot use a bind var the way the one above does. Quote each name with
        # json.dumps rather than splicing it raw: AQL string literals share
        # JSON's double-quote-and-backslash syntax, so this escapes anything the
        # fail-open path might let through (an unreachable Gharial passes the
        # caller's list on unsanitized).
        #
        # Deliberately quote rather than filter. Dropping names that fail some
        # identifier pattern would silently discard a legitimate graph member
        # with an unusual-but-valid name, and if it were the only one allowed the
        # filter would vanish and widen the query -- the same widening this step
        # exists to prevent.
        if allowed_collections:
            coll_checks = " AND ".join(
                f"NOT IS_SAME_COLLECTION({json.dumps(c)}, CURRENT)"
                for c in allowed_collections
            )
            coll_filter = (
                f"FILTER LENGTH(path.vertices[* " f"FILTER {coll_checks}]) == 0"
            )

        edge_filter_clause = ""
        if path_positive:
            conditions = " AND ".join(path_positive)
            edge_filter_clause = (
                f"FILTER LENGTH(path.edges[* FILTER NOT ({conditions})]) == 0"
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
                        {edge_filter_clause}
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
