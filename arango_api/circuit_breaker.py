"""
A small, thread-safe circuit breaker for ArangoDB requests.

Paired with the per-request connect/read timeout in :mod:`arango_api.db`, this
stops the backend from repeatedly parking gunicorn threads on a DB that is known
to be down. Once enough consecutive requests fail (timeout, connection refused,
or 5xx), the breaker "opens" and subsequent requests fail fast with
:class:`CircuitBreakerOpen` instead of waiting out the full timeout. After a
cooldown the breaker lets a single trial request through ("half-open"); success
closes it again, failure re-opens it.

The breaker is wired in at the HTTP-client layer (see
``arango_api.db.HardenedHTTPClient``) so it covers every DB operation — AQL
queries, collection/document reads, graph traversals — without each service
call site having to opt in.
"""

import logging
import threading
import time

logger = logging.getLogger(__name__)


class CircuitBreakerOpen(Exception):
    """Raised instead of issuing a request while the breaker is open."""


class CircuitBreaker:
    """Consecutive-failure circuit breaker.

    Args:
        failure_threshold (int): Consecutive failures that trip the breaker.
        reset_timeout (float): Seconds to stay open before allowing a trial.
        name (str): Label used in log messages.
    """

    def __init__(self, failure_threshold=5, reset_timeout=15.0, name="arango"):
        self._failure_threshold = max(1, int(failure_threshold))
        self._reset_timeout = float(reset_timeout)
        self._name = name

        self._lock = threading.Lock()
        self._failures = 0
        # Monotonic timestamp the breaker opened, or None while closed.
        self._opened_at = None
        # True while a single trial request is in flight after the cooldown.
        self._half_open = False

    def before_request(self):
        """Gate a request. Raises :class:`CircuitBreakerOpen` if open.

        When the cooldown has elapsed the breaker admits a *single* trial
        request to probe the DB (half-open); concurrent requests keep failing
        fast until that trial resolves via :meth:`record_success` /
        :meth:`record_failure`.
        """
        with self._lock:
            if self._opened_at is None:
                return
            # A trial request is already in flight; keep the rest failing fast.
            if self._half_open:
                raise CircuitBreakerOpen(
                    f"{self._name} circuit half-open; trial request in flight"
                )
            elapsed = time.monotonic() - self._opened_at
            if elapsed < self._reset_timeout:
                raise CircuitBreakerOpen(
                    f"{self._name} circuit open; failing fast "
                    f"({elapsed:.1f}s into {self._reset_timeout:.0f}s cooldown)"
                )
            # Cooldown elapsed: admit one trial request (half-open).
            logger.info("%s circuit half-open; allowing trial request", self._name)
            self._half_open = True

    def record_success(self):
        with self._lock:
            if self._failures or self._opened_at is not None:
                logger.info("%s circuit closed after success", self._name)
            self._failures = 0
            self._opened_at = None
            self._half_open = False

    def record_failure(self):
        with self._lock:
            # A failed trial request re-opens the breaker for another cooldown.
            if self._half_open:
                self._half_open = False
                self._opened_at = time.monotonic()
                logger.warning(
                    "%s circuit re-opened after failed trial request; "
                    "failing fast for %.0fs",
                    self._name,
                    self._reset_timeout,
                )
                return
            self._failures += 1
            if self._failures >= self._failure_threshold and self._opened_at is None:
                self._opened_at = time.monotonic()
                logger.warning(
                    "%s circuit opened after %d consecutive failures; "
                    "failing fast for %.0fs",
                    self._name,
                    self._failures,
                    self._reset_timeout,
                )
