#!/bin/bash
# ==============================================================================
# create-monitor-user.sh - Create/refresh the read-only ArangoDB monitoring user
# ==============================================================================
# The monitoring stack (cell-kn-<env>-monitoring) mints a password secret at
#   /cell-kn/<env>/secrets/arangodb-monitor-password
# but the ArangoDB *user* itself must be created inside the DB. This script does
# that over SSM (no inbound access needed): it runs arangosh inside the running
# arangodb container on the EC2 host, authenticating as root, and creates a user
# with READ-ONLY access to _system so it can read /_admin/metrics/v2.
#
# Idempotent: re-running updates the password + re-grants RO. Run it once after
# deploying the monitoring stack, and again whenever the secret is rotated.
#
# USAGE:
#   AWS_PROFILE=springbok ./scripts/ops/create-monitor-user.sh [env]   # default: stage
# ==============================================================================
set -euo pipefail

ENVIRONMENT="${1:-stage}"
PROJECT_NAME="cell-kn"
export AWS_REGION="${AWS_REGION:-us-east-1}"
MONITOR_USER="${MONITOR_USER:-monitor}"
STACK_NAME="${PROJECT_NAME}-${ENVIRONMENT}-arangodb"

if [[ ! "$ENVIRONMENT" =~ ^(dev|stage|sandbox|prod)$ ]]; then
  echo "Error: environment must be dev, stage, sandbox, or prod" >&2
  exit 1
fi

echo "==> Resolving ArangoDB instance from stack ${STACK_NAME}..."
INSTANCE_ID=$(aws cloudformation describe-stacks --stack-name "$STACK_NAME" \
  --region "$AWS_REGION" \
  --query 'Stacks[0].Outputs[?OutputKey==`InstanceId`].OutputValue' --output text)
[ -n "$INSTANCE_ID" ] && [ "$INSTANCE_ID" != "None" ] || { echo "Error: no InstanceId" >&2; exit 1; }
echo "  Instance: $INSTANCE_ID"

# The root + monitor passwords are read on the HOST (inside the SSM command),
# never passed through this machine's argv/logs.
ROOT_SECRET="/${PROJECT_NAME}/${ENVIRONMENT}/secrets/arangodb-password"
MONITOR_SECRET="/${PROJECT_NAME}/${ENVIRONMENT}/secrets/arangodb-monitor-password"

# Build the remote script. arangosh runs INSIDE the container; both secrets are
# fetched on the host via the instance role (which already has SecretsManager
# GetSecretValue for /cell-kn/<env>/secrets/*).
read -r -d '' REMOTE <<REMOTE_EOF || true
set -euo pipefail
REGION="${AWS_REGION}"
ROOT_PW=\$(aws secretsmanager get-secret-value --secret-id "${ROOT_SECRET}" --query SecretString --output text --region "\$REGION")
MON_PW=\$(aws secretsmanager get-secret-value --secret-id "${MONITOR_SECRET}" --query SecretString --output text --region "\$REGION")
docker exec -i arangodb arangosh \
  --server.endpoint tcp://127.0.0.1:8529 \
  --server.username root \
  --server.password "\$ROOT_PW" \
  --javascript.execute-string "
    var users = require('@arangodb/users');
    var u = '${MONITOR_USER}';
    if (users.exists(u)) { users.update(u, '\$MON_PW', true); }
    else { users.save(u, '\$MON_PW', true); }
    users.grantDatabase(u, '_system', 'ro');
    print('monitor user ${MONITOR_USER} ready (RO on _system)');
  "
REMOTE_EOF

echo "==> Sending SSM command to create/update '${MONITOR_USER}'..."
CMD_ID=$(aws ssm send-command \
  --instance-ids "$INSTANCE_ID" \
  --document-name "AWS-RunShellScript" \
  --comment "create arango monitor user" \
  --parameters commands="$REMOTE" \
  --region "$AWS_REGION" \
  --query 'Command.CommandId' --output text)

echo "  Command: $CMD_ID  (waiting...)"
aws ssm wait command-executed --command-id "$CMD_ID" --instance-id "$INSTANCE_ID" \
  --region "$AWS_REGION" 2>/dev/null || true

STATUS=$(aws ssm get-command-invocation --command-id "$CMD_ID" --instance-id "$INSTANCE_ID" \
  --region "$AWS_REGION" --query 'Status' --output text)
echo "==> Status: $STATUS"
aws ssm get-command-invocation --command-id "$CMD_ID" --instance-id "$INSTANCE_ID" \
  --region "$AWS_REGION" --query 'StandardOutputContent' --output text
if [ "$STATUS" != "Success" ]; then
  echo "stderr:"; aws ssm get-command-invocation --command-id "$CMD_ID" --instance-id "$INSTANCE_ID" \
    --region "$AWS_REGION" --query 'StandardErrorContent' --output text
  exit 1
fi
echo "Done."
