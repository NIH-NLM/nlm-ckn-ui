from arango import ArangoClient
from django.conf import settings

# Retrieve ArangoDB credentials from Django settings
ARANGO_DB_HOST = settings.ARANGO_DB_HOST
ARANGO_DB_NAME_ONTOLOGIES = settings.ARANGO_DB_NAME_ONTOLOGIES
ARANGO_DB_NAME_PHENOTYPES = settings.ARANGO_DB_NAME_PHENOTYPES
ARANGO_DB_USER = settings.ARANGO_DB_USER
ARANGO_DB_PASSWORD = settings.ARANGO_DB_PASSWORD
GRAPH_NAME_ONTOLOGIES = settings.GRAPH_NAME_ONTOLOGIES
GRAPH_NAME_PHENOTYPES = settings.GRAPH_NAME_PHENOTYPES

# Configure the connection
client = ArangoClient(ARANGO_DB_HOST)
db_ontologies = client.db(
    ARANGO_DB_NAME_ONTOLOGIES, username=ARANGO_DB_USER, password=ARANGO_DB_PASSWORD
)
db_phenotypes = client.db(
    ARANGO_DB_NAME_PHENOTYPES, username=ARANGO_DB_USER, password=ARANGO_DB_PASSWORD
)
