#!/usr/bin/env bash
# ==============================================================================
# restore-dump.sh - Restore an extracted golden dump into a running ArangoDB
# ==============================================================================
# Shared by scripts/dev/load-dump-local.sh and CI, so both restore a dump the
# same way: arangorestore, then the named graphs + analyzers from the dump's
# sidecar files (REQUIRED for traversals), then the ckn_meta/dataset stamp.
#
# USAGE:
#   ARANGO_PASSWORD=... scripts/lib/restore-dump.sh DUMP_DIR PORT S3_URI
#
#   DUMP_DIR  directory holding the per-database dump subdirs
#             (Cell-KN-Ontologies, Cell-KN-Phenotypes)
#   PORT      host port of the running ArangoDB
#   S3_URI    the dump's source URI; the stamped version is derived from it
#
# The password comes from ARANGO_PASSWORD. The arangorestore and curl calls
# below still pass it on their command lines, as load-dump-local.sh always has.
# ARANGO_IMAGE selects the image that runs arangorestore (default arangodb:latest).
# ==============================================================================

set -euo pipefail

[ $# -eq 3 ] || { echo "Usage: ARANGO_PASSWORD=... $0 DUMP_DIR PORT S3_URI"; exit 1; }
DUMP_DIR="$1"
PORT="$2"
S3_URI="$3"
PW="${ARANGO_PASSWORD:?ARANGO_PASSWORD must be set}"
IMAGE="${ARANGO_IMAGE:-arangodb:latest}"

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

# 5. Stamp the dataset version so the running app can report what is loaded
#    rather than what ETL_VERSION pins. Non-fatal: a missing marker shows as
#    "unknown" in the UI, which is accurate.
# A full s3:// URI (whether passed as $1 or via DUMP_S3_URI) leaves VERSION
# unrelated to the actual dump (the tarball filename, or the ETL_VERSION pin
# when $1 was omitted), which would surface in the UI as a filename — or worse,
# assert the pin was actually loaded. The default layout carries the version in
# the key's directory component; other layouts carry it in the filename. Derive
# from S3_URI (the source of truth) rather than VERSION so both custom-layout
# entry points (bare $1 URI, or DUMP_S3_URI) are handled identically.
if [[ "$S3_URI" =~ /runs/([^/]+)/06-golden-dump\.tar\.gz$ ]]; then
  STAMP_VERSION="${BASH_REMATCH[1]}"
else
  STAMP_VERSION="${S3_URI##*/}"          # basename of the key
  STAMP_VERSION="${STAMP_VERSION%.tar.gz}"
  STAMP_VERSION="${STAMP_VERSION##*golden-dump-}"
fi
echo "==> Stamping dataset version ($STAMP_VERSION)"
STAMP_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
for DB in Cell-KN-Ontologies Cell-KN-Phenotypes; do
  curl -s -o /dev/null -X POST \
    -H "Authorization: Basic $AUTH" -H "Content-Type: application/json" \
    -d '{"name":"ckn_meta"}' \
    "http://localhost:$PORT/_db/$DB/_api/collection" || true
  STATUS=$(curl -s -o /dev/null -w '%{http_code}' -X POST \
    -H "Authorization: Basic $AUTH" -H "Content-Type: application/json" \
    -d "{\"_key\":\"dataset\",\"etl_version\":\"$STAMP_VERSION\",\"restored_at\":\"$STAMP_AT\"}" \
    "http://localhost:$PORT/_db/$DB/_api/document/ckn_meta?overwriteMode=replace") || true
  [[ "$STATUS" =~ ^20[0-9]$ ]] || echo "  WARNING: $DB stamp returned HTTP ${STATUS:-000} (non-fatal)"
done

echo "==> Done. $STAMP_VERSION is live on :$PORT (databases: Cell-KN-Ontologies, Cell-KN-Phenotypes)."
