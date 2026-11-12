"""
Service for search operations.
"""

import logging
import unicodedata
from itertools import chain

import requests

from arango_api.aql_safety import escape_like
from arango_api.circuit_breaker import CircuitBreakerOpen
from arango_api.db import db_ontologies
from arango_api.search_tiers import (
    TIERS,
    load_search_tiers,
    tier_of,
    tiered_field_names,
)
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
IDENTIFIER_BOOST = 5000.0

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


# Tiers that can explain a match, strongest first. The text tier (definitions,
# species, ...) and untiered fields are never a reason.
MATCH_REASON_TIERS = ("label", "synonym", "identifier")


def _normalize(text):
    # Like the norm-lower analyzer: case and accents ignored ("Café" == "cafe").
    decomposed = unicodedata.normalize("NFKD", " ".join(text.split()).casefold())
    return "".join(c for c in decomposed if not unicodedata.combining(c))


def match_reason(doc, search_term, searched_fields):
    """Say why a search result matched: {"tier", "field", "value"}, or None.

    `tier` is the search tier of the matching field in the document's
    collection (label, synonym or identifier), `field` its name and `value`
    the stored text, original case, that matched (the element, for a list).
    Only `searched_fields` count, not fields projected just for display.
    Matching ignores case and extra whitespace. A whole-value match beats a
    partial one, and a stronger tier beats a weaker one. None means no
    label, synonym or identifier field matched as typed: a match on a
    definition, or a typo-tolerant match.
    """
    if doc.get("_search_match"):
        return {"tier": "identifier", "field": "_search", "value": doc["_search_match"]}
    term = _normalize(search_term)
    collection = doc["_id"].split("/")[0]
    candidates = []
    for tier in MATCH_REASON_TIERS:
        for field in sorted(set(doc) & set(searched_fields)):
            if tier_of(collection, field) != tier:
                continue
            values = doc[field] if isinstance(doc[field], list) else [doc[field]]
            candidates += [
                (tier, field, value) for value in values if isinstance(value, str)
            ]
    for matches in (
        lambda text: text == term,
        lambda text: term in text,
    ):
        for tier, field, value in candidates:
            if matches(_normalize(value)):
                return {"tier": tier, "field": field, "value": value}
    return None


# Length gates. A term shorter than the n-gram analyzer's ngramSize (3) is
# too short to match as a prefix; one character longer is the shortest term
# worth a typo-tolerant or substring match.
PREFIX_MIN_LENGTH = 3
FUZZY_MIN_LENGTH = PREFIX_MIN_LENGTH + 1

# Boosts. A whole-value match on an identifier, label or synonym puts its
# node first; a label prefix beats a fuzzy match; text fields barely count.
WHOLE_VALUE_BOOST = 4000.0
LABEL_EXACT_TOKEN_BOOST = 1000.0
LABEL_FUZZY_BOOST = 50.0
LABEL_PREFIX_BOOST = 300.0
SYNONYM_EXACT_TOKEN_BOOST = 200.0
SYNONYM_FUZZY_BOOST = 15.0
IDENTIFIER_SUBSTRING_BOOST = 20.0
TEXT_WORD_BOOST = 2.0


def _fields_by_tier(fields):
    """Group searched field names by tier; a tierless name is left out."""
    tier_by_name = {
        name: tier
        for (_, name), tier in load_search_tiers().field_tiers.items()
        if tier
    }
    by_tier = {tier: [] for tier in TIERS}
    for field in fields:
        if field in tier_by_name:
            by_tier[tier_by_name[field]].append(field)
    return by_tier


def _any(fields, template):
    """One clause per field from `template` ({f} is the field), joined by OR."""
    return " OR ".join(template.format(f=f) for f in fields)


def _search_clauses(by_tier, term_length):
    """The SEARCH clauses for one term, each scored by BM25 and its boost."""
    label, synonym = by_tier["label"], by_tier["synonym"]
    identifier, text = by_tier["identifier"], by_tier["text"]
    clauses = [
        f'BOOST(ANALYZER(doc.`{IDENTIFIER_FIELD}` == norm_term, "norm-lower"), '
        f"{IDENTIFIER_BOOST})"
    ]
    for fields, exact, fuzzy in (
        (label, LABEL_EXACT_TOKEN_BOOST, LABEL_FUZZY_BOOST),
        (synonym, SYNONYM_EXACT_TOKEN_BOOST, SYNONYM_FUZZY_BOOST),
    ):
        if not fields:
            continue
        distances = [(0, exact)] + (
            [(1, fuzzy)] if term_length >= FUZZY_MIN_LENGTH else []
        )
        for distance, boost in distances:
            match = _any(
                fields,
                f"BOOST(LEVENSHTEIN_MATCH(doc.`{{f}}`, lower_term, {distance}), {boost})",
            )
            clauses.append(f'ANALYZER({match}, "text_en_no_stem")')
    if label and term_length >= PREFIX_MIN_LENGTH:
        prefix = _any(
            label,
            'doc.`{f}` LIKE CONCAT(like_term, "%") '
            'OR doc.`{f}` LIKE CONCAT("% ", like_term, "%")',
        )
        clauses.append(
            f'BOOST(ANALYZER({prefix}, "wildcard-lower"), {LABEL_PREFIX_BOOST})'
        )
    if identifier and term_length >= FUZZY_MIN_LENGTH:
        substring = _any(identifier, 'doc.`{f}` LIKE CONCAT("%", like_term, "%")')
        clauses.append(
            f'BOOST(ANALYZER({substring}, "wildcard-lower"), '
            f"{IDENTIFIER_SUBSTRING_BOOST})"
        )
    if text:
        word = _any(text, "doc.`{f}` == lower_term")
        clauses.append(f'BOOST(ANALYZER({word}, "text_en"), {TEXT_WORD_BOOST})')
    whole = label + synonym + identifier
    if whole:
        exact = _any(whole, "doc.`{f}` == norm_term")
        clauses.append(f'BOOST(ANALYZER({exact}, "norm-lower"), {WHOLE_VALUE_BOOST})')
    # Kept from the previous query, unboosted: today it is the only clause
    # that finds a synonym inside a comma-joined synonym string ("KL-6",
    # "Insulin, human"). Remove it once the ETL stores synonyms as lists
    # (Springbok-LLC/nlm-ckn-etl#113); it is most of the query's cost.
    every = label + synonym + identifier + text
    if every:
        ngram = _any(every, 'doc.`{f}` LIKE CONCAT("%", @raw_like_term, "%")')
        clauses.append(f'ANALYZER({ngram}, "n-gram")')
    return clauses


def search_by_term(search_term, search_fields, graph):
    """
    Search for documents matching a search term across specified fields.

    Each searched field contributes the clauses of its search tier (label,
    synonym, identifier or text, from the collection maps), and results are
    ranked by BM25 alone, so the boosts decide the order: a whole-value match
    first, then label prefixes, then typo-tolerant and substring matches.

    Args:
        search_term (str): The term to search for.
        search_fields (list): List of field names to search within.
        graph (str): The graph type ("ontologies" or "phenotypes").

    Returns:
        list: Matching documents, best first (empty when nothing matches).
            Each carries `_match`, from match_reason().

    Raises:
        SearchServiceError: If the query could not be executed.
    """
    db_connection, _ = get_db_and_graph(graph)
    requested = [f for f in search_fields if f != IDENTIFIER_FIELD]
    # Only tiered fields are linked in the view with the analyzers the clauses
    # use; an untiered field (e.g. year) is returned but not searched.
    tiered = tiered_field_names()
    search_fields = [f for f in requested if f in tiered]
    term = " ".join(search_term.split())
    clauses = _search_clauses(_fields_by_tier(search_fields), len(term))

    # norm-lower also strips accents, so whole-value and LIKE terms are
    # normalized with that analyzer, not LOWER(); it leaves the LIKE escapes
    # alone. The raw term feeds only the n-gram clause, whose analyzer is
    # case-sensitive.
    query = f"""
            LET lower_term = LOWER(@search_term)
            LET norm_term = FIRST(TOKENS(@search_term, "norm-lower"))
            LET like_term = FIRST(TOKENS(@raw_like_term, "norm-lower"))
            FOR doc IN indexed
                SEARCH {" OR ".join(clauses)}
                SORT BM25(doc) DESC
                LIMIT @limit
                RETURN MERGE({{"_id": doc._id}},
                    {{"_search_match": NTH(doc.`{IDENTIFIER_FIELD}`, POSITION(
                        doc.`{IDENTIFIER_FIELD}`[* RETURN FIRST(TOKENS(CURRENT, "norm-lower"))],
                        norm_term, true))}},
                    KEEP(doc, @projection_fields))
            """

    # Project only the fields the dropdown needs: _id (always), the requested
    # fields (searched or not), and any label or badge fields the row reads.
    # _id is merged in explicitly because KEEP does not retain system attributes.
    projection_fields = sorted(set(requested) | set(LABEL_FIELDS) | set(BADGE_FIELDS))

    bind_vars = {
        "search_term": term,
        "limit": SEARCH_RESULT_LIMIT,
        "projection_fields": projection_fields,
        "raw_like_term": escape_like(term),
    }

    try:
        results = list(db_connection.aql.execute(query, bind_vars=bind_vars))
    except Exception as e:
        logger.exception("Error executing search query")
        raise SearchServiceError(unavailable=isinstance(e, UNAVAILABLE_ERRORS)) from e

    for row in results:
        row["_match"] = match_reason(row, search_term, search_fields)
        row.pop("_search_match", None)
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
