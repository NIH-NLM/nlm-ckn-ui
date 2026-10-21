"""
Service for search operations.
"""

import logging
from itertools import chain

import requests

from arango_api.circuit_breaker import CircuitBreakerOpen
from arango_api.db import db_ontologies
from arango_api.services.base import get_db_and_graph
from arango_api.services.collection_service import get_collections

logger = logging.getLogger(__name__)

# Maximum number of search results returned by the dropdown query. The frontend
# renders results in pages of 20 and lazy-loads more on scroll, so an unbounded
# result set (thousands of fuzzy/n-gram matches for short terms like "K" or
# "cell") is wasted work and payload. Capping here keeps the query fast.
SEARCH_RESULT_LIMIT = 50

# Every document carries `_search`, an array of its own identifier forms
# (CURIE, underscore and PURL), indexed only with the `norm-lower` analyzer.
# It is matched whole by its own clause and boosted so a typed identifier puts
# its node first. It is server-side only: never searched through the per-field
# clauses below and never returned to the client.
IDENTIFIER_FIELD = "_search"
IDENTIFIER_BOOST = 1000.0

# Label fields read by the frontend's getLabel() (utils/collections.js
# individual_labels -> field_to_use). The search dropdown only needs _id, the
# fields actually searched, and whichever of these label fields a matched doc
# has, so the query projects this set instead of serializing full documents.
LABEL_FIELDS = [
    "Citation",
    "Label",
    "Link_to_publication",
    "_key",
    "author_cell_term",
    "cellxgene_collection",
    "cellxgene_dataset",
    "dataset_identifier",
    "definition",
    "exact_synonym",
    "gene_id",
    "gene_symbol",
    "label",
    "markers",
    "publication_doi",
    "uniprot_id",
]

# Fields the frontend's getBadges() reads to mark a row, e.g. the "Reference"
# badge on a reference cell set dataset (nlm-ckn#301), whose tooltip names the
# dataset's anatomical structure.
BADGE_FIELDS = ["anatomical_structure", "is_reference_dataset"]

# Failures meaning the database could not be reached, as opposed to a query
# that ran and failed. Callers answer these with 503 and invite a retry.
UNAVAILABLE_ERRORS = (
    CircuitBreakerOpen,
    requests.exceptions.ConnectionError,
    requests.exceptions.Timeout,
    ConnectionAbortedError,
)


class SearchServiceError(Exception):
    """Raised when a search fails, so callers can tell failure from no matches.

    Attributes:
        unavailable (bool): True when the database could not be reached.
    """

    def __init__(self, message="Search failed", unavailable=False):
        super().__init__(message)
        self.unavailable = unavailable


def search_by_term(search_term, search_fields, graph):
    """
    Search for documents matching a search term across specified fields.

    Uses a combination of exact match, Levenshtein fuzzy matching, and n-gram
    search to provide comprehensive results ranked by relevance.

    Args:
        search_term (str): The term to search for.
        search_fields (list): List of field names to search within.
        graph (str): The graph type ("ontologies" or "phenotypes").

    Returns:
        list: Sorted list of matching documents (empty when nothing matches).

    Raises:
        SearchServiceError: If the query could not be executed.
    """
    db_connection, _ = get_db_and_graph(graph)
    search_fields = [f for f in search_fields if f != IDENTIFIER_FIELD]

    # norm-lower also strips accents, so the term is normalized with the same
    # analyzer rather than LOWER(), after trimming a pasted identifier.
    query_beginning = """
            LET lower_search_term = LOWER(@search_term)
            LET identifier_term = FIRST(TOKENS(TRIM(@search_term), "norm-lower"))
            LET sortedDocs = (
                FOR doc IN indexed
                    SEARCH
                    BOOST(ANALYZER(doc.`{field}` == identifier_term, "norm-lower"), {boost})
                    """.format(field=IDENTIFIER_FIELD, boost=IDENTIFIER_BOOST)

    # Levenshtein match with no substitutions, boosted
    levenshtein_string = " OR ANALYZER("
    for field in search_fields:
        levenshtein_string += (
            f"BOOST(LEVENSHTEIN_MATCH(doc.`{field}`, lower_search_term, 0), 100.0) OR "
        )
    levenshtein_string_0 = levenshtein_string[0:-3] + ', "text_en_no_stem")'

    # Levenshtein match with substitutions, boosted less
    levenshtein_string = " OR ANALYZER("
    for field in search_fields:
        levenshtein_string += (
            f"BOOST(LEVENSHTEIN_MATCH(doc.`{field}`, lower_search_term, 1), 5.0) OR "
        )
    levenshtein_string_1 = levenshtein_string[0:-3] + ', "text_en_no_stem")'

    # n-gram search for phrases
    n_gram_string = " OR "
    for field in search_fields:
        n_gram_string += f'ANALYZER(doc.`{field}` LIKE CONCAT("%", CONCAT(@search_term, "%")), "n-gram") OR '
    n_gram_string = n_gram_string[0:-3]

    # Build exact match check for sorting. A node whose own identifier was
    # typed counts as exact too, or a cell set storing that CURIE in a searched
    # field (ontology_purl) would sort above the node it names; the boost then
    # puts the node first among the exact matches.
    exact_match_conditions = " OR ".join(
        [f"LOWER(doc.`{field}`) == lower_search_term" for field in search_fields]
        + [
            f"identifier_term IN (FOR s IN doc.`{IDENTIFIER_FIELD}` || [] "
            "RETURN LOWER(s))"
        ]
    )

    query_end = """
                    LET is_exact_match = ({exact_match_conditions})
                    SORT is_exact_match DESC, BM25(doc) DESC
                    LIMIT @limit
                    RETURN MERGE({{"_id": doc._id}}, KEEP(doc, @projection_fields))
            )

            RETURN sortedDocs
            """.format(exact_match_conditions=exact_match_conditions)
    # A request may name only `_search`; the identifier clause then stands alone.
    per_field_clauses = (
        levenshtein_string_0 + levenshtein_string_1 + n_gram_string
        if search_fields
        else ""
    )
    query = query_beginning + per_field_clauses + query_end

    # Project only the fields the dropdown needs: _id (always), the searched
    # fields, and any label or badge fields the row reads. _id is merged in
    # explicitly because KEEP does not retain system attributes.
    projection_fields = sorted(set(search_fields) | set(LABEL_FIELDS) | set(BADGE_FIELDS))

    bind_vars = {
        "search_term": search_term,
        "limit": SEARCH_RESULT_LIMIT,
        "projection_fields": projection_fields,
    }

    try:
        cursor = db_connection.aql.execute(query, bind_vars=bind_vars)
        results = cursor.next()

    except StopIteration:
        logger.debug("Search query returned no results for term: %s", search_term)
        results = []
    except Exception as e:
        logger.exception("Error executing search query")
        raise SearchServiceError(unavailable=isinstance(e, UNAVAILABLE_ERRORS)) from e

    return results


def get_all_documents():
    """
    Get all documents from all document collections.

    Returns:
        list: Flattened list of all documents.
    """
    collections = get_collections("document")

    union_queries = []
    for collection in collections:
        union_queries.append(
            f"""
            FOR doc IN {collection}
                RETURN doc
        """
        )

    final_query = "RETURN UNION(" + ", ".join(union_queries) + ")"

    try:
        cursor = db_ontologies.aql.execute(final_query)
        results = list(cursor)
    except Exception:
        logger.exception("Error executing get_all query")
        results = []

    flat_results = list(chain.from_iterable(results))

    return flat_results


def run_aql_query(query):
    """
    Execute an arbitrary AQL query.

    Args:
        query (str): The AQL query to execute.

    Returns:
        list: Query results.
    """
    try:
        cursor = db_ontologies.aql.execute(query)
        results = list(cursor)[0]
    except Exception:
        logger.exception("Error executing AQL query")
        results = []

    return results
