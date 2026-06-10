#!/bin/bash
# ==============================================================================
# deploy-dataset.sh - Deploy ArangoDB Dataset Version
# ==============================================================================
# Deploys the ETL dataset version declared in ETL_VERSION at the repo root.
# Reads the version tag, constructs the S3 key, updates the SSM parameter,
# and triggers a blue-green arangorestore on the EC2 instance via SSM Run Command.
#
# USAGE:
#   ./scripts/app/deploy-dataset.sh <environment>
#
# ARGUMENTS:
#   environment   Environment name: dev, sandbox, or prod
#
# WHAT IT DOES:
#   1. Reads ETL_VERSION from the repository root
#   2. Constructs S3 key:  runs/<version>/06-golden-dump.tar.gz
#   3. Reads stack outputs from CloudFormation and bucket name from SSM
#   4. Validates the dataset file exists in S3
#   5. Updates the SSM dataset-version parameter
#   6. Dispatches a blue-green arangorestore via SSM Run Command and waits
#
# PREREQUISITES:
#   - ETL_VERSION file present at the repository root
#   - AWS CLI configured with appropriate credentials
#   - CloudFormation environment stack deployed
#   - Dataset tar.gz uploaded to S3 at runs/<version>/06-golden-dump.tar.gz
#
# ENVIRONMENT VARIABLES (optional):
#   EXPECTED_DBS   Space-separated list of ArangoDB databases verified after
#                  restore (default: "Cell-KN-Ontologies Cell-KN-Phenotypes
#                  Cell-KN-Schema"). Override when the schema changes without
#                  modifying the script.
#
# EXAMPLES:
#   ./scripts/app/deploy-dataset.sh dev
#   EXPECTED_DBS="DB1 DB2 DB3" ./scripts/app/deploy-dataset.sh dev
# ==============================================================================
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

FORCE=false
POSITIONAL=()
while [[ $# -gt 0 ]]; do
  case $1 in
    --force) FORCE=true; shift ;;
    *) POSITIONAL+=("$1"); shift ;;
  esac
done

if [ ${#POSITIONAL[@]} -ne 1 ]; then
  echo "Usage: $0 [--force] <environment>"
  echo "Example: $0 dev"
  echo "         $0 --force dev   # re-run even if version unchanged"
  exit 1
fi

ENVIRONMENT=${POSITIONAL[0]}

# Resolve ETL_VERSION relative to this script's location so the script works
# regardless of the caller's working directory.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ETL_VERSION_FILE="$SCRIPT_DIR/../../ETL_VERSION"

if [ ! -f "$ETL_VERSION_FILE" ]; then
  echo -e "${RED}Error: ETL_VERSION file not found at $ETL_VERSION_FILE${NC}"
  exit 1
fi

ETL_VERSION=$(tr -d '[:space:]' < "$ETL_VERSION_FILE")

if [ -z "$ETL_VERSION" ]; then
  echo -e "${RED}Error: ETL_VERSION file is empty${NC}"
  exit 1
fi

DATASET_S3_KEY="runs/${ETL_VERSION}/06-golden-dump.tar.gz"
echo "ETL version : $ETL_VERSION"
echo "S3 key      : $DATASET_S3_KEY"
PROJECT_NAME="cell-kn"
AWS_REGION=${AWS_REGION:-us-east-1}
STACK_NAME="${PROJECT_NAME}-${ENVIRONMENT}-arangodb"

# Validate environment
if [[ ! "$ENVIRONMENT" =~ ^(dev|sandbox|prod|stage)$ ]]; then
  echo -e "${RED}Error: Environment must be dev, sandbox, prod, or stage${NC}"
  exit 1
fi

echo "==> Getting infrastructure details from CloudFormation / SSM..."

# Read the dataset version SSM parameter name from stack outputs
SSM_PARAMETER=$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --region "$AWS_REGION" \
  --query 'Stacks[0].Outputs[?OutputKey==`DatasetVersionParameter`].OutputValue' \
  --output text 2>/dev/null) || {
  echo -e "${RED}Error: Could not read stack outputs from ${STACK_NAME}.${NC}"
  echo "Make sure the arangodb stack is deployed."
  exit 1
}

INSTANCE_ID=$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --region "$AWS_REGION" \
  --query 'Stacks[0].Outputs[?OutputKey==`InstanceId`].OutputValue' \
  --output text 2>/dev/null)

# Read S3 bucket name from SSM (written by shared-resources stack)
S3_BUCKET=$(aws ssm get-parameter \
  --name "/${PROJECT_NAME}/shared/arangodb-bucket-name" \
  --query 'Parameter.Value' \
  --output text \
  --region "$AWS_REGION" 2>/dev/null) || {
  echo -e "${RED}Error: Could not read S3 bucket name from SSM.${NC}"
  echo "Make sure the shared-resources stack is deployed."
  exit 1
}

if [ -z "$SSM_PARAMETER" ] || [ -z "$INSTANCE_ID" ]; then
  echo -e "${RED}Error: Could not read required values from stack ${STACK_NAME}.${NC}"
  echo "  SSM_PARAMETER: ${SSM_PARAMETER:-(empty)}"
  echo "  INSTANCE_ID:   ${INSTANCE_ID:-(empty)}"
  exit 1
fi

echo "  Environment:   $ENVIRONMENT"
echo "  SSM Parameter: $SSM_PARAMETER"
echo "  EC2 Instance:  $INSTANCE_ID"
echo "  S3 Bucket:     $S3_BUCKET"

echo ""
echo "==> Checking if dataset exists in S3..."
if ! aws s3 ls "s3://${S3_BUCKET}/${DATASET_S3_KEY}" > /dev/null 2>&1; then
  echo -e "${RED}ERROR: Dataset not found: s3://${S3_BUCKET}/${DATASET_S3_KEY}${NC}"
  echo ""
  echo "Available datasets:"
  aws s3 ls "s3://${S3_BUCKET}/runs/" --recursive | grep "06-golden-dump.tar.gz"
  exit 1
fi

echo "==> Current dataset version:"
aws ssm get-parameter \
  --name "$SSM_PARAMETER" \
  --query 'Parameter.Value' \
  --output text \
  --region "$AWS_REGION" 2>/dev/null || echo "none"

echo ""
echo "==> Updating dataset version to: $DATASET_S3_KEY"
aws ssm put-parameter \
  --name "$SSM_PARAMETER" \
  --value "$DATASET_S3_KEY" \
  --overwrite \
  --region "$AWS_REGION"

echo ""
echo "==> Triggering restore on instance $INSTANCE_ID..."
echo -e "${YELLOW}This may take 5-15 minutes depending on dataset size.${NC}"

# Write the restore script to a temp file.
# UserData only runs once on first EC2 boot, so we cannot rely on a reboot
# to trigger the restore. Instead we send the full restore logic as an SSM
# Run Command. Python is used only for JSON-encoding the script so that
# quotes and special characters are handled correctly.
RESTORE_SCRIPT_TMP=$(mktemp /tmp/arango-restore-XXXXXX.sh)
trap 'rm -f "$RESTORE_SCRIPT_TMP"' EXIT

cat > "$RESTORE_SCRIPT_TMP" << 'RESTORE_SCRIPT_EOF'
#!/bin/bash
set -euo pipefail

PROJECT_NAME="__PROJECT_NAME__"
ENVIRONMENT="__ENVIRONMENT__"
FORCE="__FORCE__"
REGION="__AWS_REGION__"
DATA_DIR=/var/lib/arangodb3
APPS_DIR=/var/lib/arangodb3-apps
# Stage green data INSIDE the EBS mount so the swap uses intra-filesystem
# renames (instant) rather than cross-device copies. /var/lib/arangodb3 is
# the EBS mount point and cannot itself be mv'd ("Device or resource busy").
GREEN_DATA=/var/lib/arangodb3/_green
GREEN_APPS=/var/lib/arangodb3-apps-green
# Space-separated list of ArangoDB databases that must exist after restore.
# Override with the EXPECTED_DBS env var when the schema changes rather than
# editing this default (e.g. export EXPECTED_DBS="DB1 DB2" before running).
EXPECTED_DBS="${EXPECTED_DBS:-Cell-KN-Ontologies Cell-KN-Phenotypes Cell-KN-Schema}"

echo "==> Starting ArangoDB blue-green dataset restore $(date)"

BUCKET=$(aws ssm get-parameter \
  --name "/$PROJECT_NAME/shared/arangodb-bucket-name" \
  --query 'Parameter.Value' --output text --region "$REGION")

VERSION=$(aws ssm get-parameter \
  --name "/$PROJECT_NAME/$ENVIRONMENT/arango/dataset-version" \
  --query 'Parameter.Value' --output text --region "$REGION")

ARANGO_PASSWORD=$(aws secretsmanager get-secret-value \
  --secret-id "/$PROJECT_NAME/$ENVIRONMENT/secrets/arangodb-password" \
  --query 'SecretString' --output text --region "$REGION")

LAST_RESTORED=$(cat "$DATA_DIR/.dataset-version" 2>/dev/null || echo "none")
echo "Target version : $VERSION"
echo "Last restored  : $LAST_RESTORED"

if [ "$VERSION" = "$LAST_RESTORED" ] && [ "$FORCE" != "true" ]; then
  echo "Already on version $VERSION — nothing to do"
  exit 0
elif [ "$VERSION" = "$LAST_RESTORED" ] && [ "$FORCE" = "true" ]; then
  echo "Already on version $VERSION — forcing re-restore (--force)"
fi

if [ "$VERSION" = "none" ] || [ -z "$VERSION" ]; then
  echo "No dataset version configured — skipping"
  exit 0
fi

# ── Download and extract the arangodump archive ──────────────────────────────
# Blue keeps serving traffic throughout this section.
echo "==> Downloading s3://$BUCKET/$VERSION"
aws s3 cp "s3://$BUCKET/$VERSION" /tmp/restore.tar.gz

DUMP_EXTRACT_DIR=/tmp/arango-dump
rm -rf "$DUMP_EXTRACT_DIR"
mkdir -p "$DUMP_EXTRACT_DIR"
tar -xzf /tmp/restore.tar.gz -C "$DUMP_EXTRACT_DIR"
rm -f /tmp/restore.tar.gz

# Locate the dump root. Multi-database dumps (arangodump --all-databases) place
# per-database directories under a top-level folder; single-database dumps put
# MANIFEST.json directly in the archive root. Strip a single wrapper directory
# if present so arangorestore receives the correct --input-directory in both cases.
TOP_LEVEL=$(ls -1 "$DUMP_EXTRACT_DIR" | head -1)
if [ -n "$TOP_LEVEL" ] && [ -d "$DUMP_EXTRACT_DIR/$TOP_LEVEL" ] && \
   [ "$(ls -1 "$DUMP_EXTRACT_DIR" | wc -l)" = "1" ]; then
  DUMP_DIR="$DUMP_EXTRACT_DIR/$TOP_LEVEL"
else
  DUMP_DIR="$DUMP_EXTRACT_DIR"
fi
echo "==> Dump root: $DUMP_DIR"

# Detect multi-database dump (no MANIFEST.json at top level; subdirs have their own)
if [ -f "$DUMP_DIR/MANIFEST.json" ]; then
  RESTORE_EXTRA_ARGS=""
  echo "==> Single-database dump detected"
else
  RESTORE_EXTRA_ARGS="--all-databases true"
  echo "==> Multi-database dump detected"
fi

# ── Start green instance on port 8530 ────────────────────────────────────────
# Blue continues to serve on 8529 while green initialises and is restored.
echo "==> Starting arango-green on port 8530..."
docker rm -f arango-green 2>/dev/null || true
rm -rf "$GREEN_DATA" "$GREEN_APPS"
mkdir -p "$GREEN_DATA" "$GREEN_APPS"
chown -R 1000:1000 "$GREEN_DATA" "$GREEN_APPS"

docker run -d --name arango-green \
  -p 8530:8529 \
  -e ARANGO_ROOT_PASSWORD="$ARANGO_PASSWORD" \
  -e ARANGODB_OVERRIDE_DETECTED_TOTAL_MEMORY=3g \
  -v "$GREEN_DATA:/var/lib/arangodb3" \
  -v "$GREEN_APPS:/var/lib/arangodb3-apps" \
  arangodb:3.12

GREEN_READY=0
for i in $(seq 1 60); do
  if curl -sf http://localhost:8530/_admin/server/availability > /dev/null 2>&1; then
    echo "==> arango-green ready (attempt $i)"
    GREEN_READY=1
    break
  fi
  sleep 5
done
if [ "$GREEN_READY" = "0" ]; then
  echo "ERROR: arango-green did not become ready — blue unchanged"
  docker logs arango-green --tail 20 || true
  docker rm -f arango-green || true
  rm -rf "$GREEN_DATA" "$GREEN_APPS"
  exit 1
fi

# ── Run arangorestore into green ──────────────────────────────────────────────
# INFO progress lines are suppressed from live output to avoid filling SSM's
# 24 KB stdout buffer before the actual error message appears.  The full log
# is written to /tmp for post-mortem inspection.
_run_restore() {
  local log="$1"; shift
  set +e
  # shellcheck disable=SC2086
  docker run --rm \
    --network host \
    -v "$DUMP_DIR:/dump" \
    arangodb:3.12 \
    arangorestore \
    --server.endpoint tcp://127.0.0.1:8530 \
    --server.password "$ARANGO_PASSWORD" \
    "$@" \
    2>&1 | tee "$log" | grep --line-buffered -v " INFO "
  local rc=${PIPESTATUS[0]}
  set -e
  if [ "$rc" -ne 0 ]; then
    echo "ERROR: arangorestore failed (exit $rc) — errors from $log:"
    grep -v " INFO " "$log" | tail -40
    exit 1
  fi
}

echo "==> Running arangorestore into arango-green (data collections)..."
_run_restore /tmp/arangorestore-pass1.log \
  --create-database true \
  --create-collection true \
  --overwrite true \
  --include-system-collections false \
  --input-directory /dump \
  $RESTORE_EXTRA_ARGS

# ── Import named graphs and custom analyzers from sidecar JSON files ──────────
# These files are produced by ETL pipeline versions that export sidecar JSON
# alongside the arangodump output.  Older dumps won't have them, so each check
# is guarded — the step is a complete no-op for backward-compatible dumps.
echo "==> Importing named graphs and custom analyzers from sidecar files (if present)..."
_import_graphs_and_analyzers() {
  local DB="$1"
  local AUTH
  AUTH="$(printf 'root:%s' "$ARANGO_PASSWORD" | base64 | tr -d '\n')"
  local BASE_URL="http://localhost:8530"

  # ── Analyzers ───────────────────────────────────────────────────────────────
  local ANALYZER_FILE="$DUMP_DIR/$DB/ckn-analyzers.ndjson"
  if [ -f "$ANALYZER_FILE" ]; then
    echo "  [$DB] Importing analyzers from $ANALYZER_FILE"
    # Normalize to one compact JSON object per line. The `if type=="array"`
    # guard handles dumps that wrap the objects in a single top-level JSON
    # array, as well as true NDJSON / a stream of pretty-printed objects.
    while IFS= read -r OBJ; do
      [ -z "$OBJ" ] && continue
      # Strip the "DB::" prefix from the analyzer name — ArangoDB re-adds it.
      local NAME STRIPPED
      NAME=$(jq -r '.name' <<<"$OBJ")
      STRIPPED="${NAME##*::}"
      BODY=$(jq -c --arg n "$STRIPPED" '.name = $n' <<<"$OBJ")
      HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
        -X POST \
        -H "Authorization: Basic $AUTH" \
        -H "Content-Type: application/json" \
        -d "$BODY" \
        "$BASE_URL/_db/$DB/_api/analyzer")
      if [ "$HTTP_CODE" = "201" ] || [ "$HTTP_CODE" = "200" ]; then
        echo "    [analyzer] $STRIPPED created ($HTTP_CODE)"
      elif [ "$HTTP_CODE" = "409" ]; then
        echo "    [analyzer] $STRIPPED already exists — skipped"
      else
        echo "    [analyzer] ERROR: $STRIPPED returned HTTP $HTTP_CODE"
        exit 1
      fi
    done < <(jq -c 'if type=="array" then .[] else . end' "$ANALYZER_FILE")
  fi

  # ── Named graphs ────────────────────────────────────────────────────────────
  local GRAPH_FILE="$DUMP_DIR/$DB/ckn-graphs.ndjson"
  if [ -f "$GRAPH_FILE" ]; then
    echo "  [$DB] Importing named graphs from $GRAPH_FILE"
    # Normalize to one compact JSON object per line, unwrapping a top-level
    # array if present (see analyzer import above).
    while IFS= read -r OBJ; do
      [ -z "$OBJ" ] && continue
      local GNAME
      GNAME=$(jq -r '.name' <<<"$OBJ")
      HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
        -X POST \
        -H "Authorization: Basic $AUTH" \
        -H "Content-Type: application/json" \
        -d "$OBJ" \
        "$BASE_URL/_db/$DB/_api/gharial")
      if [ "$HTTP_CODE" = "201" ] || [ "$HTTP_CODE" = "202" ]; then
        echo "    [graph] $GNAME created ($HTTP_CODE)"
      elif [ "$HTTP_CODE" = "409" ]; then
        echo "    [graph] $GNAME already exists — skipped"
      else
        echo "    [graph] ERROR: $GNAME returned HTTP $HTTP_CODE"
        exit 1
      fi
    done < <(jq -c 'if type=="array" then .[] else . end' "$GRAPH_FILE")
  fi
}

# shellcheck disable=SC2086  # intentional word-split on space-separated list
for _DB in $EXPECTED_DBS; do
  _import_graphs_and_analyzers "$_DB"
done
unset _DB

# ── Health check green post-restore ──────────────────────────────────────────
# Verify API connectivity AND that the expected databases are present.
# A successful arangorestore does not guarantee data made it in; checking for
# known database names catches a partial or mismatched dump early.
echo "==> Health checking arango-green post-restore..."
DB_LIST=$(curl -sf -u "root:$ARANGO_PASSWORD" \
  "http://localhost:8530/_api/database" 2>/dev/null || true)

if [ -z "$DB_LIST" ]; then
  echo "ERROR: arango-green failed post-restore health check (no API response) — blue unchanged"
  docker rm -f arango-green || true
  rm -rf "$GREEN_DATA" "$GREEN_APPS"
  exit 1
fi

MISSING_DBS=()
# Iterate over EXPECTED_DBS (configurable — see variable definition above).
# shellcheck disable=SC2086  # intentional word-split on space-separated list
for EXPECTED_DB in $EXPECTED_DBS; do
  if ! echo "$DB_LIST" | grep -q "\"$EXPECTED_DB\""; then
    MISSING_DBS+=("$EXPECTED_DB")
  fi
done

if [ "${#MISSING_DBS[@]}" -gt 0 ]; then
  echo "ERROR: arango-green is missing expected databases after restore — blue unchanged"
  echo "  Missing: ${MISSING_DBS[*]}"
  echo "  API response: $DB_LIST"
  docker rm -f arango-green || true
  rm -rf "$GREEN_DATA" "$GREEN_APPS"
  exit 1
fi

echo "==> arango-green healthy (all expected databases present)"

# ── Swap: blue → green (downtime window starts here) ─────────────────────────
# /var/lib/arangodb3 is the EBS mount point and cannot be mv'd directly.
# Instead we rename entries *within* the mount (same filesystem → instant)
# to back up blue, promote green, then docker-start the original container
# which reuses its existing mount path now pointing at the new data.
echo "==> Swapping to green data..."
docker stop arango-green && docker rm arango-green
docker stop arangodb || true

# Back up blue within the EBS (fast intra-filesystem rename)
rm -rf "$DATA_DIR/_blue_backup"
mkdir -p "$DATA_DIR/_blue_backup"
find "$DATA_DIR" -mindepth 1 -maxdepth 1 \
  ! -name '_blue_backup' ! -name '_green' \
  -exec mv {} "$DATA_DIR/_blue_backup/" \;

# Promote green into the EBS root (fast intra-filesystem rename)
find "$GREEN_DATA" -mindepth 1 -maxdepth 1 -exec mv {} "$DATA_DIR/" \;
rmdir "$GREEN_DATA"

# Swap apps dir (on root FS, small — plain mv is fine)
rm -rf "${APPS_DIR}-blue-old"
mv "$APPS_DIR" "${APPS_DIR}-blue-old"
mv "$GREEN_APPS" "$APPS_DIR"

# docker start reuses the original container (UserData config: log driver, env
# vars, restart policy) but now sees the new green data at the same mount path.
docker start arangodb

SWAP_READY=0
for i in $(seq 1 60); do
  if curl -sf http://localhost:8529/_admin/server/availability > /dev/null 2>&1; then
    echo "==> arangodb ready on green data (attempt $i)"
    SWAP_READY=1
    break
  fi
  sleep 5
done

if [ "$SWAP_READY" = "0" ]; then
  echo "ERROR: arangodb failed to start on green data — rolling back to blue"
  docker stop arangodb || true
  # Remove failed green data from EBS root
  find "$DATA_DIR" -mindepth 1 -maxdepth 1 ! -name '_blue_backup' -exec rm -rf {} \;
  # Restore blue backup to EBS root
  find "$DATA_DIR/_blue_backup" -mindepth 1 -maxdepth 1 -exec mv {} "$DATA_DIR/" \;
  rmdir "$DATA_DIR/_blue_backup"
  # Restore apps
  rm -rf "$APPS_DIR"
  mv "${APPS_DIR}-blue-old" "$APPS_DIR"
  docker start arangodb
  echo "==> Rollback complete — still on version $LAST_RESTORED"
  exit 1
fi

echo "$VERSION" > "$DATA_DIR/.dataset-version"

# ── Clean up ──────────────────────────────────────────────────────────────────
rm -rf "$DATA_DIR/_blue_backup" "${APPS_DIR}-blue-old" "$DUMP_EXTRACT_DIR"

echo "==> Blue-green swap complete $(date)"
RESTORE_SCRIPT_EOF

# Substitute environment-specific values into the restore script
# (avoid sed -i: BSD/macOS requires an explicit backup extension while GNU does not)
sed \
  -e "s|__PROJECT_NAME__|${PROJECT_NAME}|g" \
  -e "s|__ENVIRONMENT__|${ENVIRONMENT}|g" \
  -e "s|__AWS_REGION__|${AWS_REGION}|g" \
  -e "s|__FORCE__|${FORCE}|g" \
  "$RESTORE_SCRIPT_TMP" > "${RESTORE_SCRIPT_TMP}.new"
mv "${RESTORE_SCRIPT_TMP}.new" "$RESTORE_SCRIPT_TMP"

# The blue-green restore (S3 download + arangorestore) can take 30–60 min on
# large datasets. Allow 90 minutes on the SSM side; the caller (GitHub Actions)
# uses a matching job-level timeout.
SSM_TIMEOUT_SECONDS=5400   # 90 min

# Send the restore script via SSM Run Command.
# Python handles JSON encoding so quotes in the script are escaped correctly.
COMMAND_ID=$(python3 -c "
import json, subprocess, sys
with open('$RESTORE_SCRIPT_TMP') as f:
    script = f.read()
result = subprocess.run(
    ['aws', 'ssm', 'send-command',
     '--instance-ids', '$INSTANCE_ID',
     '--document-name', 'AWS-RunShellScript',
     '--parameters', json.dumps({'commands': [script]}),
     '--comment', 'ArangoDB dataset restore',
     '--timeout-seconds', '$SSM_TIMEOUT_SECONDS',
     '--region', '$AWS_REGION',
     '--query', 'Command.CommandId',
     '--output', 'text'],
    capture_output=True, text=True)
if result.returncode != 0:
    print(result.stderr, file=sys.stderr)
    sys.exit(1)
print(result.stdout.strip())
")

echo ""
echo -e "${GREEN}==> Restore command dispatched — waiting for completion...${NC}"
echo "  Command ID:  $COMMAND_ID"
echo "  Instance ID: $INSTANCE_ID"
echo ""

# Fetch and pretty-print SSM command output.
# Decodes \n escape sequences, strips \r carriage-return progress lines
# (e.g. S3 download progress), and separates stdout from stderr.
print_ssm_output() {
  python3 - "$1" "$2" "$3" <<'PYEOF'
import sys, json, subprocess

command_id, instance_id, region = sys.argv[1], sys.argv[2], sys.argv[3]
r = subprocess.run(
    ['aws', 'ssm', 'get-command-invocation',
     '--command-id', command_id, '--instance-id', instance_id,
     '--region', region, '--output', 'json'],
    capture_output=True, text=True)
if r.returncode != 0:
    print(r.stderr, file=sys.stderr)
    sys.exit(1)
data = json.loads(r.stdout)

def clean(text):
    """Drop carriage-return overwrite lines (progress bars) and blank lines."""
    return '\n'.join(
        l for l in text.split('\n')
        if '\r' not in l and l.strip()
    ).strip()

out = clean(data.get('StandardOutputContent', ''))
err = clean(data.get('StandardErrorContent', ''))

if out:
    print(out)
if err:
    print()
    print('--- stderr ---')
    print(err)
PYEOF
}

# Poll until the SSM command reaches a terminal state or we exceed SSM_TIMEOUT_SECONDS.
POLL_INTERVAL=30
ELAPSED=0

echo "Waiting for restore to complete..."
echo ""
while [ "$ELAPSED" -lt "$SSM_TIMEOUT_SECONDS" ]; do
  STATUS=$(aws ssm get-command-invocation \
    --command-id "$COMMAND_ID" \
    --instance-id "$INSTANCE_ID" \
    --region "$AWS_REGION" \
    --query 'Status' \
    --output text 2>/dev/null || echo "Unknown")

  # Print a dot for in-progress states; only print status on changes or terminal
  case "$STATUS" in
    InProgress|Pending|Delayed)
      printf "  [%ds] %s\n" "$ELAPSED" "$STATUS"
      ;;
    Success)
      echo ""
      echo -e "${GREEN}==> Restore succeeded!${NC}"
      echo ""
      print_ssm_output "$COMMAND_ID" "$INSTANCE_ID" "$AWS_REGION"
      echo ""
      echo -e "Active dataset version: ${GREEN}$(aws ssm get-parameter \
        --name "$SSM_PARAMETER" \
        --query 'Parameter.Value' \
        --output text \
        --region "$AWS_REGION")${NC}"
      exit 0
      ;;
    Failed|Cancelled|TimedOut|DeliveryTimedOut|ExecutionTimedOut)
      echo ""
      echo -e "${RED}==> Restore failed (status: $STATUS)${NC}"
      echo ""
      print_ssm_output "$COMMAND_ID" "$INSTANCE_ID" "$AWS_REGION"
      exit 1
      ;;
  esac

  sleep "$POLL_INTERVAL"
  ELAPSED=$((ELAPSED + POLL_INTERVAL))
done

echo ""
echo -e "${RED}==> Timed out after ${SSM_TIMEOUT_SECONDS}s — SSM command may still be running${NC}"
echo "Check manually:"
echo "  aws ssm get-command-invocation --command-id $COMMAND_ID --instance-id $INSTANCE_ID --region $AWS_REGION"
exit 1