#!/bin/bash
# ==============================================================================
# deploy-dataset.sh - Deploy ArangoDB Dataset Version
# ==============================================================================
# Deploys a new ArangoDB dataset version using SSM parameter-based versioning.
# The init container automatically detects version changes and restores only
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
#   4. Forces ArangoDB service restart
#   5. Init container detects version change and restores new dataset
#
# PREREQUISITES:
#   - AWS CLI configured with appropriate credentials
#   - CloudFormation environment stack deployed
#   - Dataset tar.gz file uploaded to S3
#
# EXAMPLES:
#   # Upload dataset to S3
#   aws s3 cp my-data.tar.gz s3://cell-kn-arangodb-data/datasets/2024-02-11-v1.2.3.tar.gz
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
STACK_NAME="${PROJECT_NAME}-${ENVIRONMENT}"

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
  echo "Make sure the environment stack is deployed."
  exit 1
}

CLUSTER=$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --region "$AWS_REGION" \
  --query 'Stacks[0].Outputs[?OutputKey==`EcsClusterName`].OutputValue' \
  --output text 2>/dev/null)

SERVICE=$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --region "$AWS_REGION" \
  --query 'Stacks[0].Outputs[?OutputKey==`ArangoDbServiceName`].OutputValue' \
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

if [ -z "$SSM_PARAMETER" ] || [ -z "$CLUSTER" ] || [ -z "$SERVICE" ]; then
  echo -e "${RED}Error: Could not read required values from stack ${STACK_NAME}.${NC}"
  exit 1
fi

echo "  Environment:   $ENVIRONMENT"
echo "  SSM Parameter: $SSM_PARAMETER"
echo "  ECS Cluster:   $CLUSTER"
echo "  ECS Service:   $SERVICE"
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
echo "==> Restarting ArangoDB service..."
aws ecs update-service \
  --cluster "$CLUSTER" \
  --service "$SERVICE" \
  --force-new-deployment \
  --region "$AWS_REGION" \
  --query 'service.{Status:status,DesiredCount:desiredCount}' \
  --output table

echo ""
echo -e "${GREEN}==> Deployment initiated!${NC}"
echo ""
echo "Monitor deployment:"
echo "  aws ecs describe-services --cluster $CLUSTER --services $SERVICE --region $AWS_REGION"
echo ""
echo "Watch logs:"
echo "  aws logs tail /ecs/${PROJECT_NAME}-${ENVIRONMENT}-arangodb --follow --region $AWS_REGION"
echo ""
echo "Check current version after deployment:"
echo "  aws ssm get-parameter --name $SSM_PARAMETER --query 'Parameter.Value' --output text"
