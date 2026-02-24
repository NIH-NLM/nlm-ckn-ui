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

echo "==> Starting ArangoDB dataset restore $(date)"

BUCKET=$(aws ssm get-parameter \
  --name "/$PROJECT_NAME/shared/arangodb-bucket-name" \
  --query 'Parameter.Value' --output text --region "$REGION")

VERSION=$(aws ssm get-parameter \
  --name "/$PROJECT_NAME/$ENVIRONMENT/arango/dataset-version" \
  --query 'Parameter.Value' --output text --region "$REGION")

ARANGO_PASSWORD=$(aws ssm get-parameter \
  --name "/$PROJECT_NAME/$ENVIRONMENT/arango/db-password" \
  --query 'Parameter.Value' --output text --region "$REGION")

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

# ── Stop ArangoDB ────────────────────────────────────────────────────────────
docker stop arangodb || true

# ── Clear and restore ────────────────────────────────────────────────────────
rm -rf "$DATA_DIR"/* "$APPS_DIR"/*

echo "==> Downloading s3://$BUCKET/$VERSION"
aws s3 cp "s3://$BUCKET/$VERSION" /tmp/restore.tar.gz

# Auto-detect tar structure: some archives use var/lib/arangodb3/...
# (created with -C /), others use arangodb/... (created with -C /var/lib).
FIRST_ENTRY=$(tar -tzf /tmp/restore.tar.gz | head -1 || true)
echo "==> Detected tar prefix: $FIRST_ENTRY"
if echo "$FIRST_ENTRY" | grep -q "^var/lib/arangodb3"; then
  tar -xzf /tmp/restore.tar.gz -C /
else
  tar -xzf /tmp/restore.tar.gz -C "$DATA_DIR" --strip-components=1
fi
rm -f /tmp/restore.tar.gz

chown -R 1000:1000 "$DATA_DIR" "$APPS_DIR"
echo "$VERSION" > "$DATA_DIR/.dataset-version"
echo "==> Extraction complete"

# ── Reset root password ──────────────────────────────────────────────────────
# ARANGO_ROOT_PASSWORD is only honoured on a fresh empty data directory.
# A restored backup has its own credentials baked in, so we must reset
# the password explicitly using a temporary no-auth container.
echo "==> Resetting root password to match SSM..."
docker run -d --name arango-reset \
  -e ARANGO_NO_AUTH=1 \
  -p 8529:8529 \
  -v "$DATA_DIR:/var/lib/arangodb3" \
  -v "$APPS_DIR:/var/lib/arangodb3-apps" \
  arangodb:3.12

for i in $(seq 1 60); do
  if curl -sf http://localhost:8529/_admin/server/availability > /dev/null 2>&1; then
    echo "==> Ready for password reset (attempt $i)"
    break
  fi
  sleep 5
done

curl -X PATCH http://localhost:8529/_api/user/root \
  -H "Content-Type: application/json" \
  -d "{\"passwd\": \"$ARANGO_PASSWORD\"}"

docker stop arango-reset && docker rm arango-reset

# ── Start ArangoDB normally ──────────────────────────────────────────────────
docker start arangodb
echo "==> Restore completed successfully $(date)"
RESTORE_SCRIPT_EOF

# Substitute environment-specific values into the restore script
# (avoid sed -i: BSD/macOS requires an explicit backup extension while GNU does not)
sed \
  -e "s|__PROJECT_NAME__|${PROJECT_NAME}|g" \
  -e "s|__ENVIRONMENT__|${ENVIRONMENT}|g" \
  -e "s|__AWS_REGION__|${AWS_REGION}|g" \
  "$RESTORE_SCRIPT_TMP" > "${RESTORE_SCRIPT_TMP}.new"
mv "${RESTORE_SCRIPT_TMP}.new" "$RESTORE_SCRIPT_TMP"

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
echo -e "${GREEN}==> Restore command dispatched!${NC}"
echo "  Command ID: $COMMAND_ID"
echo ""
echo "Monitor restore progress:"
echo "  aws ssm get-command-invocation \\"
echo "    --command-id $COMMAND_ID \\"
echo "    --instance-id $INSTANCE_ID \\"
echo "    --region $AWS_REGION \\"
echo "    --query '{Status:Status,Output:StandardOutputContent,Error:StandardErrorContent}'"
echo ""
echo "Check current version after restore:"
echo "  aws ssm get-parameter --name $SSM_PARAMETER --query 'Parameter.Value' --output text --region $AWS_REGION"
echo ""
echo "Connect via Session Manager:"
echo "  aws ssm start-session --target $INSTANCE_ID --region $AWS_REGION"  --document-name AWS-StartPortForwardingSession  --parameters '{"portNumber":["8529"],"localPortNumber":["8529"]}'
echo "Management Console: https://localhost:8529"
echo "Using password https://us-east-1.console.aws.amazon.com/systems-manager/parameters/%252Fcell-kn%252Fdev%252Farango%252Fdb-password/description?region=us-east-1&tab=Table"