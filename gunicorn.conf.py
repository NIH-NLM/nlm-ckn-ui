# Gunicorn configuration for the backend API.
#
# Rationale: the previous bare invocation ran a single sync worker, so one
# request blocked on a slow/unreachable ArangoDB would stall the whole
# process -- including the lightweight ALB health check at /health/ -- which
# made the ECS task flap and surfaced as 504s to the client. Threaded workers
# let the health check (and other requests) be served while a thread is parked
# on a blocking ArangoDB socket. Values are env-tunable so we don't need an
# image rebuild to adjust them.
#
# NOTE: this is necessary but not sufficient. Without a connect/read timeout on
# the ArangoDB client, threads still eventually exhaust under a dead DB -- this
# just keeps /health/ alive far longer and prevents needless task cycling.

import os


def _env_int(name, default, minimum, maximum=None):
    """Parse an int env var with a default and bounds; fail fast on bad input.

    Raises SystemExit (rather than a bare ValueError) so a malformed or
    out-of-range value surfaces a clear message at gunicorn startup instead of
    an opaque traceback or undefined behavior (e.g. workers=0).
    """
    raw = os.getenv(name)
    if raw is None or raw == "":
        return default
    try:
        value = int(raw)
    except ValueError:
        raise SystemExit(f"gunicorn.conf.py: {name}={raw!r} is not an integer")
    if value < minimum or (maximum is not None and value > maximum):
        bound = f">= {minimum}" if maximum is None else f"in [{minimum}, {maximum}]"
        raise SystemExit(f"gunicorn.conf.py: {name}={value} out of range ({bound})")
    return value


bind = "0.0.0.0:8000"

# gthread: each worker runs a thread pool; threads blocked on I/O release the
# GIL, so the health-check thread keeps running during a slow DB call.
worker_class = "gthread"

# Keep small on the 0.25 vCPU / 512 MB Fargate task. WEB_CONCURRENCY is the
# gunicorn-standard override; bump it (and the task memory) together.
workers = _env_int("WEB_CONCURRENCY", 1, minimum=1)
threads = _env_int("GUNICORN_THREADS", 4, minimum=1)

# Worker silence timeout before the master kills/replaces it.
timeout = _env_int("GUNICORN_TIMEOUT", 30, minimum=1)
graceful_timeout = _env_int("GUNICORN_GRACEFUL_TIMEOUT", 30, minimum=1)

# Recycle workers periodically to bound memory creep on the tight 512 MB task;
# jitter staggers restarts so they don't all recycle at once.
max_requests = _env_int("GUNICORN_MAX_REQUESTS", 1000, minimum=1)
max_requests_jitter = _env_int("GUNICORN_MAX_REQUESTS_JITTER", 100, minimum=0)

# Logs to stdout/stderr -> CloudWatch.
accesslog = "-"
errorlog = "-"
