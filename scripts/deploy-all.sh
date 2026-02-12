#!/bin/bash
# ==============================================================================
# deploy-all.sh - Full Application Deployment
# ==============================================================================
# Deploys both backend and frontend to AWS in sequence.
#
# USAGE:
#   ./deploy-all.sh
#
# WHAT IT DOES:
#   1. Runs deploy-backend.sh (builds Docker image, pushes to ECR, updates ECS)
#   2. Runs deploy-frontend.sh (builds React app, uploads to S3, invalidates CloudFront)
#
# PREREQUISITES:
#   - AWS CLI configured with appropriate credentials
#   - Docker installed and running
#   - Node.js and npm installed
#   - Terraform infrastructure deployed (terraform apply)
#
# TYPICAL USE CASES:
#   - First time deployment after infrastructure setup
#   - Deploying coordinated backend and frontend changes
#   - Full application updates
#
# INDIVIDUAL DEPLOYMENTS:
#   For faster deployments when only one component changed:
#     ./deploy-backend.sh   # Backend only
#     ./deploy-frontend.sh  # Frontend only
#
# MONITORING:
#   The script shows all application URLs at completion.
#   Watch logs:
#     aws logs tail /ecs/cell-kn-dev-backend --follow
# ==============================================================================
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  Cell-KN Full Deployment to AWS${NC}"
echo -e "${BLUE}========================================${NC}\n"

# Deploy backend
echo -e "${GREEN}Step 1/2: Deploying Backend...${NC}"
$SCRIPT_DIR/deploy-backend.sh

if [ $? -ne 0 ]; then
    echo -e "${RED}Backend deployment failed. Aborting.${NC}"
    exit 1
fi

echo -e "\n${BLUE}----------------------------------------${NC}\n"

# Deploy frontend
echo -e "${GREEN}Step 2/2: Deploying Frontend...${NC}"
$SCRIPT_DIR/deploy-frontend.sh

if [ $? -ne 0 ]; then
    echo -e "${RED}Frontend deployment failed.${NC}"
    exit 1
fi

echo -e "\n${BLUE}========================================${NC}"
echo -e "${GREEN}✓ Full deployment complete!${NC}"
echo -e "${BLUE}========================================${NC}\n"

# Show all URLs
cd $SCRIPT_DIR/../terraform
echo -e "${GREEN}Application URLs:${NC}"
echo -e "  Frontend:  https://$(terraform output -raw cloudfront_domain_name)"
echo -e "  Backend:   $(terraform output -raw backend_url)"
echo -e "  ArangoDB:  $(terraform output -raw arangodb_url)"
echo ""
