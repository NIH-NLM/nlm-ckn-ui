"""
Service for collection-related operations.
"""

import logging

from arango_api.db import db_ontologies
from arango_api.services.base import get_db_and_graph

logger = logging.getLogger(__name__)


def get_collections(collection_type, graph="ontologies"):
    """
    Get all collection names of a given type from the database.

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
    ]
    return [collection["name"] for collection in collections]


def get_all_by_collection(coll, graph):
    """
    Get all documents from a specific collection.

    Args:
        coll (str): The collection name.
        graph (str): The graph type ("ontologies" or "phenotypes").

    Returns:
        cursor: An ArangoDB cursor with all documents.
    """
    db, _ = get_db_and_graph(graph)
    collection = db.collection(coll)

    if not collection:
        logger.warning("Collection '%s' not found", coll)
    return collection.all()


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
