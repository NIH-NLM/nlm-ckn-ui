import logging

from arango import ArangoClient
from arango.http import DefaultHTTPClient
from django.conf import settings

from arango_api.circuit_breaker import CircuitBreaker

logger = logging.getLogger(__name__)

# Retrieve ArangoDB credentials from Django settings
ARANGO_DB_HOST = settings.ARANGO_DB_HOST
ARANGO_DB_NAME_ONTOLOGIES = settings.ARANGO_DB_NAME_ONTOLOGIES
ARANGO_DB_NAME_PHENOTYPES = settings.ARANGO_DB_NAME_PHENOTYPES
ARANGO_DB_USER = settings.ARANGO_DB_USER
ARANGO_DB_PASSWORD = settings.ARANGO_DB_PASSWORD
GRAPH_NAME_ONTOLOGIES = settings.GRAPH_NAME_ONTOLOGIES
GRAPH_NAME_PHENOTYPES = settings.GRAPH_NAME_PHENOTYPES

# Hardening knobs (see core/settings.py for defaults).
ARANGO_REQUEST_TIMEOUT = settings.ARANGO_REQUEST_TIMEOUT
ARANGO_RETRY_ATTEMPTS = settings.ARANGO_RETRY_ATTEMPTS
ARANGO_CB_FAILURE_THRESHOLD = settings.ARANGO_CB_FAILURE_THRESHOLD
ARANGO_CB_RESET_TIMEOUT = settings.ARANGO_CB_RESET_TIMEOUT


class HardenedHTTPClient(DefaultHTTPClient):
    """python-arango HTTP client with a bounded timeout and a circuit breaker.

    ``request_timeout`` is applied by the base client as the requests
    connect+read timeout, so a slow query or a dead DB raises promptly instead
    of pinning a gunicorn thread until the worker timeout SIGKILLs it. Keep the
    timeout under the gunicorn worker timeout.

    The circuit breaker then short-circuits subsequent requests once the DB
    looks down, so we stop hammering it (and stop eating one timeout per
    request) until it recovers. Wiring the breaker in at the HTTP-client layer
    means it covers *every* DB operation that flows through the client — AQL
    queries, collection/document reads, graph traversals — without each service
    call site having to opt in.
    """

    def __init__(self, breaker, request_timeout, retry_attempts):
        super().__init__(
            request_timeout=request_timeout,
            retry_attempts=retry_attempts,
        )
        self._breaker = breaker

    def send_request(
        self,
        session,
        method,
        url,
        headers=None,
        params=None,
        data=None,
        auth=None,
    ):
        # Fail fast without touching the socket if the breaker is open.
        self._breaker.before_request()

        try:
            response = super().send_request(
                session, method, url, headers, params, data, auth
            )
        except Exception:
            # Timeouts and connection errors surface here.
            self._breaker.record_failure()
            raise

        # 5xx from a wedged/overloaded DB also counts toward tripping the
        # breaker; 4xx (bad query, missing doc) are legitimate responses.
        if response.status_code >= 500:
            self._breaker.record_failure()
        else:
            self._breaker.record_success()

        return response


# Configure the connection
logger.info(
    "Connecting to ArangoDB at %s (timeout=%ss, breaker=%d failures/%ss)",
    ARANGO_DB_HOST,
    ARANGO_REQUEST_TIMEOUT,
    ARANGO_CB_FAILURE_THRESHOLD,
    ARANGO_CB_RESET_TIMEOUT,
)

_breaker = CircuitBreaker(
    failure_threshold=ARANGO_CB_FAILURE_THRESHOLD,
    reset_timeout=ARANGO_CB_RESET_TIMEOUT,
    name="arango",
)

client = ArangoClient(
    ARANGO_DB_HOST,
    http_client=HardenedHTTPClient(
        breaker=_breaker,
        request_timeout=ARANGO_REQUEST_TIMEOUT,
        retry_attempts=ARANGO_RETRY_ATTEMPTS,
    ),
)
db_ontologies = client.db(
    ARANGO_DB_NAME_ONTOLOGIES, username=ARANGO_DB_USER, password=ARANGO_DB_PASSWORD
)
db_phenotypes = client.db(
    ARANGO_DB_NAME_PHENOTYPES, username=ARANGO_DB_USER, password=ARANGO_DB_PASSWORD
)
logger.info(
    "Connected to databases: %s, %s",
    ARANGO_DB_NAME_ONTOLOGIES,
    ARANGO_DB_NAME_PHENOTYPES,
)
