# ---- Stage 1: Install dependencies ----
FROM python:3.13.3-slim AS builder

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt gunicorn

# ---- Stage 2: Production image ----
FROM python:3.13.3-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

# UI version (image tag), injected at build time and surfaced via the version API.
ARG UI_VERSION=dev
ENV UI_VERSION=${UI_VERSION}

WORKDIR /app

# Copy installed Python packages from builder
COPY --from=builder /install /usr/local

# Copy backend source (filtered by .dockerignore)
COPY . .

# Build-only SECRET_KEY so Django settings import and `collectstatic` can run.
# Scoped to this RUN (not a persistent ENV) so the image ships no default secret
# -- the runtime must still supply a real SECRET_KEY. ARANGO_TEST_MODE=true lets
# settings load without real Arango config (collectstatic touches no database).
# No "|| true": a genuine collectstatic failure now fails the build.
ARG BUILD_SECRET_KEY=build-only-not-a-real-secret
RUN SECRET_KEY="$BUILD_SECRET_KEY" ARANGO_TEST_MODE=true \
    python manage.py collectstatic --noinput

EXPOSE 8000

CMD ["gunicorn", "core.wsgi:application", "--config", "gunicorn.conf.py"]
