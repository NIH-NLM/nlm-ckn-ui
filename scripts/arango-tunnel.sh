#!/bin/bash
# ==============================================================================
# arango-tunnel.sh - SSM Port-Forward to ArangoDB EC2 Instance
# ==============================================================================
# Looks up the ArangoDB EC2 instance ID and password, then opens an SSM
# port-forwarding tunnel: instance:8529 → localhost:8530
#
# USAGE:
#   ./scripts/arango-tunnel.sh [environment]
#
# ARGUMENTS:
#   environment   Environment name: dev, sandbox, or prod (default: dev)
#
# PREREQUISITES:
#   - AWS CLI configured with springbok profile
#   - AWS Session Manager plugin installed
#     https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-working-with-install-plugin.html
#   - CloudFormation arangodb stack deployed for the environment
#
# EXAMPLES:
#   ./scripts/arango-tunnel.sh
#   ./scripts/arango-tunnel.sh dev
#   ./scripts/arango-tunnel.sh prod
# ==============================================================================
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

ENVIRONMENT=${1:-dev}
PROJECT_NAME="cell-kn"
AWS_REGION="us-east-1"
STACK_NAME="${PROJECT_NAME}-${ENVIRONMENT}-arangodb"
LOCAL_PORT="8530"
REMOTE_PORT="8529"

# Validate environment
if [[ ! "$ENVIRONMENT" =~ ^(dev|sandbox|prod)$ ]]; then
  echo -e "${RED}Error: Environment must be dev, sandbox, or prod${NC}"
  exit 1
fi

echo "==> Looking up ArangoDB instance from stack: ${STACK_NAME}..."

INSTANCE_ID=$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --region "$AWS_REGION" \
  --query 'Stacks[0].Outputs[?OutputKey==`InstanceId`].OutputValue' \
  --output text 2>/dev/null) || {
  echo -e "${RED}Error: Could not read stack outputs from ${STACK_NAME}.${NC}"
  echo "Make sure the arangodb stack is deployed for environment '${ENVIRONMENT}'."
  exit 1
}

if [ -z "$INSTANCE_ID" ]; then
  echo -e "${RED}Error: InstanceId output not found in stack ${STACK_NAME}.${NC}"
  exit 1
fi

echo "  EC2 Instance:  $INSTANCE_ID"

echo ""
echo "==> Fetching ArangoDB password from Secrets Manager..."

SECRET_ID="/${PROJECT_NAME}/${ENVIRONMENT}/secrets/arangodb-password"
ARANGO_PASSWORD=$(aws secretsmanager get-secret-value \
  --secret-id "$SECRET_ID" \
  --query 'SecretString' \
  --output text \
  --region "$AWS_REGION" \
  --profile "$AWS_PROFILE" 2>/dev/null) || {
  echo -e "${RED}Error: Could not fetch secret '${SECRET_ID}'.${NC}"
  exit 1
}

echo ""
echo -e "${GREEN}==> Tunnel info${NC}"
echo "  Instance:   $INSTANCE_ID"
echo "  Forwarding: localhost:${LOCAL_PORT} → instance:${REMOTE_PORT}"
echo ""
echo -e "${CYAN}  ArangoDB password: ${ARANGO_PASSWORD}${NC}"
echo ""
echo "  Web UI:  http://localhost:${LOCAL_PORT}"
echo "  API:     curl -u \"root:\$ARANGO_PASS\" http://localhost:${LOCAL_PORT}/_api/version"
echo ""
echo -e "${YELLOW}Starting SSM port-forwarding session... (Ctrl+C to stop)${NC}"
echo ""

aws ssm start-session \
  --target "$INSTANCE_ID" \
  --region "$AWS_REGION" \
  --profile "$AWS_PROFILE" \
  --document-name AWS-StartPortForwardingSession \
  --parameters "{\"portNumber\":[\"${REMOTE_PORT}\"],\"localPortNumber\":[\"${LOCAL_PORT}\"]}"
