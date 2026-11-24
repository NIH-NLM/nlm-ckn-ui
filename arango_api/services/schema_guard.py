"""Detect workflow presets whose edge filters no longer match the loaded data.

Presets pin edge predicates as bare strings in ``edgeFilters.Label``. When the
ETL renames a predicate, the filter stops matching and the preset returns fewer
results with no error — the failure this module exists to make visible.

Every read here fails open. A guard that flags all 24 presets because ArangoDB
hiccuped is worse than no guard, so an unreadable dataset yields ``None``
("cannot determine") rather than an empty set ("nothing exists").
"""

import logging
import time

from arango_api.services.base import get_db_and_graph
from arango_api.services.collection_service import get_collections

logger = logging.getLogger(__name__)

# Labels change only when a dataset is restored, so a coarse TTL is plenty.
CACHE_TTL_SECONDS = 300

# Phase settings keys whose value is a {"Label": [...]} filter.
LABEL_FILTER_KEYS = ("edgeFilters", "excludeClosingEdges", "requireClosingEdges")

# "ontologies" rather than the app's request-level default ("phenotypes", see
# react/src/constants/graph.js) is deliberate: it carries more labels, so a
# preset that falls back to it is checked against a strictly larger known-label
# set, erring toward fewer false positives rather than more.
DEFAULT_GRAPH = "ontologies"

# Expiry-only, keyed by graph. Nothing to invalidate — a dataset restore
# replaces the process's view within one TTL.
_cache = {}


def reset_cache():
    """Clear the cached label sets. Intended for tests."""
    _cache.clear()


def get_dataset_labels(graph):
    """Return the distinct edge ``Label`` values in a graph, or None.

    Args:
        graph (str): The graph type ("ontologies" or "phenotypes").

    Returns:
        frozenset | None: The labels present, or None if they could not be
        determined (database unreachable, no edge collections). None is the
        caller's signal to skip validation rather than flag everything.
    """
    now = time.monotonic()
    cached = _cache.get(graph)
    if cached and now < cached["expires_at"]:
        return cached["value"]

    try:
        db, _ = get_db_and_graph(graph)
        edge_collections = get_collections("edge", graph)
        if not edge_collections:
            logger.warning(
                "No edge collections in graph %r; skipping label check", graph
            )
            return None

        # Collection names come from db.collections(), never from user input,
        # so interpolating them is safe. ArangoDB names cannot contain backticks.
        subqueries = ", ".join(
            f"(FOR e IN `{name}` RETURN DISTINCT e.Label)" for name in edge_collections
        )
        query = f"RETURN UNIQUE(FLATTEN([{subqueries}]))"
        rows = list(db.aql.execute(query))
        labels = frozenset(label for label in (rows[0] if rows else []) if label)
    except Exception:
        logger.warning("Could not read edge labels for graph %r", graph, exc_info=True)
        return None

    if not labels:
        # An empty result is indistinguishable from "the dataset genuinely has
        # no labels" here, and flagging every preset on that basis is exactly
        # the failure mode this module exists to avoid. Treat it the same as
        # any other cannot-determine case: do not cache, do not flag.
        logger.warning("No edge labels found in graph %r; skipping label check", graph)
        return None

    # Only successes are cached; a transient outage must not pin None for the
    # whole TTL.
    _cache[graph] = {"value": labels, "expires_at": now + CACHE_TTL_SECONDS}
    return labels


def _default_graph(preset):
    """The graph a phase belongs to when it does not declare one itself.

    Three of the shipped presets omit graphType on a later phase and inherit it
    from the phase that established the traversal.
    """
    for phase in preset.get("phases") or []:
        graph = (phase.get("settings") or {}).get("graphType")
        if graph:
            return graph
    return DEFAULT_GRAPH


def find_unknown_labels(preset, labels_by_graph):
    """Return the edge labels a preset filters on that the dataset lacks.

    Args:
        preset (dict): A workflow preset.
        labels_by_graph (dict): Graph name -> the labels present in it, or None
            when that graph could not be read.

    Returns:
        list: Sorted, deduplicated label names. Empty when the preset is valid
        or when its graph could not be read.
    """
    default_graph = _default_graph(preset)
    unknown = set()

    for phase in preset.get("phases") or []:
        settings = phase.get("settings") or {}
        graph = settings.get("graphType") or default_graph
        known = labels_by_graph.get(graph)
        if known is None:
            # Could not determine what this graph holds — do not guess.
            continue
        for key in LABEL_FILTER_KEYS:
            for label in (settings.get(key) or {}).get("Label") or []:
                if label not in known:
                    unknown.add(label)

    # Linked columns follow edges of the solution step's graph.
    solution = preset.get("solution") or {}
    solution_phase = next(
        (
            p
            for p in preset.get("phases") or []
            if p.get("id") == solution.get("phaseId")
        ),
        {},
    )
    graph = (solution_phase.get("settings") or {}).get("graphType") or default_graph
    known = labels_by_graph.get(graph)
    if known is not None:
        for column in solution.get("linkedColumns") or []:
            for hop in column.get("path") or []:
                label = hop.get("label")
                if label and label not in known:
                    unknown.add(label)

    return sorted(unknown)
