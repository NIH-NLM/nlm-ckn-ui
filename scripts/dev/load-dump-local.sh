#!/bin/bash
# ==============================================================================
# load-dump-local.sh - Load an S3 golden ArangoDB dump into a local container
# ==============================================================================
# Downloads a golden dump from S3 and restores it into a local ArangoDB Docker
# container, including the named graphs + analyzers (required for traversals).
#
# USAGE:
#   ./scripts/dev/load-dump-local.sh [VERSION|S3_URI] [PORT] [NAME]
#
#   VERSION  ETL dataset version (default: value of ETL_VERSION at repo root),
#            mapped to the default cell-kn golden-dump path in S3. Alternatively
#            pass a full s3:// URI here (or via DUMP_S3_URI) when the bucket/key
#            layout differs from the default (e.g. the nlm-2026 staging bucket).
#   PORT     host port for the container (default: 8529 = the port the Django
#            app points at via ARANGO_DB_HOST in .env; use 8540 for a
#            side-by-side container that doesn't touch the app's DB)
#   NAME     container name (default: arango-current on :8529, else arango-ckn-<PORT>)
#
# EXAMPLES:
#   ./scripts/dev/load-dump-local.sh v1.4.6-alpha.32        # onto :8529 (app uses it)
#   ./scripts/dev/load-dump-local.sh v1.4.6-alpha.32 8540   # side-by-side on :8540
#   ./scripts/dev/load-dump-local.sh \
#     s3://nlm-2026-staging-graphs-ec2-675671393318/DATA/nlm-ckn-golden-dump-v1.4.6-rc.6.tar.gz
#
# PREREQUISITES: aws cli (read access to the bucket), docker, jq, an .env with
# ARANGO_DB_PASSWORD. List available versions with:
#   aws s3 ls s3://cell-kn-arangodb-data-952291113202/runs/ --recursive | grep golden
# ==============================================================================
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO_ROOT"

[ -f ETL_VERSION ] || { echo "ERROR: ETL_VERSION file not found in $REPO_ROOT"; exit 1; }
[ -f .env ] || { echo "ERROR: .env file not found in $REPO_ROOT"; exit 1; }

VERSION="${1:-$(tr -d '[:space:]' < ETL_VERSION)}"
PORT="${2:-8529}"
# Container name is port-derived so a test run on another port never clobbers
# the app's DB container. Default keeps the familiar "arango-current" on :8529.
if [ -n "${3:-}" ]; then CONTAINER="$3"
elif [ "$PORT" = "8529" ]; then CONTAINER="arango-current"
else CONTAINER="arango-ckn-$PORT"; fi
# Default source bucket/layout. Overridden when a full s3:// URI is supplied
# (as $1 or via DUMP_S3_URI), since other accounts use different key layouts.
BUCKET="cell-kn-arangodb-data-952291113202"
# Pinnable for reproducibility: golden dumps are produced against a specific
# ArangoDB; override with ARANGO_IMAGE if a future major version breaks restore.
IMAGE="${ARANGO_IMAGE:-arangodb:latest}"
PW=$(grep -m1 -E '^ARANGO_DB_PASSWORD=' .env | cut -d= -f2-)
[ -n "$PW" ] || { echo "ERROR: ARANGO_DB_PASSWORD not found in .env"; exit 1; }

# Resolve the S3 source. Accept either a bare VERSION (mapped to the default
# cell-kn golden-dump path) or a full s3:// URI used verbatim, since bucket/key
# layouts differ across accounts.
if [ -n "${DUMP_S3_URI:-}" ]; then
  S3_URI="$DUMP_S3_URI"
elif [[ "$VERSION" == s3://* ]]; then
  S3_URI="$VERSION"
  VERSION="${S3_URI##*/}"          # use the filename as the display label
else
  S3_URI="s3://$BUCKET/runs/$VERSION/06-golden-dump.tar.gz"
fi

echo "==> Version: $VERSION   Port: $PORT   Container: $CONTAINER"

# 1. Download + extract the dump from S3. Clean the temp dir on any exit.
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
echo "==> Downloading $S3_URI"
aws s3 cp "$S3_URI" "$TMP/dump.tar.gz"
tar -xzf "$TMP/dump.tar.gz" -C "$TMP"
# Locate the dump root. arangodump --all-databases produces a directory holding
# per-database subdirs (Cell-KN-Ontologies, Cell-KN-Phenotypes). The tarball may
# wrap it in a top-level folder of any name (older cell-kn dumps used
# arangodump*; the nlm-2026 dumps differ), so find the directory that actually
# contains the expected database subdir rather than matching on the wrapper name.
ONTO_DIR=$(find "$TMP" -maxdepth 3 -type d -name 'Cell-KN-Ontologies' -print -quit)
DUMP_DIR="${ONTO_DIR%/Cell-KN-Ontologies}"
[ -n "$DUMP_DIR" ] && [ -d "$DUMP_DIR" ] || {
  echo "ERROR: could not locate the dump root (no Cell-KN-Ontologies dir in the tarball)"; exit 1; }
echo "==> Dump extracted: $DUMP_DIR"

# 2. (Re)create the container. NOTE: if :8529 is in use by the old dev DB
#    (e.g. arangodb-v1.4.3), stop it first:  docker stop arangodb-v1.4.3
docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
echo "==> Starting $IMAGE on :$PORT"
docker run -d --name "$CONTAINER" -p "$PORT:8529" \
  -e ARANGO_ROOT_PASSWORD="$PW" \
  -e ARANGODB_OVERRIDE_DETECTED_TOTAL_MEMORY=2g \
  "$IMAGE" >/dev/null
for i in $(seq 1 40); do
  curl -sf "http://localhost:$PORT/_admin/server/availability" >/dev/null 2>&1 && break
  sleep 2
done
curl -sf "http://localhost:$PORT/_admin/server/availability" >/dev/null 2>&1 || {
  echo "ERROR: ArangoDB did not become available on :$PORT within 80s"; exit 1; }

# 3. Restore all databases (Cell-KN-Ontologies, Cell-KN-Phenotypes, _system).
#    Reach the host-published port via host.docker.internal so this works on
#    Docker Desktop (Mac/Windows) as well as Linux; --add-host maps the name to
#    the host gateway on Linux, where it is not predefined.
echo "==> arangorestore"
docker run --rm --add-host=host.docker.internal:host-gateway -v "$DUMP_DIR:/dump" "$IMAGE" \
  arangorestore --server.endpoint "tcp://host.docker.internal:$PORT" --server.password "$PW" \
  --create-database true --create-collection true --overwrite true \
  --include-system-collections false --all-databases true --input-directory /dump

# 4. Import named graphs + custom analyzers from the sidecar files.
#    REQUIRED: the app queries the KN-*-v2.0 named graphs; without this the
#    workflow traversals fail.
echo "==> Importing named graphs + analyzers"
AUTH=$(printf 'root:%s' "$PW" | base64 | tr -d '\n')
for DB in Cell-KN-Ontologies Cell-KN-Phenotypes; do
  for SPEC in "ckn-analyzers:analyzer" "ckn-graphs:gharial"; do
    FILE="$DUMP_DIR/$DB/${SPEC%%:*}.ndjson"; API="${SPEC##*:}"
    [ -f "$FILE" ] || continue
    jq -c '.' "$FILE" | while IFS= read -r OBJ; do
      [ -z "$OBJ" ] && continue
      if [ "$API" = "analyzer" ]; then
        N=$(jq -r '.name' <<<"$OBJ"); OBJ=$(jq -c --arg n "${N##*::}" '.name=$n' <<<"$OBJ")
      fi
      STATUS=$(curl -s -o /dev/null -w '%{http_code}' -X POST \
        -H "Authorization: Basic $AUTH" -H "Content-Type: application/json" \
        -d "$OBJ" "http://localhost:$PORT/_db/$DB/_api/$API")
      # 409 = already exists (idempotent re-run); treat 2xx and 409 as success.
      # Named graphs/analyzers are REQUIRED for traversals, so fail hard.
      if ! [[ "$STATUS" =~ ^20[0-9]$ || "$STATUS" == "409" ]]; then
        echo "ERROR: $DB $API import returned HTTP $STATUS (required for traversals)"
        exit 1
      fi
    done || exit 1
  done
done

echo "==> Done. $VERSION is live on :$PORT (databases: Cell-KN-Ontologies, Cell-KN-Phenotypes)."
echo "    If on :8529, restart the Django server so it reconnects to the new data."
