#!/bin/bash
# ==============================================================================
# deploy-frontend.sh - Deploy Frontend Application
# ==============================================================================
# Builds the React frontend with the correct API URL and deploys to S3/CloudFront.
#
# USAGE:
#   ./deploy-frontend.sh
#
# WHAT IT DOES:
#   1. Gets ALB DNS name from Terraform
#   2. Builds React app with REACT_APP_API_URL set to backend
#   3. Syncs build files to S3
#   4. Creates CloudFront invalidation
#   5. Shows application URLs
#
# PREREQUISITES:
#   - AWS CLI configured with appropriate credentials
#   - Node.js and npm installed
#   - Terraform infrastructure deployed (terraform apply)
#   - React application in ../react directory
#
# WITH CUSTOM DOMAIN:
#   If using custom domain, React uses relative URLs and doesn't need
#   REACT_APP_API_URL. Just run:
#     npm run build
#     aws s3 sync build/ s3://bucket/ --delete
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

# Change to terraform directory
cd "$(dirname "$0")/../terraform"

echo -e "${GREEN}Getting infrastructure details from Terraform...${NC}"

# Get Terraform outputs
ALB_DNS=$(terraform output -raw alb_dns_name 2>/dev/null)
S3_BUCKET=$(terraform output -raw s3_bucket_name 2>/dev/null)
CF_DIST_ID=$(terraform output -raw cloudfront_distribution_id 2>/dev/null)

if [ -z "$ALB_DNS" ] || [ -z "$S3_BUCKET" ] || [ -z "$CF_DIST_ID" ]; then
    echo -e "${RED}Error: Could not get Terraform outputs. Make sure infrastructure is deployed.${NC}"
    exit 1
fi

echo "  ALB DNS: $ALB_DNS"
echo "  S3 Bucket: $S3_BUCKET"
echo "  CloudFront Distribution: $CF_DIST_ID"

# Build the API URL
API_URL="http://${ALB_DNS}:8000"
echo -e "\n${GREEN}Building frontend with API URL: $API_URL${NC}"

# Change to react directory
cd ../react

# Build the frontend
echo -e "${YELLOW}Running npm install (if needed)...${NC}"
npm install --silent

echo -e "${YELLOW}Building React application...${NC}"
REACT_APP_API_URL=$API_URL npm run build

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

# Get CloudFront URL
CF_URL=$(cd ../terraform && terraform output -raw cloudfront_domain_name)

echo -e "\n${GREEN}✓ Deployment complete!${NC}"
echo -e "\n${GREEN}Frontend URL: https://$CF_URL${NC}"
echo -e "${GREEN}Backend URL: http://$ALB_DNS:8000${NC}"
echo -e "${GREEN}ArangoDB URL: http://$ALB_DNS:8529${NC}"
echo -e "\n${YELLOW}Note: CloudFront invalidation may take a few minutes to propagate.${NC}"
