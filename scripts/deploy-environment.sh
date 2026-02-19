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
#   environment    Environment name: dev, staging, or prod
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
#   ./deploy-environment.sh staging
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

# Validate environment early (before any AWS calls)
if [[ ! "$ENVIRONMENT" =~ ^(dev|staging|prod)$ ]]; then
  echo -e "${RED}Error: Environment must be dev, staging, or prod${NC}"
  exit 1
fi

# Check parameters file early
if [ ! -f "$PARAMETERS_FILE" ]; then
  echo -e "${RED}Error: Parameters file not found: $PARAMETERS_FILE${NC}"
  echo "Create it from the example:"
  echo "  cp cloudformation/parameters/dev.json.example $PARAMETERS_FILE"
  echo "  # Edit $PARAMETERS_FILE with your values"
  exit 1
fi

# Resolve current AWS identity
AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
AWS_ACCOUNT_ALIAS=$(aws iam list-account-aliases --query 'AccountAliases[0]' --output text 2>/dev/null || echo "(no alias)")
AWS_IAM_ARN=$(aws sts get-caller-identity --query Arn --output text)

TEMPLATES_BUCKET=$(aws cloudformation describe-stacks \
  --stack-name ${PROJECT_NAME}-bootstrap \
  --region $AWS_REGION \
  --query 'Stacks[0].Outputs[?OutputKey==`TemplatesBucketName`].OutputValue' \
  --output text)

if [ -z "$TEMPLATES_BUCKET" ]; then
  echo -e "${RED}Error: Could not read TemplatesBucketName from ${PROJECT_NAME}-bootstrap stack${NC}"
  echo "Ensure the bootstrap stack is deployed first: ./scripts/deploy-bootstrap.sh"
  exit 1
fi

echo -e "${YELLOW}========================================${NC}"
echo -e "${YELLOW}  Deployment Target${NC}"
echo -e "${YELLOW}========================================${NC}"
echo "  Account ID:    $AWS_ACCOUNT_ID"
echo "  Account Alias: $AWS_ACCOUNT_ALIAS"
echo "  IAM Principal: $AWS_IAM_ARN"
echo "  Region:        $AWS_REGION"
echo "  Stack:         ${PROJECT_NAME}-${ENVIRONMENT}"
echo "  Templates:     s3://${TEMPLATES_BUCKET}/"
echo -e "${YELLOW}========================================${NC}"
echo ""

# Validate templates with cfn-lint if available
if command -v cfn-lint &> /dev/null; then
  echo -e "${GREEN}==> Validating templates with cfn-lint${NC}"
  cfn-lint cloudformation/environment/*.yaml cloudformation/bootstrap/*.yaml cloudformation/shared/*.yaml || {
    echo -e "${YELLOW}⚠ cfn-lint found warnings (non-blocking)${NC}"
  }
  echo ""
fi

# Upload templates to S3 (required for nested stack TemplateURLs)
echo -e "${GREEN}==> Uploading templates to S3${NC}"
aws s3 sync cloudformation/ s3://${TEMPLATES_BUCKET}/ \
  --exclude ".git/*" \
  --exclude "scripts/*" \
  --exclude "parameters/*" \
  --exclude "*.md" \
  --region $AWS_REGION
echo -e "${GREEN}✓ Templates uploaded${NC}\n"

# Write parameters to a temp JSON file so comma-containing values (e.g. subnet
# lists) are passed safely without shell word-splitting or CSV ambiguity.
CFN_PARAMS_FILE=$(mktemp /tmp/cfn-params-XXXXXX.json)
trap 'rm -f "$CFN_PARAMS_FILE"' EXIT

python3 -c "
import json, sys
params = json.load(open('${PARAMETERS_FILE}'))
params.append({'ParameterKey': 'TemplatesBucketName', 'ParameterValue': '${TEMPLATES_BUCKET}'})
print(json.dumps(params))
" > "$CFN_PARAMS_FILE"

STACK_NAME="${PROJECT_NAME}-${ENVIRONMENT}"
CHANGESET_NAME="${STACK_NAME}-$(date +%Y%m%d%H%M%S)"

# Determine if this is a create or update
STACK_STATUS=$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --region $AWS_REGION \
  --query 'Stacks[0].StackStatus' \
  --output text 2>/dev/null || echo "DOES_NOT_EXIST")

if [ "$STACK_STATUS" = "DOES_NOT_EXIST" ] || [ "$STACK_STATUS" = "REVIEW_IN_PROGRESS" ]; then
  CHANGESET_TYPE="CREATE"
else
  CHANGESET_TYPE="UPDATE"
fi

# Create the changeset
echo -e "${GREEN}==> Creating changeset (${CHANGESET_TYPE})...${NC}"
aws cloudformation create-change-set \
  --stack-name "$STACK_NAME" \
  --change-set-name "$CHANGESET_NAME" \
  --change-set-type "$CHANGESET_TYPE" \
  --template-body file://cloudformation/environment/main.yaml \
  --capabilities CAPABILITY_IAM CAPABILITY_NAMED_IAM CAPABILITY_AUTO_EXPAND \
  --parameters "file://${CFN_PARAMS_FILE}" \
  --region $AWS_REGION

# Wait for changeset to finish computing
echo -e "${GREEN}==> Waiting for changeset to be ready...${NC}"
aws cloudformation wait change-set-create-complete \
  --stack-name "$STACK_NAME" \
  --change-set-name "$CHANGESET_NAME" \
  --region $AWS_REGION 2>/dev/null || true

# Check changeset status
CHANGESET_STATUS=$(aws cloudformation describe-change-set \
  --stack-name "$STACK_NAME" \
  --change-set-name "$CHANGESET_NAME" \
  --region $AWS_REGION \
  --query 'Status' \
  --output text)

CHANGESET_REASON=$(aws cloudformation describe-change-set \
  --stack-name "$STACK_NAME" \
  --change-set-name "$CHANGESET_NAME" \
  --region $AWS_REGION \
  --query 'StatusReason' \
  --output text 2>/dev/null || echo "")

if [ "$CHANGESET_STATUS" = "FAILED" ]; then
  if echo "$CHANGESET_REASON" | grep -q "The submitted information didn't contain changes"; then
    echo -e "${YELLOW}No changes to deploy — stack is already up to date.${NC}"
    aws cloudformation delete-change-set \
      --stack-name "$STACK_NAME" \
      --change-set-name "$CHANGESET_NAME" \
      --region $AWS_REGION
    exit 0
  else
    echo -e "${RED}✗ Changeset failed: ${CHANGESET_REASON}${NC}"
    aws cloudformation delete-change-set \
      --stack-name "$STACK_NAME" \
      --change-set-name "$CHANGESET_NAME" \
      --region $AWS_REGION
    exit 1
  fi
fi

# Display the changeset
echo ""
echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  Proposed Changes${NC}"
echo -e "${BLUE}========================================${NC}"
aws cloudformation describe-change-set \
  --stack-name "$STACK_NAME" \
  --change-set-name "$CHANGESET_NAME" \
  --region $AWS_REGION \
  --query 'Changes[*].ResourceChange.{Action:Action,Resource:LogicalResourceId,Type:ResourceType,Replace:Replacement}' \
  --output table
echo ""

# Warn on any replacements
REPLACEMENTS=$(aws cloudformation describe-change-set \
  --stack-name "$STACK_NAME" \
  --change-set-name "$CHANGESET_NAME" \
  --region $AWS_REGION \
  --query 'Changes[?ResourceChange.Replacement==`True`].ResourceChange.LogicalResourceId' \
  --output text)

if [ -n "$REPLACEMENTS" ]; then
  echo -e "${RED}⚠  WARNING: The following resources will be REPLACED (deleted and recreated):${NC}"
  for r in $REPLACEMENTS; do
    echo -e "${RED}   - $r${NC}"
  done
  echo ""
fi

read -r -p "Execute this changeset? [y/N] " confirm
if [[ ! "$confirm" =~ ^[yY]$ ]]; then
  echo "Aborted. Deleting changeset..."
  aws cloudformation delete-change-set \
    --stack-name "$STACK_NAME" \
    --change-set-name "$CHANGESET_NAME" \
    --region $AWS_REGION
  exit 0
fi

# Execute the changeset
echo ""
echo -e "${GREEN}==> Executing changeset...${NC}"
echo -e "${YELLOW}This may take 15-20 minutes for nested stacks.${NC}"
echo -e "${YELLOW}IMPORTANT: Stack MUST be deployed in us-east-1 (CloudFront ACM cert requirement)${NC}\n"
aws cloudformation execute-change-set \
  --stack-name "$STACK_NAME" \
  --change-set-name "$CHANGESET_NAME" \
  --region $AWS_REGION

# Wait for completion
WAIT_ACTION=$(echo "$CHANGESET_TYPE" | tr '[:upper:]' '[:lower:]')
aws cloudformation wait "stack-${WAIT_ACTION}-complete" \
  --stack-name "$STACK_NAME" \
  --region $AWS_REGION

FINAL_STATUS=$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --region $AWS_REGION \
  --query 'Stacks[0].StackStatus' \
  --output text)

if [[ "$FINAL_STATUS" == *"COMPLETE"* ]] && [[ "$FINAL_STATUS" != *"ROLLBACK"* ]]; then
  echo -e "\n${GREEN}✓ Environment stack deployed successfully!${NC}\n"

  # Get outputs
  echo -e "${GREEN}Stack Outputs:${NC}"
  aws cloudformation describe-stacks \
    --stack-name "$STACK_NAME" \
    --region $AWS_REGION \
    --query 'Stacks[0].Outputs[*].[OutputKey,OutputValue]' \
    --output table

  FRONTEND_URL=$(aws cloudformation describe-stacks \
    --stack-name "$STACK_NAME" \
    --region $AWS_REGION \
    --query 'Stacks[0].Outputs[?OutputKey==`FrontendUrl`].OutputValue' \
    --output text)

  BACKEND_URL=$(aws cloudformation describe-stacks \
    --stack-name "$STACK_NAME" \
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
  echo "1. Deploy backend Docker image:  ./scripts/deploy-backend.sh ${ENVIRONMENT}"
  echo "2. Deploy frontend:              ./scripts/deploy-frontend.sh ${ENVIRONMENT}"
  echo "3. (Optional) Deploy dataset:    ./scripts/deploy-dataset.sh ${ENVIRONMENT} datasets/your-file.tar.gz"
  echo ""
else
  echo -e "${RED}✗ Deployment failed with status: ${FINAL_STATUS}${NC}"
  echo -e "${YELLOW}Check CloudFormation console for details:${NC}"
  echo "  https://console.aws.amazon.com/cloudformation/home?region=${AWS_REGION}#/stacks"
  exit 1
fi
