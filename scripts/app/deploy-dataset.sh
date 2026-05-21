#!/bin/bash
# ==============================================================================
# deploy-dataset.sh - Deploy ArangoDB Dataset Version
# ==============================================================================
# Deploys a new ArangoDB dataset version using SSM parameter-based versioning.
# The EC2 instance startup script detects version changes and restores only
# when the version differs from the currently deployed dataset.
#
# USAGE:
#   ./scripts/deploy-dataset.sh <environment> <s3-key>
#
# ARGUMENTS:
#   environment   Environment name: dev, sandbox, or prod
#   s3-key        S3 object key for the dataset tar.gz file
#                 Example: datasets/2024-02-11-v1.2.3.tar.gz
#
# WHAT IT DOES:
#   1. Reads stack outputs from CloudFormation and bucket name from SSM
#   2. Validates dataset exists in S3
#   3. Updates SSM parameter with new dataset version
#   4. Reboots the ArangoDB EC2 instance via SSM
#   5. On reboot, the UserData script detects the version change and restores
#
# PREREQUISITES:
#   - AWS CLI configured with appropriate credentials
#   - CloudFormation environment stack deployed
#   - Dataset tar.gz file uploaded to S3
#
# EXAMPLES:
#   # Upload dataset to S3
#   aws s3 cp my-data.tar.gz s3://cell-kn-arangodb-data-<account-id>/datasets/2024-02-11-v1.2.3.tar.gz
#
#   # Deploy the dataset
#   ./scripts/deploy-dataset.sh dev datasets/2024-02-11-v1.2.3.tar.gz
#
#   # Rollback to previous version
#   ./scripts/deploy-dataset.sh dev datasets/2024-02-10-v1.2.2.tar.gz
# ==============================================================================
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

if [ $# -ne 2 ]; then
  echo "Usage: $0 <environment> <s3-key>"
  echo "Example: $0 dev datasets/2024-02-11-v1.2.3.tar.gz"
  exit 1
fi

ENVIRONMENT=$1
DATASET_S3_KEY=$2
PROJECT_NAME="cell-kn"
AWS_REGION=${AWS_REGION:-us-east-1}
STACK_NAME="${PROJECT_NAME}-${ENVIRONMENT}-arangodb"

# Validate environment
if [[ ! "$ENVIRONMENT" =~ ^(dev|sandbox|prod)$ ]]; then
  echo -e "${RED}Error: Environment must be dev, sandbox, or prod${NC}"
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
  aws s3 ls "s3://${S3_BUCKET}/datasets/" --recursive
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
set -euxo pipefail

PROJECT_NAME="__PROJECT_NAME__"
ENVIRONMENT="__ENVIRONMENT__"
REGION="__AWS_REGION__"
DATA_DIR=/var/lib/arangodb3
APPS_DIR=/var/lib/arangodb3-apps
GREEN_DATA=/var/lib/arangodb3-green
GREEN_APPS=/var/lib/arangodb3-apps-green

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

if [ "$VERSION" = "$LAST_RESTORED" ]; then
  echo "Already on version $VERSION — nothing to do"
  exit 0
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
# --include-system-collections false (the default) intentionally excludes _users
# so the root password set by ARANGO_ROOT_PASSWORD on fresh init is preserved.
echo "==> Running arangorestore into arango-green..."
# shellcheck disable=SC2086
docker run --rm \
  --network host \
  -v "$DUMP_DIR:/dump:ro" \
  arangodb:3.12 \
  arangorestore \
  --server.endpoint tcp://127.0.0.1:8530 \
  --server.password "$ARANGO_PASSWORD" \
  --overwrite true \
  --include-system-collections false \
  --input-directory /dump \
  $RESTORE_EXTRA_ARGS

# ── Health check green post-restore ──────────────────────────────────────────
echo "==> Health checking arango-green post-restore..."
if ! curl -sf -u "root:$ARANGO_PASSWORD" \
     "http://localhost:8530/_api/database" > /dev/null 2>&1; then
  echo "ERROR: arango-green failed post-restore health check — blue unchanged"
  docker rm -f arango-green || true
  rm -rf "$GREEN_DATA" "$GREEN_APPS"
  exit 1
fi
echo "==> arango-green healthy"

# ── Swap: blue → green (downtime window starts here) ─────────────────────────
echo "==> Swapping to green data..."
docker stop arango-green
docker rm arango-green
docker stop arangodb || true

mv "$DATA_DIR"  /var/lib/arangodb3-blue-old
mv "$GREEN_DATA" "$DATA_DIR"
mv "$APPS_DIR"  /var/lib/arangodb3-apps-blue-old
mv "$GREEN_APPS" "$APPS_DIR"

# docker start reuses the original container (UserData config: log driver, env
# vars, restart policy) but now mounts the new green data at the same host path.
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
  rm -rf "$DATA_DIR" "$APPS_DIR" || true
  mv /var/lib/arangodb3-blue-old "$DATA_DIR"
  mv /var/lib/arangodb3-apps-blue-old "$APPS_DIR"
  docker start arangodb
  echo "==> Rollback complete — still on version $LAST_RESTORED"
  exit 1
fi

echo "$VERSION" > "$DATA_DIR/.dataset-version"

# ── Clean up ──────────────────────────────────────────────────────────────────
rm -rf /var/lib/arangodb3-blue-old /var/lib/arangodb3-apps-blue-old
rm -rf "$DUMP_EXTRACT_DIR"

echo "==> Blue-green swap complete $(date)"
RESTORE_SCRIPT_EOF

# Substitute environment-specific values into the restore script
# (avoid sed -i: BSD/macOS requires an explicit backup extension while GNU does not)
sed \
  -e "s|__PROJECT_NAME__|${PROJECT_NAME}|g" \
  -e "s|__ENVIRONMENT__|${ENVIRONMENT}|g" \
  -e "s|__AWS_REGION__|${AWS_REGION}|g" \
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
echo "Follow output in another terminal:"
echo "  aws ssm get-command-invocation \\"
echo "    --command-id $COMMAND_ID \\"
echo "    --instance-id $INSTANCE_ID \\"
echo "    --region $AWS_REGION \\"
echo "    --query '{Status:Status,Output:StandardOutputContent,Error:StandardErrorContent}'"
echo ""

# Poll until the SSM command reaches a terminal state or we exceed SSM_TIMEOUT_SECONDS.
POLL_INTERVAL=30
ELAPSED=0

echo "==> Polling every ${POLL_INTERVAL}s (max ${SSM_TIMEOUT_SECONDS}s)..."
while [ "$ELAPSED" -lt "$SSM_TIMEOUT_SECONDS" ]; do
  STATUS=$(aws ssm get-command-invocation \
    --command-id "$COMMAND_ID" \
    --instance-id "$INSTANCE_ID" \
    --region "$AWS_REGION" \
    --query 'Status' \
    --output text 2>/dev/null || echo "Unknown")

  echo "  [${ELAPSED}s] $STATUS"

  case "$STATUS" in
    Success)
      echo ""
      echo -e "${GREEN}==> Restore succeeded!${NC}"
      echo "Active dataset version:"
      aws ssm get-parameter \
        --name "$SSM_PARAMETER" \
        --query 'Parameter.Value' \
        --output text \
        --region "$AWS_REGION"
      exit 0
      ;;
    Failed|Cancelled|TimedOut|DeliveryTimedOut|ExecutionTimedOut)
      echo ""
      echo -e "${RED}==> Restore failed (SSM status: $STATUS)${NC}"
      echo ""
      echo "SSM command output:"
      aws ssm get-command-invocation \
        --command-id "$COMMAND_ID" \
        --instance-id "$INSTANCE_ID" \
        --region "$AWS_REGION" \
        --query '{Output:StandardOutputContent,Error:StandardErrorContent}' \
        --output json
      exit 1
      ;;
  esac

  sleep "$POLL_INTERVAL"
  ELAPSED=$((ELAPSED + POLL_INTERVAL))
done

echo -e "${RED}==> Timed out after ${SSM_TIMEOUT_SECONDS}s — SSM command may still be running${NC}"
echo "Check manually:"
echo "  aws ssm get-command-invocation --command-id $COMMAND_ID --instance-id $INSTANCE_ID --region $AWS_REGION"
exit 1