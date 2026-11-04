"""
Service for collection-related operations.
"""

import logging

from arango_api.db import db_ontologies
from arango_api.services.base import get_db_and_graph
from arango_api.services.version_service import META_COLLECTION

logger = logging.getLogger(__name__)

# Collections that live in the database but are not part of either named graph.
# The frontend seeds its allowed-collections filter from get_collections() and
# passes that list to AQL's `OPTIONS { vertexCollections: ... }`, where a
# non-graph collection aborts the whole traversal with ERR 1926 rather than
# being ignored.
NON_GRAPH_COLLECTIONS = frozenset({META_COLLECTION})


def get_collections(collection_type, graph="ontologies"):
    """
    Get all collection names of a given type from the database.

    Excludes system collections and the metadata collections listed in
    NON_GRAPH_COLLECTIONS, which are not traversable graph members.

    Args:
        collection_type (str): The type of collections to retrieve ("document" or "edge").
        graph (str): The graph type ("ontologies" or "phenotypes").

    Returns:
        list: A list of collection names.
    """
    db, _ = get_db_and_graph(graph)
    all_collections = db.collections()
    collections = [
        collection
        for collection in all_collections
        if collection["type"] == collection_type
        and not collection["name"].startswith("_")
        and collection["name"] not in NON_GRAPH_COLLECTIONS
    ]
    return [collection["name"] for collection in collections]


def get_all_by_collection(coll, graph):
    """
    Get all documents from a specific collection.

    Args:
        coll (str): The collection name.
        graph (str): The graph type ("ontologies" or "phenotypes").

    Returns:
        cursor: An ArangoDB cursor with all documents, ordered by key.
    """
    db, _ = get_db_and_graph(graph)
    # Storage order changes with every restore, and collection-origin callers
    # take the first N, so an unsorted read picks a different N each time.
    return db.aql.execute(
        "FOR doc IN @@collection SORT doc._key RETURN doc",
        bind_vars={"@collection": coll},
    )


def get_collection_count(coll, graph):
    """
    Return the number of documents in a collection.

    Cheap server-side count (no document transfer), used by the Workflow
    Builder's collection-origin selector to show how many nodes a collection
    has before the user chooses how many to use as origins.

    Args:
        coll (str): The collection name.
        graph (str): The graph type ("ontologies" or "phenotypes").

    Returns:
        int: The document count, or 0 if the collection does not exist.
    """
    db, _ = get_db_and_graph(graph)
    if not db.has_collection(coll):
        logger.warning("Collection '%s' not found", coll)
        return 0
    return db.collection(coll).count()


def get_by_id(coll, doc_id):
    """
    Get a single document by its ID.

    Args:
        coll (str): The collection name.
        doc_id (str): The document ID.

    Returns:
        dict or None: The document if found, None otherwise.
    """
    return db_ontologies.collection(coll).get(doc_id)


def get_edges_by_id(edge_coll, direction, item_coll, item_id):
    """
    Get edges related to a specific document.

    Args:
        edge_coll (str): The edge collection name.
        direction (str): The direction field name ("_from" or "_to").
        item_coll (str): The item collection name.
        item_id (str): The item ID.

    Returns:
        cursor: An ArangoDB cursor with matching edges.
    """
    return db_ontologies.collection(edge_coll).find(
        {direction: f"{item_coll}/{item_id}"}
    )
