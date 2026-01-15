"""
Seed script for creating test data in ArangoDB.

This script creates a minimal, controlled dataset for integration tests.
Because we control exactly what data exists, tests can make precise assertions.

IMPORTANT: This script creates TEST databases with a "-Test" suffix to avoid
overwriting development data. Tests should connect to port 8530 (not 8529)
to use a separate ArangoDB instance.

Usage:
    # Start a test ArangoDB instance on port 8530:
    docker run -d --name arangodb-test -p 8530:8529 -e ARANGO_ROOT_PASSWORD=test arangodb

    # Seed the test databases:
    ARANGO_DB_HOST=http://127.0.0.1:8530 ARANGO_DB_PASSWORD=test python -m arango_api.tests.seed_test_db

Environment variables:
    - ARANGO_TEST_HOST: ArangoDB host URL for tests (default: http://127.0.0.1:8530)
    - ARANGO_DB_USER: Database user (default: root)
    - ARANGO_TEST_PASSWORD: Database password for tests (default: test)
"""
import os
import sys

from arango import ArangoClient
from arango.exceptions import DatabaseCreateError, CollectionCreateError, GraphCreateError


# Configuration - use port 8530 by default to avoid conflicts with dev instance
ARANGO_HOST = os.environ.get("ARANGO_TEST_HOST", "http://127.0.0.1:8530")
ARANGO_USER = os.environ.get("ARANGO_DB_USER", "root")
ARANGO_PASSWORD = os.environ.get("ARANGO_TEST_PASSWORD", "test")

# Test database names - use "-Test" suffix to avoid overwriting dev data
TEST_DB_ONTOLOGIES = "Cell-KN-Ontologies-Test"
TEST_DB_PHENOTYPES = "Cell-KN-Phenotypes-Test"
GRAPH_NAME_ONTOLOGIES = "ontologies"
GRAPH_NAME_PHENOTYPES = "phenotypes"


# =============================================================================
# Test Data Definitions
# =============================================================================

# Document collections and their test documents
DOCUMENT_COLLECTIONS = {
    "CL": [
        {"_key": "0000000", "label": "cell", "definition": "A material entity of anatomical origin."},
        {"_key": "0000061", "label": "crypt cell of Lieberkuhn", "definition": "An epithelial cell of the intestinal crypt."},
        {"_key": "0000062", "label": "osteoblast", "definition": "A cell that secretes an extracellular matrix."},
        {"_key": "0000151", "label": "secretory cell", "definition": "A cell that specializes in secretion."},
        {"_key": "0002145", "label": "ciliated columnar cell of tracheobronchial tree", "definition": "A ciliated cell."},
        {"_key": "0007002", "label": "intestinal epithelial cell", "definition": "An epithelial cell of the intestine."},
    ],
    "GO": [
        {"_key": "0008150", "label": "biological_process", "definition": "A biological process."},
        {"_key": "0003674", "label": "molecular_function", "definition": "A molecular function."},
    ],
    "UBERON": [
        {"_key": "0000061", "label": "anatomical structure", "definition": "Material anatomical entity."},
        {"_key": "0000465", "label": "material anatomical entity", "definition": "Anatomical entity that has mass."},
    ],
    "NCBITaxon": [
        {"_key": "9606", "label": "Homo sapiens", "definition": "Human"},
    ],
    "CHEBI": [
        {"_key": "0000001", "label": "chemical entity", "definition": "A chemical entity."},
    ],
    "PATO": [
        {"_key": "0000001", "label": "quality", "definition": "A quality."},
    ],
    "PR": [
        {"_key": "0000001", "label": "protein", "definition": "A protein."},
    ],
    # Application-specific collections
    "anatomic_structure_cls": [
        {"_key": "test1", "label": "test anatomic structure"},
    ],
    "biomarker_combination_cls": [
        {"_key": "test1", "label": "test biomarker combination class"},
    ],
    "biomarker_combination_ind": [
        {"_key": "test1", "label": "test biomarker combination individual"},
    ],
    "cell_set_ind": [
        {"_key": "test1", "label": "test cell set"},
    ],
    "disease_cls": [
        {"_key": "test1", "label": "test disease"},
    ],
    "drug_product_cls": [
        {"_key": "test1", "label": "test drug product"},
    ],
    "gene_cls": [
        {"_key": "test1", "label": "test gene"},
    ],
    "publication_cls": [
        {"_key": "test1", "label": "test publication class"},
    ],
    "publication_ind": [
        {"_key": "Sikkema-et-al-2023-Nat-Med", "label": "HLCA"},
        {"_key": "CellRef-2024", "label": "CellRef"},
    ],
    "transcript_cls": [
        {"_key": "test1", "label": "test transcript class"},
    ],
    "transcript_ind": [
        {"_key": "test1", "label": "test transcript individual"},
    ],
}

# Edge collections and their test edges
# Format: {collection_name: [(from_collection, from_key, to_collection, to_key, label), ...]}
EDGE_COLLECTIONS = {
    "CL-CL": [
        ("CL", "0000061", "CL", "0000151", "subClassOf"),
        ("CL", "0000061", "CL", "0000062", "subClassOf"),
        ("CL", "0000061", "CL", "0007002", "subClassOf"),
        ("CL", "0000062", "CL", "0000000", "subClassOf"),
        ("CL", "0000151", "CL", "0000000", "subClassOf"),
        ("CL", "0007002", "CL", "0000000", "subClassOf"),
    ],
    "CL-GO": [
        ("CL", "0000061", "GO", "0008150", "participates_in"),
    ],
    "CL-UBERON": [
        ("CL", "0000061", "UBERON", "0000061", "part_of"),
    ],
}

# Note: The sunburst root is constructed programmatically by sunburst_service.py
# using CL/0000000 as the initial root. No database document is needed.
# The service builds the tree by traversing INBOUND subClassOf edges.


# =============================================================================
# Seeding Functions
# =============================================================================

def create_database(sys_db, db_name):
    """Create a database if it doesn't exist."""
    try:
        sys_db.create_database(db_name)
        print(f"  Created database: {db_name}")
    except DatabaseCreateError:
        print(f"  Database already exists: {db_name}")


def create_collection(db, name, edge=False):
    """Create a collection if it doesn't exist."""
    try:
        db.create_collection(name, edge=edge)
        print(f"    Created {'edge ' if edge else ''}collection: {name}")
    except CollectionCreateError:
        print(f"    Collection already exists: {name}")
        # Truncate existing collection for clean state
        db.collection(name).truncate()
        print(f"    Truncated collection: {name}")


def seed_documents(db):
    """Seed document collections with test data."""
    print("  Seeding document collections...")
    for collection_name, documents in DOCUMENT_COLLECTIONS.items():
        create_collection(db, collection_name)
        collection = db.collection(collection_name)
        for doc in documents:
            collection.insert(doc, overwrite=True)
        print(f"    Inserted {len(documents)} documents into {collection_name}")


def seed_edges(db):
    """Seed edge collections with test data."""
    print("  Seeding edge collections...")
    for collection_name, edges in EDGE_COLLECTIONS.items():
        create_collection(db, collection_name, edge=True)
        collection = db.collection(collection_name)
        for from_coll, from_key, to_coll, to_key, label in edges:
            edge_key = f"{from_key}-{to_key}"
            edge_doc = {
                "_key": edge_key,
                "_from": f"{from_coll}/{from_key}",
                "_to": f"{to_coll}/{to_key}",
                "label": label,
            }
            collection.insert(edge_doc, overwrite=True)
        print(f"    Inserted {len(edges)} edges into {collection_name}")


def create_graph(db, graph_name, edge_definitions):
    """Create a graph, deleting any existing one first to ensure correct edge definitions."""
    if db.has_graph(graph_name):
        db.delete_graph(graph_name, drop_collections=False)
        print(f"  Deleted existing graph: {graph_name}")
    db.create_graph(graph_name, edge_definitions=edge_definitions)
    print(f"  Created graph: {graph_name}")


def seed_ontologies_db(client):
    """Seed the ontologies database."""
    print("\nSeeding ontologies database...")

    sys_db = client.db("_system", username=ARANGO_USER, password=ARANGO_PASSWORD)
    create_database(sys_db, TEST_DB_ONTOLOGIES)

    db = client.db(TEST_DB_ONTOLOGIES, username=ARANGO_USER, password=ARANGO_PASSWORD)

    seed_documents(db)
    seed_edges(db)

    # Create the ontologies graph
    edge_definitions = [
        {
            "edge_collection": "CL-CL",
            "from_vertex_collections": ["CL"],
            "to_vertex_collections": ["CL"],
        },
        {
            "edge_collection": "CL-GO",
            "from_vertex_collections": ["CL"],
            "to_vertex_collections": ["GO"],
        },
        {
            "edge_collection": "CL-UBERON",
            "from_vertex_collections": ["CL"],
            "to_vertex_collections": ["UBERON"],
        },
    ]
    create_graph(db, GRAPH_NAME_ONTOLOGIES, edge_definitions)


def seed_phenotypes_db(client):
    """Seed the phenotypes database with test data for sunburst visualization.

    The phenotypes sunburst expects this hierarchy:
    NCBITaxon/9606 -> UBERON (lung/retina/brain) -> CL -> GS -> MONDO or PR -> CHEMBL

    We seed a minimal path through this structure for testing.
    """
    print("\nSeeding phenotypes database...")

    sys_db = client.db("_system", username=ARANGO_USER, password=ARANGO_PASSWORD)
    create_database(sys_db, TEST_DB_PHENOTYPES)

    db = client.db(TEST_DB_PHENOTYPES, username=ARANGO_USER, password=ARANGO_PASSWORD)

    # Create document collections
    collections = ["NCBITaxon", "UBERON", "CL", "GS", "MONDO", "PR", "CHEMBL"]
    for coll in collections:
        create_collection(db, coll)

    # Insert test documents
    # NCBITaxon - root of the phenotypes tree
    db.collection("NCBITaxon").insert(
        {"_key": "9606", "label": "Homo sapiens"},
        overwrite=True
    )
    print("    Inserted 1 document into NCBITaxon")

    # UBERON - the sunburst expects specific terms (lung, retina, brain)
    uberon_docs = [
        {"_key": "0002048", "label": "lung"},
        {"_key": "0000966", "label": "retina"},
        {"_key": "0000955", "label": "brain"},
    ]
    for doc in uberon_docs:
        db.collection("UBERON").insert(doc, overwrite=True)
    print(f"    Inserted {len(uberon_docs)} documents into UBERON")

    # CL - cell type linked to UBERON
    db.collection("CL").insert(
        {"_key": "0000066", "label": "epithelial cell"},
        overwrite=True
    )
    print("    Inserted 1 document into CL")

    # GS - gene set linked to CL
    db.collection("GS").insert(
        {"_key": "test_gs_1", "label": "Test Gene Set"},
        overwrite=True
    )
    print("    Inserted 1 document into GS")

    # MONDO - disease linked to GS
    db.collection("MONDO").insert(
        {"_key": "0000001", "label": "disease or disorder"},
        overwrite=True
    )
    print("    Inserted 1 document into MONDO")

    # Create edge collections with the exact names the sunburst service expects
    edge_collections = [
        "UBERON-NCBITaxon",  # NCBITaxon -> UBERON (INBOUND from NCBITaxon perspective)
        "UBERON-CL",         # UBERON -> CL
        "CL-UBERON",         # CL -> UBERON (alternate direction)
        "CL-GS",             # CL -> GS
        "GS-MONDO",          # GS -> MONDO
        "GS-PR",             # GS -> PR
        "CHEMBL-PR",         # PR -> CHEMBL
    ]
    for edge_coll in edge_collections:
        create_collection(db, edge_coll, edge=True)

    # Insert edges to create the path: NCBITaxon -> UBERON -> CL -> GS -> MONDO
    # UBERON-NCBITaxon: links UBERON to NCBITaxon (traversed INBOUND from NCBITaxon)
    db.collection("UBERON-NCBITaxon").insert(
        {"_key": "0002048-9606", "_from": "UBERON/0002048", "_to": "NCBITaxon/9606", "label": "in_taxon"},
        overwrite=True
    )
    print("    Inserted 1 edge into UBERON-NCBITaxon")

    # UBERON-CL: links CL to UBERON (traversed INBOUND from UBERON)
    db.collection("UBERON-CL").insert(
        {"_key": "0000066-0002048", "_from": "CL/0000066", "_to": "UBERON/0002048", "label": "part_of"},
        overwrite=True
    )
    print("    Inserted 1 edge into UBERON-CL")

    # CL-GS: links CL to GS (traversed OUTBOUND from CL)
    db.collection("CL-GS").insert(
        {"_key": "0000066-test_gs_1", "_from": "CL/0000066", "_to": "GS/test_gs_1", "label": "has_gene_set"},
        overwrite=True
    )
    print("    Inserted 1 edge into CL-GS")

    # GS-MONDO: links GS to MONDO (traversed OUTBOUND from GS)
    db.collection("GS-MONDO").insert(
        {"_key": "test_gs_1-0000001", "_from": "GS/test_gs_1", "_to": "MONDO/0000001", "label": "associated_with"},
        overwrite=True
    )
    print("    Inserted 1 edge into GS-MONDO")

    # Create the phenotypes graph with all edge definitions
    edge_definitions = [
        {"edge_collection": "UBERON-NCBITaxon", "from_vertex_collections": ["UBERON"], "to_vertex_collections": ["NCBITaxon"]},
        {"edge_collection": "UBERON-CL", "from_vertex_collections": ["CL"], "to_vertex_collections": ["UBERON"]},
        {"edge_collection": "CL-UBERON", "from_vertex_collections": ["CL"], "to_vertex_collections": ["UBERON"]},
        {"edge_collection": "CL-GS", "from_vertex_collections": ["CL"], "to_vertex_collections": ["GS"]},
        {"edge_collection": "GS-MONDO", "from_vertex_collections": ["GS"], "to_vertex_collections": ["MONDO"]},
        {"edge_collection": "GS-PR", "from_vertex_collections": ["GS"], "to_vertex_collections": ["PR"]},
        {"edge_collection": "CHEMBL-PR", "from_vertex_collections": ["CHEMBL"], "to_vertex_collections": ["PR"]},
    ]
    create_graph(db, GRAPH_NAME_PHENOTYPES, edge_definitions)


def seed_test_databases(host=None, user=None, password=None, verbose=True):
    """Seed test databases with controlled test data.

    This function can be called from test setup or run directly.

    Args:
        host: ArangoDB host URL (defaults to ARANGO_DB_HOST env var)
        user: Database user (defaults to ARANGO_DB_USER env var)
        password: Database password (defaults to ARANGO_DB_PASSWORD env var)
        verbose: Whether to print progress messages

    Returns:
        True if seeding succeeded, False otherwise

    Raises:
        Exception: If connection fails and not running as main
    """
    host = host or ARANGO_HOST
    user = user or ARANGO_USER
    password = password if password is not None else ARANGO_PASSWORD

    if verbose:
        print(f"Connecting to ArangoDB at {host}...")

    client = ArangoClient(host)

    try:
        # Test connection
        sys_db = client.db("_system", username=user, password=password)
        sys_db.version()
        if verbose:
            print("Connected successfully!")
    except Exception as e:
        if verbose:
            print(f"Failed to connect to ArangoDB: {e}")
        raise

    seed_ontologies_db(client)
    seed_phenotypes_db(client)

    if verbose:
        print("\nTest database seeding complete!")
        print("\nTest data summary:")
        print(f"  - {sum(len(docs) for docs in DOCUMENT_COLLECTIONS.values())} documents across {len(DOCUMENT_COLLECTIONS)} collections")
        print(f"  - {sum(len(edges) for edges in EDGE_COLLECTIONS.values())} edges across {len(EDGE_COLLECTIONS)} collections")

    return True


def main():
    """Main entry point for seeding test databases."""
    try:
        seed_test_databases(verbose=True)
    except Exception:
        sys.exit(1)


if __name__ == "__main__":
    main()
