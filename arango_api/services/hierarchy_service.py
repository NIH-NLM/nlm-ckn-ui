"""
Service for the CL hierarchy rendered by the Browse page.

The hierarchy follows one curated predicate from the root of the CL collection.
Edges are read from their edge collection directly rather than by filtering a
traversal on a predicate label: labels get renamed between ETL releases, and a
stale label filter returns fewer rows with no error.

Descendant counts are a single query plus a memoised walk (see
`descendant_counts`). Fetching children is not: `get_hierarchy`'s
`with_grandchildren` issues one query per child to fetch that child's own
children, so loading the root costs 1 + (number of root children) round
trips -- an N+1, left as-is rather than optimised.
"""

import logging
import math
import threading
import time

from arango_api.db import GRAPH_NAME_ONTOLOGIES, db_ontologies
from arango_api.services import version_service

logger = logging.getLogger(__name__)

# The predicates offered by the Browse page. Only SUB_CLASS_OF describes a
# usable hierarchy in the loaded data: 3,325 CL nodes under one root. The next
# densest, DEVELOPS_FROM, is a forest of 124 roots over 515 nodes, and the rest
# carry 1-35 edges each. Adding a label here is a starting point, not a
# finished change: the query shape below is hard-coded to child -> parent
# edges read INBOUND to the root (e._to == parent, returning e._from), so a
# new label must first be checked for that same direction, and for having a
# single root — DEVELOPS_FROM does not and would need more than a config
# entry.
CL_HIERARCHY_LABELS = {
    "SUB_CLASS_OF": {
        "collection": "CL",
        "edges": "CL-CL",
        "root": "CL/0000000",
    },
}


class HierarchyServiceError(Exception):
    """Raised when the hierarchy cannot be read."""


class UnknownLabelError(ValueError):
    """Raised for a label that is not in the curated config."""


def config_for(label):
    """Return the config for a curated label, or raise UnknownLabelError.

    No caller-supplied string ever reaches AQL as a predicate: the label selects
    a config entry, and only the entry's own values are bound into a query.
    """
    try:
        return CL_HIERARCHY_LABELS[label]
    except KeyError:
        raise UnknownLabelError(
            f"Unknown hierarchy label '{label}'. "
            f"Valid labels: {', '.join(sorted(CL_HIERARCHY_LABELS))}."
        ) from None


# {(graph_name, label[, dataset_version]): {node_id: descendant_count}}. The
# dataset version is folded into the key (see `_cache_key`) so a blue-green
# swap under an unchanged graph name rebuilds this without intervention.
_DESCENDANT_COUNT_CACHE = {}
_DESCENDANT_COUNT_LOCK = threading.Lock()


def build_descendant_counts(edges):
    """Return {node_id: distinct descendant count} for child -> parent edges.

    The hierarchy is a DAG — a CL node can have several parents — so a node is
    counted once per ancestor, not once per path to it.
    """
    children = {}
    for child, parent in edges:
        children.setdefault(parent, []).append(child)

    memo = {}

    def descendants(node):
        cached = memo.get(node)
        if cached is not None:
            return cached
        memo[node] = set()
        found = set()
        for child in children.get(node, ()):
            found.add(child)
            found |= descendants(child)
        memo[node] = found
        return found

    nodes = set(children)
    for kids in children.values():
        nodes.update(kids)
    return {node: len(descendants(node)) for node in nodes}


def weight_for(count):
    """Return the arc weight for a descendant count.

    Arc widths are sqrt-compressed: the hierarchy is severely skewed, and raw
    counts render the largest branch as a single wedge with unusable slivers
    beside it. Ordering and rough magnitude survive the transform. Callers show
    the raw count, never the weight.
    """
    return max(1, math.sqrt(count))


def _edges_for(db, label):
    """Return [(child_id, parent_id)] for every edge carrying the label."""
    config = config_for(label)
    query = """
        FOR e IN @@edges
            FILTER e.Label == @label
            RETURN [e._from, e._to]
    """
    cursor = db.aql.execute(
        query, bind_vars={"@edges": config["edges"], "label": label}
    )
    return [(row[0], row[1]) for row in cursor]


def _cache_key(graph_name, label):
    """Return the descendant-count cache key, including the dataset version.

    Dataset deployments are blue-green swaps that can replace data under an
    unchanged graph name, so the graph name alone is not enough to detect a
    swap. The loaded dataset version is folded in so a swap rebuilds the
    cache instead of serving stale counts. When the version is unrecorded
    ("unknown") it is left out of the key rather than treated as a value
    that could change and force a rebuild on every request.
    """
    version = version_service.get_loaded_etl_version()
    if not version or version == version_service.UNKNOWN:
        return (graph_name, label)
    return (graph_name, label, version)


def descendant_counts(db, graph_name, label):
    """Return {node_id: distinct descendant count}, memoised per graph, label
    and loaded dataset version.

    Computed in Python from the edge list rather than by traversing per node:
    the whole collection takes a single query plus a memoised walk, against
    roughly one traversal per node in AQL. The organ-count cache this replaces
    was the heaviest read on the Arango host.
    """
    key = _cache_key(graph_name, label)
    cached = _DESCENDANT_COUNT_CACHE.get(key)
    if cached is not None:
        return cached
    with _DESCENDANT_COUNT_LOCK:
        cached = _DESCENDANT_COUNT_CACHE.get(key)
        if cached is not None:
            return cached
        start = time.monotonic()
        edges = _edges_for(db, label)
        if not edges:
            logger.warning("No %s edges found for %s; not caching", label, graph_name)
            return {}
        counts = build_descendant_counts(edges)
        _DESCENDANT_COUNT_CACHE[key] = counts
        logger.info(
            "Cached %s descendant counts for %d nodes (%.2fs)",
            label,
            len(counts),
            time.monotonic() - start,
        )
        return counts


def _node(doc, counts, with_children=None):
    """Shape one document for the client."""
    count = counts.get(doc["_id"], 0)
    return {
        "_id": doc["_id"],
        "label": doc.get("label") or doc.get("name") or doc["_key"],
        "descendant_count": count,
        "weight": weight_for(count),
        "value": weight_for(count),
        "_hasChildren": count > 0,
        "children": with_children,
    }


def _child_docs(db, label, parent_id):
    """Return the documents one level below parent_id, by the label's edges."""
    config = config_for(label)
    query = """
        FOR e IN @@edges
            FILTER e.Label == @label AND e._to == @parent
            FOR doc IN @@collection
                FILTER doc._id == e._from
                RETURN DISTINCT doc
    """
    cursor = db.aql.execute(
        query,
        bind_vars={
            "@edges": config["edges"],
            "@collection": config["collection"],
            "label": label,
            "parent": parent_id,
        },
    )
    return list(cursor)


def get_hierarchy(label, parent_id=None):
    """Return the hierarchy root with two levels, or one node's children.

    With no parent_id: the configured root, its children, and their children.
    With a parent_id: that node's children, each carrying its own children.
    The two-level shape is what the Browse page's prefetch expects.
    """
    db = db_ontologies
    if db is None:
        raise HierarchyServiceError("Database connection not available.")
    config = config_for(label)
    graph_name = GRAPH_NAME_ONTOLOGIES

    if parent_id is not None and not parent_id.startswith(f"{config['collection']}/"):
        raise UnknownLabelError(
            f"parent_id '{parent_id}' is not in collection "
            f"'{config['collection']}'."
        )

    try:
        counts = descendant_counts(db, graph_name, label)

        def with_grandchildren(parent):
            return [
                _node(grandchild, counts)
                for grandchild in _child_docs(db, label, parent["_id"])
            ]

        target = parent_id or config["root"]
        children = [
            _node(child, counts, with_children=with_grandchildren(child))
            for child in _child_docs(db, label, target)
        ]

        if parent_id is not None:
            return children

        root_doc = db.document(config["root"])
        if root_doc is None:
            raise HierarchyServiceError(
                f"Configured root {config['root']} is missing from the data."
            )
        return _node(root_doc, counts, with_children=children)
    except (HierarchyServiceError, UnknownLabelError):
        raise
    except Exception as e:
        logger.exception(
            "AQL execution failed for the %s hierarchy (parent=%s)",
            label,
            parent_id,
        )
        raise HierarchyServiceError("Failed to fetch the hierarchy.") from e


def available_labels():
    """Return the curated labels that have edges in the loaded data.

    A configured label absent from the data is omitted, so the page can show an
    error instead of an empty chart. Predicates get renamed between ETL
    releases, and this is the only place that failure becomes visible.
    """
    db = db_ontologies
    if db is None:
        raise HierarchyServiceError("Database connection not available.")
    try:
        labels = []
        for label, config in CL_HIERARCHY_LABELS.items():
            query = """
                FOR e IN @@edges
                    FILTER e.Label == @label
                    COLLECT WITH COUNT INTO n
                    RETURN n
            """
            cursor = db.aql.execute(
                query, bind_vars={"@edges": config["edges"], "label": label}
            )
            count = next(iter(cursor), 0)
            if count:
                labels.append(
                    {"label": label, "root": config["root"], "edge_count": count}
                )
        return labels
    except Exception as e:
        logger.exception("Failed to read available hierarchy labels")
        raise HierarchyServiceError("Failed to read hierarchy labels.") from e
