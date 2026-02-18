#!/bin/bash
# ==============================================================================
# deploy-bootstrap.sh - Deploy Bootstrap CloudFormation Stack
# ==============================================================================
# Deploys the bootstrap infrastructure: S3 buckets, GitHub OIDC, and IAM roles.
# This is a one-time deployment that sets up the foundation for all other stacks.
#
# USAGE:
#   ./deploy-bootstrap.sh
#
# WHAT IT DOES:
#   1. Deploys bootstrap CloudFormation stack
#   2. Creates S3 bucket for templates
#   3. Creates S3 bucket for state/outputs
#   4. Creates DynamoDB table for deployment locking
#   5. Creates GitHub OIDC provider
#   6. Creates IAM role for GitHub Actions
#
# PREREQUISITES:
#   - AWS CLI configured with appropriate credentials
#   - IAM permissions to create S3, DynamoDB, IAM resources
#
# CONFIGURATION:
#   Edit the variables below to match your setup
# ==============================================================================
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
PROJECT_NAME="cell-kn"
GITHUB_ORG="your-github-org"  # CHANGE THIS
GITHUB_REPO="cell-kn-mvp-ui"
AWS_REGION=${AWS_REGION:-us-east-1}

echo -e "${GREEN}==> Deploying Bootstrap Stack${NC}"
echo "  Project: $PROJECT_NAME"
echo "  GitHub: $GITHUB_ORG/$GITHUB_REPO"
echo "  Region: $AWS_REGION"
echo ""

# Deploy stack
aws cloudformation deploy \
  --template-file cloudformation/bootstrap/bootstrap.yaml \
  --stack-name ${PROJECT_NAME}-bootstrap \
  --capabilities CAPABILITY_IAM CAPABILITY_NAMED_IAM \
  --parameter-overrides \
    ProjectName=$PROJECT_NAME \
    GitHubOrg=$GITHUB_ORG \
    GitHubRepo=$GITHUB_REPO \
  --region $AWS_REGION

if [ $? -eq 0 ]; then
  echo -e "\n${GREEN}✓ Bootstrap stack deployed successfully!${NC}\n"

  # Get outputs
  echo -e "${GREEN}Stack Outputs:${NC}"
  aws cloudformation describe-stacks \
    --stack-name ${PROJECT_NAME}-bootstrap \
    --region $AWS_REGION \
    --query 'Stacks[0].Outputs[*].[OutputKey,OutputValue]' \
    --output table

  echo -e "\n${YELLOW}Next steps:${NC}"
  echo "1. Upload templates to S3:"
  echo "   aws s3 sync cloudformation/ s3://${PROJECT_NAME}-cfn-templates/"
  echo ""
  echo "2. Deploy shared resources:"
  echo "   ./cloudformation/scripts/deploy-shared.sh"
  echo ""
  echo "3. Configure GitHub Actions to use the IAM role (see stack outputs)"
else
  echo -e "${RED}✗ Bootstrap stack deployment failed${NC}"
  exit 1
fi
