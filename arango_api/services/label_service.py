"""
Service for the names a cell set label shows but its document holds only as
references.

A cell set carries its publication as a DOI and its anatomical structure as a
UBERON CURIE. Its label reads the citation and the structure's name instead,
matching the cell set dataset label, so the UI loads both lookups once.
"""

import logging

from arango_api.services.base import get_db_and_graph

logger = logging.getLogger(__name__)

EMPTY = {"publications": {}, "anatomical_structures": {}}

QUERY = """
    LET dois = (FOR cs IN CS COLLECT doi = cs.publication FILTER doi != null RETURN doi)
    LET curies = (
        FOR cs IN CS
            COLLECT curie = cs.anatomical_structure
            FILTER STARTS_WITH(curie, "UBERON:")
            RETURN curie
    )
    RETURN {
        publications: ZIP(
            dois,
            dois[* RETURN DOCUMENT(CONCAT("PUB/", SUBSTITUTE(CURRENT, "/", "-"))).Citation]
        ),
        anatomical_structures: ZIP(
            curies,
            curies[* RETURN DOCUMENT(CONCAT("UBERON/", SUBSTRING(CURRENT, 7))).label]
        )
    }
"""


def get_cell_set_label_lookups():
    """
    Map each cell set DOI to its publication's citation, and each anatomical
    structure CURIE to its UBERON label. A reference with no matching document
    maps to null.

    Returns:
        dict: {"publications": {doi: citation}, "anatomical_structures": {curie: label}},
        or empty maps when the phenotypes database lacks the collections.
    """
    db, _ = get_db_and_graph("phenotypes")
    if not all(db.has_collection(c) for c in ("CS", "PUB", "UBERON")):
        return EMPTY
    try:
        return next(db.aql.execute(QUERY))
    except Exception:
        logger.exception("Error building cell set label lookups")
        return EMPTY
