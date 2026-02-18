#!/bin/bash
# ==============================================================================
# deploy-shared.sh - Deploy Shared Resources CloudFormation Stack
# ==============================================================================
# Deploys shared resources (ECR, S3 for datasets) used across all environments.
# This is a one-time deployment.
#
# USAGE:
#   ./deploy-shared.sh
#
# WHAT IT DOES:
#   1. Deploys shared resources CloudFormation stack
#   2. Creates ECR repository for backend Docker images
#   3. Creates S3 bucket for ArangoDB datasets
#   4. Exports stack outputs for use by environment stacks
#   5. Stores outputs in SSM Parameter Store for easy reference
#
# PREREQUISITES:
#   - Bootstrap stack deployed
#   - AWS CLI configured with appropriate credentials
# ==============================================================================
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
PROJECT_NAME="cell-kn"
AWS_REGION=${AWS_REGION:-us-east-1}

echo -e "${GREEN}==> Deploying Shared Resources Stack${NC}"
echo "  Project: $PROJECT_NAME"
echo "  Region: $AWS_REGION"
echo ""

# Deploy stack
aws cloudformation deploy \
  --template-file cloudformation/shared/shared-resources.yaml \
  --stack-name ${PROJECT_NAME}-shared \
  --parameter-overrides \
    ProjectName=$PROJECT_NAME \
  --region $AWS_REGION

if [ $? -eq 0 ]; then
  echo -e "\n${GREEN}✓ Shared resources stack deployed successfully!${NC}\n"

  # Get outputs
  echo -e "${GREEN}Stack Outputs:${NC}"
  aws cloudformation describe-stacks \
    --stack-name ${PROJECT_NAME}-shared \
    --region $AWS_REGION \
    --query 'Stacks[0].Outputs[*].[OutputKey,OutputValue]' \
    --output table

  # Store outputs in SSM for easy reference
  echo -e "\n${YELLOW}Storing outputs in SSM Parameter Store...${NC}"

  ECR_URL=$(aws cloudformation describe-stacks \
    --stack-name ${PROJECT_NAME}-shared \
    --region $AWS_REGION \
    --query 'Stacks[0].Outputs[?OutputKey==`EcrRepositoryUrl`].OutputValue' \
    --output text)

  S3_BUCKET=$(aws cloudformation describe-stacks \
    --stack-name ${PROJECT_NAME}-shared \
    --region $AWS_REGION \
    --query 'Stacks[0].Outputs[?OutputKey==`ArangoDbS3BucketName`].OutputValue' \
    --output text)

  aws ssm put-parameter \
    --name "/${PROJECT_NAME}/shared/ecr-url" \
    --value "$ECR_URL" \
    --type String \
    --overwrite \
    --region $AWS_REGION 2>/dev/null || true

  aws ssm put-parameter \
    --name "/${PROJECT_NAME}/shared/arangodb-bucket-name" \
    --value "$S3_BUCKET" \
    --type String \
    --overwrite \
    --region $AWS_REGION 2>/dev/null || true

  echo "  ✓ ECR URL: $ECR_URL"
  echo "  ✓ S3 Bucket: $S3_BUCKET"

  echo -e "\n${YELLOW}Next steps:${NC}"
  echo "1. Upload templates to S3 (if not done):"
  echo "   aws s3 sync cloudformation/ s3://${PROJECT_NAME}-cfn-templates/"
  echo ""
  echo "2. Deploy environment stack:"
  echo "   ./cloudformation/scripts/deploy-environment.sh dev"
else
  echo -e "${RED}✗ Shared resources stack deployment failed${NC}"
  exit 1
fi
