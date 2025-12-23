from pathlib import Path

import environ
from arango import ArangoClient

# Load db info from .env file in project root
env = environ.Env()
environ.Env.read_env(Path(__file__).resolve().parent.parent / ".env")

# Retrieve ArangoDB credentials from the environment
ARANGO_DB_HOST = env("ARANGO_DB_HOST")
ARANGO_DB_NAME_ONTOLOGIES = env("ARANGO_DB_NAME_ONTOLOGIES")
ARANGO_DB_NAME_PHENOTYPES = env("ARANGO_DB_NAME_PHENOTYPES")
ARANGO_DB_USER = env("ARANGO_DB_USER")
ARANGO_DB_PASSWORD = env("ARANGO_DB_PASSWORD")
GRAPH_NAME_ONTOLOGIES = env("GRAPH_NAME_ONTOLOGIES")
GRAPH_NAME_PHENOTYPES = env("GRAPH_NAME_PHENOTYPES")

# Configure the connection
client = ArangoClient(ARANGO_DB_HOST)
db_ontologies = client.db(
    ARANGO_DB_NAME_ONTOLOGIES, username=ARANGO_DB_USER, password=ARANGO_DB_PASSWORD
)
db_phenotypes = client.db(
    ARANGO_DB_NAME_PHENOTYPES, username=ARANGO_DB_USER, password=ARANGO_DB_PASSWORD
)
