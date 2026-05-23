"""
Base service module with shared database utilities.
"""

import logging

from arango_api.db import (
    db_ontologies,
    db_phenotypes,
    GRAPH_NAME_ONTOLOGIES,
    GRAPH_NAME_PHENOTYPES,
)

logger = logging.getLogger(__name__)


def get_db_and_graph(graph_name):
    """
    Returns the appropriate database connection and graph name based on graph type.

    Args:
        graph_name (str): The graph type, either "phenotypes" or "ontologies".

    Returns:
        tuple: A tuple of (db_connection, graph_name_constant).
    """
    if graph_name and graph_name.lower() == "phenotypes":
        return db_phenotypes, GRAPH_NAME_PHENOTYPES
    return db_ontologies, GRAPH_NAME_ONTOLOGIES
