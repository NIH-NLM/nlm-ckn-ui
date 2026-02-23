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
echo "==> Rebooting ArangoDB EC2 instance ($INSTANCE_ID)..."
aws ssm send-command \
  --instance-ids "$INSTANCE_ID" \
  --document-name "AWS-RunShellScript" \
  --parameters '{"commands":["reboot"]}' \
  --region "$AWS_REGION" \
  --output table \
  --query 'Command.{CommandId:CommandId,Status:Status}'

echo ""
echo -e "${GREEN}==> Deployment initiated!${NC}"
echo -e "${YELLOW}The instance will reboot, restore the new dataset, and restart ArangoDB.${NC}"
echo -e "${YELLOW}This typically takes 5-15 minutes depending on dataset size.${NC}"
echo ""
echo "Monitor instance state:"
echo "  aws ec2 describe-instance-status --instance-ids $INSTANCE_ID --region $AWS_REGION"
echo ""
echo "Watch setup logs (once instance is back up):"
echo "  aws logs tail /ec2/${PROJECT_NAME}-${ENVIRONMENT}-arangodb --follow --region $AWS_REGION"
echo ""
echo "Check current version after deployment:"
echo "  aws ssm get-parameter --name $SSM_PARAMETER --query 'Parameter.Value' --output text"
echo ""
echo "Connect via Session Manager:"
echo "  aws ssm start-session --target $INSTANCE_ID --region $AWS_REGION"
