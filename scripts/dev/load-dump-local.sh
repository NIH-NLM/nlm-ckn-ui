#!/bin/bash
# ==============================================================================
# load-dump-local.sh - Load an S3 golden ArangoDB dump into a local container
# ==============================================================================
# Downloads a golden dump from S3 and restores it into a local ArangoDB Docker
# container, including the named graphs + analyzers (required for traversals).
#
# USAGE:
#   ./scripts/dev/load-dump-local.sh [VERSION] [PORT]
#
#   VERSION  ETL dataset version (default: value of ETL_VERSION at repo root)
#   PORT     host port for the container (default: 8529 = the port the Django
#            app points at via ARANGO_DB_HOST in .env; use 8540 for a
#            side-by-side container that doesn't touch the app's DB)
#   NAME     container name (default: arango-current on :8529, else arango-ckn-<PORT>)
#
# EXAMPLES:
#   ./scripts/dev/load-dump-local.sh v1.4.6-alpha.32        # onto :8529 (app uses it)
#   ./scripts/dev/load-dump-local.sh v1.4.6-alpha.32 8540   # side-by-side on :8540
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
BUCKET="cell-kn-arangodb-data-952291113202"
# Pinnable for reproducibility: golden dumps are produced against a specific
# ArangoDB; override with ARANGO_IMAGE if a future major version breaks restore.
IMAGE="${ARANGO_IMAGE:-arangodb:latest}"
PW=$(grep -E '^ARANGO_DB_PASSWORD=' .env | cut -d= -f2-)
[ -n "$PW" ] || { echo "ERROR: ARANGO_DB_PASSWORD not found in .env"; exit 1; }

echo "==> Version: $VERSION   Port: $PORT   Container: $CONTAINER"

# 1. Download + extract the dump from S3. Clean the temp dir on any exit.
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
echo "==> Downloading s3://$BUCKET/runs/$VERSION/06-golden-dump.tar.gz"
aws s3 cp "s3://$BUCKET/runs/$VERSION/06-golden-dump.tar.gz" "$TMP/dump.tar.gz"
tar -xzf "$TMP/dump.tar.gz" -C "$TMP"
DUMP_DIR=$(find "$TMP" -maxdepth 1 -type d -name 'arangodump*')
[ -d "$DUMP_DIR" ] || { echo "ERROR: no arangodump directory in the tarball"; exit 1; }
[ "$(printf '%s\n' "$DUMP_DIR" | wc -l)" -eq 1 ] || {
  echo "ERROR: multiple arangodump directories in the tarball"; exit 1; }
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

# 3. Restore all databases (Cell-KN-Ontologies, Cell-KN-Phenotypes, _system)
echo "==> arangorestore"
docker run --rm --network host -v "$DUMP_DIR:/dump" "$IMAGE" \
  arangorestore --server.endpoint "tcp://127.0.0.1:$PORT" --server.password "$PW" \
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
      [[ "$STATUS" =~ ^20[0-9]$ || "$STATUS" == "409" ]] ||
        echo "    WARNING: $DB $API import returned HTTP $STATUS"
    done
  done
done

echo "==> Done. $VERSION is live on :$PORT (databases: Cell-KN-Ontologies, Cell-KN-Phenotypes)."
echo "    If on :8529, restart the Django server so it reconnects to the new data."
