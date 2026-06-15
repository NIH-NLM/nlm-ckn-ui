"""
Unit tests for the ArangoDB circuit breaker.

The breaker is pure Python with no DB dependency, so these run without a live
ArangoDB (no ``integration`` tag). Cooldown timing is driven by patching
``time.monotonic`` rather than real sleeps, keeping the tests fast and
deterministic.
"""

import threading
from unittest import mock

from django.test import SimpleTestCase

from arango_api.circuit_breaker import CircuitBreaker, CircuitBreakerOpen


class CircuitBreakerTestCase(SimpleTestCase):
    def _breaker(self, **kwargs):
        kwargs.setdefault("failure_threshold", 3)
        kwargs.setdefault("reset_timeout", 10.0)
        kwargs.setdefault("name", "test")
        return CircuitBreaker(**kwargs)

    def test_closed_breaker_allows_requests(self):
        breaker = self._breaker()
        # Should not raise.
        breaker.before_request()
        breaker.before_request()

    def test_failures_below_threshold_stay_closed(self):
        breaker = self._breaker(failure_threshold=3)
        breaker.record_failure()
        breaker.record_failure()
        # Still under the threshold (2 < 3): requests continue to pass.
        breaker.before_request()

    def test_reaching_threshold_opens_and_fails_fast(self):
        breaker = self._breaker(failure_threshold=3)
        breaker.record_failure()
        breaker.record_failure()
        breaker.record_failure()
        with self.assertRaises(CircuitBreakerOpen):
            breaker.before_request()

    def test_success_resets_failure_count(self):
        breaker = self._breaker(failure_threshold=3)
        breaker.record_failure()
        breaker.record_failure()
        breaker.record_success()
        # The two earlier failures were cleared, so three more are needed to trip.
        breaker.record_failure()
        breaker.record_failure()
        breaker.before_request()  # 2 < 3, still closed
        breaker.record_failure()
        with self.assertRaises(CircuitBreakerOpen):
            breaker.before_request()

    def test_failure_threshold_is_clamped_to_at_least_one(self):
        breaker = self._breaker(failure_threshold=0)
        breaker.record_failure()
        with self.assertRaises(CircuitBreakerOpen):
            breaker.before_request()

    @mock.patch("arango_api.circuit_breaker.time.monotonic")
    def test_open_breaker_fails_fast_during_cooldown(self, monotonic):
        breaker = self._breaker(failure_threshold=1, reset_timeout=10.0)
        monotonic.return_value = 100.0
        breaker.record_failure()  # opens at t=100

        # Part-way through the cooldown window: still open.
        monotonic.return_value = 105.0
        with self.assertRaises(CircuitBreakerOpen):
            breaker.before_request()

    @mock.patch("arango_api.circuit_breaker.time.monotonic")
    def test_half_open_allows_a_trial_after_cooldown(self, monotonic):
        breaker = self._breaker(failure_threshold=1, reset_timeout=10.0)
        monotonic.return_value = 100.0
        breaker.record_failure()  # opens at t=100

        # Cooldown elapsed: a single trial request is allowed through.
        monotonic.return_value = 111.0
        breaker.before_request()  # does not raise

    @mock.patch("arango_api.circuit_breaker.time.monotonic")
    def test_half_open_trial_success_closes_breaker(self, monotonic):
        breaker = self._breaker(failure_threshold=1, reset_timeout=10.0)
        monotonic.return_value = 100.0
        breaker.record_failure()

        monotonic.return_value = 111.0
        breaker.before_request()  # half-open trial
        breaker.record_success()  # trial succeeded -> fully closed

        # Breaker is closed: it now takes a fresh failure to re-open.
        breaker.before_request()
        breaker.record_failure()
        with self.assertRaises(CircuitBreakerOpen):
            breaker.before_request()

    @mock.patch("arango_api.circuit_breaker.time.monotonic")
    def test_half_open_trial_failure_reopens_breaker(self, monotonic):
        breaker = self._breaker(failure_threshold=1, reset_timeout=10.0)
        monotonic.return_value = 100.0
        breaker.record_failure()

        monotonic.return_value = 111.0
        breaker.before_request()  # half-open trial allowed
        breaker.record_failure()  # trial failed -> re-open at t=111

        # Immediately after the failed trial we are back to failing fast.
        monotonic.return_value = 112.0
        with self.assertRaises(CircuitBreakerOpen):
            breaker.before_request()

        # And the cooldown is measured from the re-open, not the original open.
        monotonic.return_value = 122.0
        breaker.before_request()  # 11s after re-open -> half-open again

    @mock.patch("arango_api.circuit_breaker.time.monotonic")
    def test_half_open_admits_only_a_single_trial_request(self, monotonic):
        # After the cooldown the breaker should let exactly one request probe the
        # DB; concurrent callers keep failing fast until that trial resolves.
        breaker = self._breaker(failure_threshold=1, reset_timeout=10.0)
        monotonic.return_value = 100.0
        breaker.record_failure()  # opens at t=100

        monotonic.return_value = 111.0
        breaker.before_request()  # first caller: trial admitted

        # Second concurrent caller while the trial is in flight: still fails fast.
        with self.assertRaises(CircuitBreakerOpen):
            breaker.before_request()

        # Once the trial reports success the breaker is fully closed again.
        breaker.record_success()
        breaker.before_request()

    def test_open_exception_is_not_a_requests_connection_error(self):
        # python-arango's send_request retry loop only catches requests'
        # ConnectionError; CircuitBreakerOpen must not subclass it, or an open
        # breaker would be retried (and amplified) against retry_attempts.
        from requests import ConnectionError as RequestsConnectionError

        self.assertFalse(issubclass(CircuitBreakerOpen, RequestsConnectionError))

    def test_concurrent_failures_open_breaker_once(self):
        # Exercise the lock under contention: many threads recording failures
        # and probing the breaker must not raise unexpectedly or corrupt state.
        breaker = self._breaker(failure_threshold=50, reset_timeout=10.0)

        def hammer():
            for _ in range(20):
                breaker.record_failure()

        threads = [threading.Thread(target=hammer) for _ in range(10)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()

        # 200 failures recorded, well past the threshold of 50: breaker is open.
        with self.assertRaises(CircuitBreakerOpen):
            breaker.before_request()
        # A success still fully closes it regardless of how it was opened.
        breaker.record_success()
        breaker.before_request()
