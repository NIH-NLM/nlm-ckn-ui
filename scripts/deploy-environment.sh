#!/bin/bash
# ==============================================================================
# deploy-environment.sh - Deploy Environment CloudFormation Stack
# ==============================================================================
# Deploys a complete environment (dev/staging/prod) using nested stacks.
#
# USAGE:
#   ./deploy-environment.sh <environment>
#
# ARGUMENTS:
#   environment    Environment name: dev, sandbox, or prod
#
# WHAT IT DOES:
#   1. Validates parameters file exists
#   2. Uploads all templates to S3
#   3. Deploys main orchestrator stack with nested stacks:
#      - Security Groups
#      - ECS Cluster
#      - Service Discovery
#      - Application Load Balancer
#      - ArangoDB (EFS, ECS service, init container)
#      - Backend (ECS service, auto-scaling)
#      - Frontend (S3, CloudFront, ACM)
#
# PREREQUISITES:
#   - Bootstrap stack deployed
#   - Shared resources stack deployed
#   - Parameters file created: cloudformation/parameters/<env>.json
#   - AWS CLI configured with appropriate credentials
#
# EXAMPLES:
#   ./deploy-environment.sh dev
#   ./deploy-environment.sh sandbox
#   ./deploy-environment.sh prod
# ==============================================================================
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
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
PARAMETERS_FILE="cloudformation/parameters/${ENVIRONMENT}.json"
TEMPLATES_BUCKET="${PROJECT_NAME}-cfn-templates"

# Validate environment
if [[ ! "$ENVIRONMENT" =~ ^(dev|sandbox|prod)$ ]]; then
  echo -e "${RED}Error: Environment must be dev, sandbox, or prod${NC}"
  exit 1
fi

# Check parameters file
if [ ! -f "$PARAMETERS_FILE" ]; then
  echo -e "${RED}Error: Parameters file not found: $PARAMETERS_FILE${NC}"
  echo "Create it from the example:"
  echo "  cp cloudformation/parameters/dev.json.example $PARAMETERS_FILE"
  echo "  # Edit $PARAMETERS_FILE with your values"
  exit 1
fi

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  Cell-KN Environment Deployment${NC}"
echo -e "${BLUE}========================================${NC}\n"
echo "  Project: $PROJECT_NAME"
echo "  Environment: $ENVIRONMENT"
echo "  Region: $AWS_REGION"
echo "  Parameters: $PARAMETERS_FILE"
echo ""

# Upload templates to S3
echo -e "${GREEN}==> Uploading templates to S3${NC}"
aws s3 sync cloudformation/ s3://${TEMPLATES_BUCKET}/ \
  --exclude ".git/*" \
  --exclude "scripts/*" \
  --exclude "parameters/*" \
  --exclude "*.md" \
  --region $AWS_REGION

echo -e "${GREEN}✓ Templates uploaded${NC}\n"

# Deploy stack
echo -e "${GREEN}==> Deploying ${ENVIRONMENT} environment stack${NC}"
echo -e "${YELLOW}This will create nested stacks and may take 15-20 minutes...${NC}\n"

aws cloudformation deploy \
  --template-file cloudformation/environment/main.yaml \
  --stack-name ${PROJECT_NAME}-${ENVIRONMENT} \
  --capabilities CAPABILITY_IAM CAPABILITY_NAMED_IAM CAPABILITY_AUTO_EXPAND \
  --parameter-overrides file://${PARAMETERS_FILE} \
  --region $AWS_REGION

if [ $? -eq 0 ]; then
  echo -e "\n${GREEN}✓ Environment stack deployed successfully!${NC}\n"

  # Get outputs
  echo -e "${GREEN}Stack Outputs:${NC}"
  aws cloudformation describe-stacks \
    --stack-name ${PROJECT_NAME}-${ENVIRONMENT} \
    --region $AWS_REGION \
    --query 'Stacks[0].Outputs[*].[OutputKey,OutputValue]' \
    --output table

  # Get key URLs
  FRONTEND_URL=$(aws cloudformation describe-stacks \
    --stack-name ${PROJECT_NAME}-${ENVIRONMENT} \
    --region $AWS_REGION \
    --query 'Stacks[0].Outputs[?OutputKey==`FrontendUrl`].OutputValue' \
    --output text)

  BACKEND_URL=$(aws cloudformation describe-stacks \
    --stack-name ${PROJECT_NAME}-${ENVIRONMENT} \
    --region $AWS_REGION \
    --query 'Stacks[0].Outputs[?OutputKey==`BackendUrl`].OutputValue' \
    --output text)

  echo -e "\n${BLUE}========================================${NC}"
  echo -e "${GREEN}✓ Deployment Complete!${NC}"
  echo -e "${BLUE}========================================${NC}\n"

  echo -e "${GREEN}Application URLs:${NC}"
  echo "  Frontend: $FRONTEND_URL"
  echo "  Backend:  $BACKEND_URL"
  echo ""

  echo -e "${YELLOW}Next steps:${NC}"
  echo "1. Deploy backend Docker image:"
  echo "   cd /path/to/cell-kn-mvp-ui"
  echo "   ./scripts/deploy-backend.sh"
  echo ""
  echo "2. Deploy frontend:"
  echo "   ./scripts/deploy-frontend.sh"
  echo ""
  echo "3. (Optional) Deploy dataset:"
  echo "   ./scripts/deploy-dataset.sh datasets/your-file.tar.gz"
  echo ""

else
  echo -e "${RED}✗ Environment stack deployment failed${NC}"
  echo -e "${YELLOW}Check CloudFormation console for details:${NC}"
  echo "  https://console.aws.amazon.com/cloudformation/home?region=${AWS_REGION}#/stacks"
  exit 1
fi
