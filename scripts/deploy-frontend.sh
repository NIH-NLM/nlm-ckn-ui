#!/bin/bash
# ==============================================================================
# deploy-frontend.sh - Deploy Frontend Application
# ==============================================================================
# Builds the React frontend and deploys to S3/CloudFront.
#
# USAGE:
#   ./deploy-frontend.sh <environment>
#
# WHAT IT DOES:
#   1. Gets ALB DNS name from CloudFormation Stack
#   2. Syncs build files to S3
#   3. Creates CloudFront invalidation
#   4. Shows application URLs
#
# PREREQUISITES:
#   - AWS CLI configured with appropriate credentials
#   - Node.js and npm installed
#   - Infrastructure deployed (deploy-environment.sh)
#   - React application in ../react directory
#
#
# ROLLBACK:
#   S3 versioning is enabled. Use AWS Console to restore previous version.
#
# MONITORING:
#   Check invalidation status:
#     aws cloudfront get-invalidation \
#       --distribution-id <DIST_ID> \
#       --id <INVALIDATION_ID>
#
# NOTES:
#   CloudFront invalidation may take a few minutes to propagate globally.
#   Use hard refresh in browser (Ctrl+Shift+R) to bypass local cache.
# ==============================================================================
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color


# Check arguments
if [ $# -ne 1 ]; then
  echo "Usage: $0 <environment>"
  echo "Example: $0 dev"
  exit 1
fi

ENVIRONMENT=$1
PROJECT_NAME="cell-kn"
AWS_REGION=${AWS_REGION:-us-east-1}
STACK_NAME="${PROJECT_NAME}-${ENVIRONMENT}"

# Validate environment
if [[ ! "$ENVIRONMENT" =~ ^(dev|sandbox|prod)$ ]]; then
  echo -e "${RED}Error: Environment must be dev, sandbox, or prod${NC}"
  exit 1
fi

echo -e "${GREEN}Getting infrastructure details from CloudFormation / SSM...${NC}"
# Fetch outputs as "Key=Value" lines
STACK_DATA=$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --region "$AWS_REGION" \
  --query 'Stacks[0].Outputs[?OutputKey==`FrontendBucketName` || OutputKey==`CloudFrontDistributionId` || OutputKey==`FrontendUrl`].[OutputKey,OutputValue]' \
  --output text)

# Check if we got anything back at all
if [ -z "$STACK_DATA" ]; then
  echo -e "${RED}Error: Stack $STACK_NAME not found or has no outputs.${NC}"
  exit 1
fi

# Loop through the lines and assign variables
while read -r key value; do
  declare "$key=$value"
done <<< "$STACK_DATA"

# Map to shorter internal script variables
S3_BUCKET=$FrontendBucketName
CF_DIST_ID=$CloudFrontDistributionId

# Verify critical variables are actually set
: "${S3_BUCKET:?Error: FrontendBucketName output is missing from stack.}"
: "${CF_DIST_ID:?Error: CloudFrontDistributionId output is missing from stack.}"

echo "  S3 Bucket: $S3_BUCKET"
echo "  CloudFront Distribution: $CF_DIST_ID"


# Change to react directory
cd ../react
# Build the frontend
echo -e "${YELLOW}Running npm install (if needed)...${NC}"
npm ci --prefer-offline --no-audit

echo -e "${YELLOW}Building React application...${NC}"
npm run build

if [ ! -d "build" ]; then
    echo -e "${RED}Error: Build directory not found!${NC}"
    exit 1
fi

# Upload to S3
echo -e "\n${GREEN}Uploading to S3: s3://$S3_BUCKET/${NC}"
aws s3 sync build/ s3://$S3_BUCKET/ --delete

# Invalidate CloudFront cache
echo -e "\n${GREEN}Invalidating CloudFront cache...${NC}"
INVALIDATION_ID=$(aws cloudfront create-invalidation \
    --distribution-id $CF_DIST_ID \
    --paths "/*" \
    --query 'Invalidation.Id' \
    --output text)

echo "  Invalidation ID: $INVALIDATION_ID"

echo -e "\n${GREEN}✓ Deployment complete!${NC}"
echo -e "\n${GREEN}Frontend URL: $FrontendUrl${NC}"
echo -e "${GREEN}ArangoDB URL: $FrontendUrl:8529${NC}"
echo -e "\n${YELLOW}Note: CloudFront invalidation may take a few minutes to propagate.${NC}"
