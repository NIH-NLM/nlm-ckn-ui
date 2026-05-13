"""
Service for document retrieval operations.
"""

import logging

from arango_api.db import db_ontologies
from arango_api.services.base import get_db_and_graph
from arango_api.services.collection_service import get_collections

logger = logging.getLogger(__name__)


def get_documents(document_ids, graph_name):
    """
    Fetches full document details for a list of document IDs.

    Args:
        document_ids (list): List of document IDs in "collection/key" format.
        graph_name (str): The graph type ("ontologies" or "phenotypes").

    Returns:
        list: List of document dictionaries.
    """
    if not isinstance(document_ids, list) or not document_ids:
        return []

    # Group document keys by their collection name
    collections_to_keys = {}
    for doc_id in document_ids:
        try:
            collection_name, key = doc_id.split("/")
            collections_to_keys.setdefault(collection_name, []).append(key)
        except ValueError:
            logger.warning("Skipping malformed document ID: %s", doc_id)
            continue

    if not collections_to_keys:
        return []

    db_connection, _ = get_db_and_graph(graph_name)

    all_results = []
    query = """
        FOR doc IN @@collection
            FILTER doc._key IN @keys
            RETURN doc
    """

    for collection, keys in collections_to_keys.items():
        bind_vars = {"@collection": collection, "keys": keys}
        try:
            cursor = db_connection.aql.execute(query, bind_vars=bind_vars)
            results_for_collection = [doc for doc in cursor]
            all_results.extend(results_for_collection)
        except Exception:
            logger.exception("Error executing query for collection '%s'", collection)
            continue

    return all_results


def get_edge_filter_options(fields_to_query):
    """
    Query database for unique values for specified edge attributes.

    Auto-detects whether each field is numeric or categorical. If >90% of
    non-null values for a field are numeric, returns {type: "numeric", min, max}.
    Otherwise returns {type: "categorical", values: [...]}.

    Args:
        fields_to_query (list): List of field names to get unique values for.

    Returns:
        dict: Dictionary mapping field names to typed filter descriptors.

    Raises:
        Exception: Re-raises database errors for handling by caller.
    """
    if not fields_to_query:
        return {}

    db = db_ontologies

    try:
        edge_collections = get_collections("edge")

        if not edge_collections:
            return {}

        union_subqueries = [
            f" (FOR doc IN `{coll}` RETURN doc) " for coll in edge_collections
        ]
        all_edges_clause = "UNION(" + ", ".join(union_subqueries) + ")"

        query = f"""
            LET all_edges = ({all_edges_clause})

            LET options_per_field = (
                FOR field_name IN @fields_to_query
                    LET values = (
                        FOR edge IN all_edges
                            FILTER HAS(edge, field_name) AND edge[field_name] != null AND edge[field_name] != ""
                            COLLECT value = edge[field_name]
                            RETURN value
                    )
                    LET numeric_values = (
                        FOR v IN values
                            LET n = TO_NUMBER(v)
                            FILTER IS_NUMBER(n) AND n != 0 OR TO_STRING(v) == "0"
                            RETURN n
                    )
                    LET is_numeric = LENGTH(values) > 0 AND LENGTH(numeric_values) / LENGTH(values) > 0.9
                    RETURN is_numeric
                        ? {{ [field_name]: {{ type: "numeric", min: MIN(numeric_values), max: MAX(numeric_values) }} }}
                        : {{ [field_name]: {{ type: "categorical", values: UNIQUE(values) }} }}
            )

            RETURN MERGE(options_per_field)
        """

        bind_vars = {"fields_to_query": fields_to_query}

        cursor = db.aql.execute(query, bind_vars=bind_vars)
        results = list(cursor)[0]

        return results

    except Exception:
        logger.exception("Error executing edge_filter_options query")
        raise
