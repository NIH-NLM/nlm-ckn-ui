#!/bin/bash
# ==============================================================================
# deploy-environment.sh - Deploy Environment Stacks
# ==============================================================================
# Deploys the Cell-KN environment in two phases:
#
#   Phase 1 — Infra stack (cell-kn-<env>):
#     Nested stacks: secrets, security-groups (dev only), ecs-cluster,
#     service-discovery, alb
#     Exports cross-stack values consumed by the service stacks.
#
#   Phase 2 — Service stacks:
#     cell-kn-<env>-frontend  → frontend.yaml  (first: no deps on arangodb/backend)
#     cell-kn-<env>-arangodb  → arangodb.yaml  (slow: up to 20 min EC2 init)
#     cell-kn-<env>-backend   → backend.yaml   (last: depends on arangodb-dns)
#
# Each service stack can be redeployed independently without touching the others.
#
# USAGE:
#   ./scripts/infra/deploy-environment.sh <environment> [--infra-only|--services-only] [--auto-approve]
#
# ARGUMENTS:
#   environment    Environment name: dev, sandbox, or prod
#
# OPTIONS:
#   --infra-only      Deploy only the infra (phase 1) stack
#   --services-only   Deploy only the service (phase 2) stacks
#   --auto-approve    Skip confirmation prompts (useful for CI/CD pipelines)
#   (default: deploy both phases, prompt before each changeset execution)
#
# PREREQUISITES:
#   - Bootstrap stack deployed (./scripts/infra/deploy-account-setup.sh)
#   - Parameters file: cloudformation/parameters/<env>.json
#   - AWS CLI configured with appropriate credentials
#   - Templates bucket in S3 (from bootstrap stack)
# ==============================================================================
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Check arguments
if [ $# -lt 1 ]; then
  echo "Usage: $0 <environment> [--infra-only|--services-only] [--auto-approve]"
  echo "Example: $0 dev"
  echo "Example: $0 dev --services-only"
  echo "Example: $0 dev --auto-approve"
  exit 1
fi

ENVIRONMENT=$1
DEPLOY_MODE=""
AUTO_APPROVE=false

for arg in "${@:2}"; do
  case "$arg" in
    --infra-only|--services-only) DEPLOY_MODE="$arg" ;;
    --auto-approve) AUTO_APPROVE=true ;;
    *) echo -e "${RED}Error: Unknown option: $arg${NC}"
       echo "Valid options: --infra-only, --services-only, --auto-approve"
       exit 1 ;;
  esac
done
PROJECT_NAME="cell-kn"
AWS_REGION=${AWS_REGION:-us-east-1}
PARAMETERS_FILE="cloudformation/parameters/${ENVIRONMENT}.json"

# Change to project root (script lives in scripts/infra/)
cd "$(dirname "$0")/../.."

# Validate environment
if [[ ! "$ENVIRONMENT" =~ ^(dev|sandbox|prod)$ ]]; then
  echo -e "${RED}Error: Environment must be dev, sandbox, or prod${NC}"
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

# Get templates bucket from bootstrap stack
TEMPLATES_BUCKET=$(aws cloudformation describe-stacks \
  --stack-name ${PROJECT_NAME}-bootstrap \
  --region $AWS_REGION \
  --query 'Stacks[0].Outputs[?OutputKey==`TemplatesBucketName`].OutputValue' \
  --output text)

if [ -z "$TEMPLATES_BUCKET" ]; then
  echo -e "${RED}Error: Could not read TemplatesBucketName from ${PROJECT_NAME}-bootstrap stack${NC}"
  echo "Ensure the bootstrap stack is deployed first: ./scripts/infra/deploy-account-setup.sh"
  exit 1
fi

echo -e "${YELLOW}========================================${NC}"
echo -e "${YELLOW}  Deployment Target${NC}"
echo -e "${YELLOW}========================================${NC}"
echo "  Account ID:    $AWS_ACCOUNT_ID"
echo "  Account Alias: $AWS_ACCOUNT_ALIAS"
echo "  IAM Principal: $AWS_IAM_ARN"
echo "  Region:        $AWS_REGION"
echo "  Environment:   $ENVIRONMENT"
echo "  Mode:          ${DEPLOY_MODE:-full (infra + services)}$( [ "$AUTO_APPROVE" = true ] && echo " --auto-approve" )"
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

# Upload all templates to S3 (required for nested stack TemplateURLs)
echo -e "${GREEN}==> Uploading templates to S3${NC}"
aws s3 sync cloudformation/ s3://${TEMPLATES_BUCKET}/ \
  --exclude ".git/*" \
  --exclude "scripts/*" \
  --exclude "parameters/*" \
  --exclude "*.md" \
  --region $AWS_REGION
echo -e "${GREEN}✓ Templates uploaded${NC}"
echo ""

# ==============================================================================
# Helper: deploy_stack
# Usage: deploy_stack <stack-name> <template-file> <params-json-file>
#   Creates a changeset, shows the diff, prompts for confirmation, then executes.
#   Returns 0 on success, 1 on failure, 2 if no changes.
# ==============================================================================
deploy_stack() {
  local STACK_NAME="$1"
  local TEMPLATE_FILE="$2"
  local PARAMS_FILE="$3"

  echo -e "${BLUE}----------------------------------------${NC}"
  echo -e "${BLUE}  Stack: ${STACK_NAME}${NC}"
  echo -e "${BLUE}----------------------------------------${NC}"

  # Determine if this is a create or update
  local STACK_STATUS
  STACK_STATUS=$(aws cloudformation describe-stacks \
    --stack-name "$STACK_NAME" \
    --region $AWS_REGION \
    --query 'Stacks[0].StackStatus' \
    --output text 2>/dev/null || echo "DOES_NOT_EXIST")

  if [ "$STACK_STATUS" = "DOES_NOT_EXIST" ] || [ "$STACK_STATUS" = "REVIEW_IN_PROGRESS" ]; then
    local CHANGESET_TYPE="CREATE"
  elif [ "$STACK_STATUS" = "ROLLBACK_COMPLETE" ] || [ "$STACK_STATUS" = "CREATE_FAILED" ]; then
    # Stack failed and rolled back (or was left in CREATE_FAILED). Must be deleted before recreating.
    echo -e "${YELLOW}  Stack ${STACK_NAME} is in ${STACK_STATUS}. Deleting before recreating...${NC}"
    aws cloudformation delete-stack --stack-name "$STACK_NAME" --region $AWS_REGION
    echo -e "${YELLOW}  Waiting for deletion...${NC}"
    aws cloudformation wait stack-delete-complete --stack-name "$STACK_NAME" --region $AWS_REGION
    echo -e "${GREEN}  ✓ Deleted. Proceeding with CREATE.${NC}"
    local CHANGESET_TYPE="CREATE"
  elif [[ "$STACK_STATUS" == *"_IN_PROGRESS" ]]; then
    echo -e "${RED}Error: Stack ${STACK_NAME} is in ${STACK_STATUS} state.${NC}"
    echo "Wait for the operation to complete or delete the stuck stack:"
    echo "  aws cloudformation delete-stack --stack-name ${STACK_NAME} --region ${AWS_REGION}"
    echo "  aws cloudformation wait stack-delete-complete --stack-name ${STACK_NAME} --region ${AWS_REGION}"
    return 1
  else
    local CHANGESET_TYPE="UPDATE"
  fi

  local CHANGESET_NAME="${STACK_NAME}-$(date +%Y%m%d%H%M%S)"

  # Create the changeset
  echo -e "${GREEN}  ==> Creating changeset (${CHANGESET_TYPE})...${NC}"
  aws cloudformation create-change-set \
    --stack-name "$STACK_NAME" \
    --change-set-name "$CHANGESET_NAME" \
    --change-set-type "$CHANGESET_TYPE" \
    --template-body "file://${TEMPLATE_FILE}" \
    --capabilities CAPABILITY_IAM CAPABILITY_NAMED_IAM CAPABILITY_AUTO_EXPAND \
    --parameters "file://${PARAMS_FILE}" \
    --region $AWS_REGION

  # Wait for the changeset to finish computing
  echo -e "${GREEN}  ==> Waiting for changeset to be ready...${NC}"
  aws cloudformation wait change-set-create-complete \
    --stack-name "$STACK_NAME" \
    --change-set-name "$CHANGESET_NAME" \
    --region $AWS_REGION 2>/dev/null || true

  # Check changeset status
  local CHANGESET_STATUS CHANGESET_REASON
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
      echo -e "${YELLOW}  No changes to deploy — stack is already up to date.${NC}"
      aws cloudformation delete-change-set \
        --stack-name "$STACK_NAME" \
        --change-set-name "$CHANGESET_NAME" \
        --region $AWS_REGION
      return 2  # no-op exit code
    else
      echo -e "${RED}  ✗ Changeset failed: ${CHANGESET_REASON}${NC}"
      aws cloudformation delete-change-set \
        --stack-name "$STACK_NAME" \
        --change-set-name "$CHANGESET_NAME" \
        --region $AWS_REGION
      return 1
    fi
  fi

  # Print console URL for graphical review
  local CONSOLE_URL="https://${AWS_REGION}.console.aws.amazon.com/cloudformation/home?region=${AWS_REGION}#/stacks/changesets/changes?stackId=${STACK_NAME}&changeSetId=${CHANGESET_NAME}"
  echo ""
  echo -e "${BLUE}  Review changeset in the AWS Console:${NC}"
  echo "  ${CONSOLE_URL}"
  echo ""

  # Warn on any replacements
  local REPLACEMENTS
  REPLACEMENTS=$(aws cloudformation describe-change-set \
    --stack-name "$STACK_NAME" \
    --change-set-name "$CHANGESET_NAME" \
    --region $AWS_REGION \
    --query 'Changes[?ResourceChange.Replacement==`True`].ResourceChange.LogicalResourceId' \
    --output text)

  if [ -n "$REPLACEMENTS" ]; then
    echo -e "${RED}  ⚠  WARNING: The following resources will be REPLACED:${NC}"
    for r in $REPLACEMENTS; do
      echo -e "${RED}     - $r${NC}"
    done
    echo ""
  fi

  # Prompt (skipped with --auto-approve)
  if [ "$AUTO_APPROVE" = true ]; then
    echo -e "${YELLOW}  --auto-approve set, executing changeset without confirmation.${NC}"
  else
    read -r -p "  Execute changeset for ${STACK_NAME}? [y/N] " confirm
    if [[ ! "$confirm" =~ ^[yY]$ ]]; then
      echo "  Aborted. Deleting changeset..."
      aws cloudformation delete-change-set \
        --stack-name "$STACK_NAME" \
        --change-set-name "$CHANGESET_NAME" \
        --region $AWS_REGION
      return 1
    fi
  fi

  # Execute
  echo ""
  echo -e "${GREEN}  ==> Executing changeset...${NC}"
  aws cloudformation execute-change-set \
    --stack-name "$STACK_NAME" \
    --change-set-name "$CHANGESET_NAME" \
    --region $AWS_REGION

  # Wait
  local WAIT_ACTION
  WAIT_ACTION=$(echo "$CHANGESET_TYPE" | tr '[:upper:]' '[:lower:]')
  echo -e "${YELLOW}  Waiting for stack-${WAIT_ACTION}-complete (this may take a few minutes)...${NC}"
  aws cloudformation wait "stack-${WAIT_ACTION}-complete" \
    --stack-name "$STACK_NAME" \
    --region $AWS_REGION

  local FINAL_STATUS
  FINAL_STATUS=$(aws cloudformation describe-stacks \
    --stack-name "$STACK_NAME" \
    --region $AWS_REGION \
    --query 'Stacks[0].StackStatus' \
    --output text)

  if [[ "$FINAL_STATUS" == *"COMPLETE"* ]] && [[ "$FINAL_STATUS" != *"ROLLBACK"* ]]; then
    echo -e "${GREEN}  ✓ ${STACK_NAME} deployed successfully (${FINAL_STATUS})${NC}"
    return 0
  else
    echo -e "${RED}  ✗ ${STACK_NAME} failed with status: ${FINAL_STATUS}${NC}"
    echo "  Check the CloudFormation console for details:"
    echo "  https://console.aws.amazon.com/cloudformation/home?region=${AWS_REGION}#/stacks"
    return 1
  fi
}

# Temp directory for all parameter files - cleaned up on exit
TMPDIR_PARAMS=$(mktemp -d /tmp/cfn-params-XXXXXX)
trap 'rm -rf "$TMPDIR_PARAMS"' EXIT

# ==============================================================================
# Helper: make_params_file
# Writes a temporary parameters JSON file and prints its path.
# Usage: PARAMS_FILE=$(make_params_file key1 val1 key2 val2 ...)
# ==============================================================================
make_params_file() {
  local TMP
  # All temp files go into TMPDIR_PARAMS so the single EXIT trap cleans them up.
  TMP=$(mktemp "${TMPDIR_PARAMS}/params-XXXXXX")
  local json='['
  local first=1
  while [ $# -ge 2 ]; do
    local key="$1" val="$2"
    shift 2
    if [ "$first" = "1" ]; then
      first=0
    else
      json="${json},"
    fi
    # Escape double quotes in value
    val="${val//\"/\\\"}"
    json="${json}{\"ParameterKey\":\"${key}\",\"ParameterValue\":\"${val}\"}"
  done
  json="${json}]"
  echo "$json" > "$TMP"
  echo "$TMP"
}

# ==============================================================================
# Helper: get_sg_id
# In dev: reads from CloudFormation infra stack exports.
# In sandbox/prod: reads from SSM prereqs.
# Usage: SG=$(get_sg_id <sg-key>)
#   sg-key: alb | arangodb | efs | backend
# ==============================================================================
get_sg_id() {
  local SG_KEY="$1"
  local INFRA_STACK="${PROJECT_NAME}-${ENVIRONMENT}"

  if [ "$ENVIRONMENT" = "dev" ]; then
    # Read from CloudFormation export (written by SecurityGroupsStack nested in main.yaml)
    aws cloudformation describe-stacks \
      --stack-name "$INFRA_STACK" \
      --region $AWS_REGION \
      --query "Stacks[0].Outputs[?ExportName=='${PROJECT_NAME}-${ENVIRONMENT}-sg-${SG_KEY}'].OutputValue" \
      --output text
  else
    # Read from SSM prereq
    aws ssm get-parameter \
      --name "/${PROJECT_NAME}/${ENVIRONMENT}/prereqs/sg-${SG_KEY}" \
      --query 'Parameter.Value' \
      --output text \
      --region $AWS_REGION
  fi
}

INFRA_STACK="${PROJECT_NAME}-${ENVIRONMENT}"

# ==============================================================================
# Phase 1 — Infra stack
# ==============================================================================
if [ "$DEPLOY_MODE" != "--services-only" ]; then
  echo -e "${YELLOW}=======================================${NC}"
  echo -e "${YELLOW}  Phase 1: Infra Stack${NC}"
  echo -e "${YELLOW}=======================================${NC}"
  echo ""

  # Build params: read from parameters file + inject TemplatesBucketName
  INFRA_PARAMS_FILE=$(mktemp "${TMPDIR_PARAMS}/params-XXXXXX")

  python3 -c "
import json, sys
params = json.load(open('${PARAMETERS_FILE}'))
params.append({'ParameterKey': 'TemplatesBucketName', 'ParameterValue': '${TEMPLATES_BUCKET}'})
print(json.dumps(params))
" > "$INFRA_PARAMS_FILE"

  deploy_stack \
    "$INFRA_STACK" \
    "cloudformation/environment/main.yaml" \
    "$INFRA_PARAMS_FILE" || true
  INFRA_RESULT=$?

  if [ "$INFRA_RESULT" = "1" ]; then
    echo -e "${RED}Infra stack deployment failed or was aborted.${NC}"
    exit 1
  fi

  echo ""
fi

# ==============================================================================
# Phase 2 — Service stacks
# ==============================================================================
if [ "$DEPLOY_MODE" != "--infra-only" ]; then
  echo -e "${YELLOW}=======================================${NC}"
  echo -e "${YELLOW}  Phase 2: Service Stacks${NC}"
  echo -e "${YELLOW}=======================================${NC}"
  echo -e "${YELLOW}  (each can be redeployed independently)${NC}"
  echo ""

  # Resolve security group IDs for this environment
  echo -e "${GREEN}==> Resolving security group IDs for ${ENVIRONMENT}...${NC}"
  if [ "$ENVIRONMENT" = "dev" ]; then
    # SecurityGroupsStack is a nested stack inside the infra stack.
    # Its exports (at account level) use the pattern: ${ProjectName}-${Environment}-<type>-sg-id
    SG_ARANGODB=$(aws cloudformation list-exports \
      --region $AWS_REGION \
      --query "Exports[?Name=='${PROJECT_NAME}-${ENVIRONMENT}-arangodb-sg-id'].Value" \
      --output text)
    SG_BACKEND=$(aws cloudformation list-exports \
      --region $AWS_REGION \
      --query "Exports[?Name=='${PROJECT_NAME}-${ENVIRONMENT}-backend-sg-id'].Value" \
      --output text)
  else
    SG_ARANGODB=$(aws ssm get-parameter \
      --name "/${PROJECT_NAME}/${ENVIRONMENT}/prereqs/sg-arangodb" \
      --query 'Parameter.Value' --output text --region $AWS_REGION)
    SG_BACKEND=$(aws ssm get-parameter \
      --name "/${PROJECT_NAME}/${ENVIRONMENT}/prereqs/sg-backend" \
      --query 'Parameter.Value' --output text --region $AWS_REGION)
  fi

  # Validate we got values
  if [ -z "$SG_ARANGODB" ] || [ -z "$SG_BACKEND" ]; then
    echo -e "${RED}Error: Could not resolve one or more security group IDs.${NC}"
    echo "  SG_ARANGODB: ${SG_ARANGODB:-(empty)}"
    echo "  SG_BACKEND:  ${SG_BACKEND:-(empty)}"
    if [ "$ENVIRONMENT" = "dev" ]; then
      echo "Make sure the infra stack (Phase 1) is deployed and the SecurityGroupsStack nested stack exported these values."
    else
      echo "Make sure the SSM prereqs are created for ${ENVIRONMENT}."
    fi
    exit 1
  fi

  echo "  sg-arangodb: $SG_ARANGODB"
  echo "  sg-backend:  $SG_BACKEND"
  echo ""

  # IAM role ARNs for backend (empty in dev, from SSM in sandbox/prod)
  if [ "$ENVIRONMENT" = "dev" ]; then
    BACKEND_EXEC_ARN=""
    BACKEND_TASK_ARN=""
    ARANGO_INSTANCE_PROFILE_ARN=""
  else
    BACKEND_EXEC_ARN=$(aws ssm get-parameter \
      --name "/${PROJECT_NAME}/${ENVIRONMENT}/prereqs/iam-backend-exec-arn" \
      --query 'Parameter.Value' --output text --region $AWS_REGION)
    BACKEND_TASK_ARN=$(aws ssm get-parameter \
      --name "/${PROJECT_NAME}/${ENVIRONMENT}/prereqs/iam-backend-task-arn" \
      --query 'Parameter.Value' --output text --region $AWS_REGION)
    ARANGO_INSTANCE_PROFILE_ARN=$(aws ssm get-parameter \
      --name "/${PROJECT_NAME}/${ENVIRONMENT}/prereqs/iam-arangodb-instance-profile-arn" \
      --query 'Parameter.Value' --output text --region $AWS_REGION)
  fi

  # Read ArangoDbUser from parameters file
  ARANGO_USER=$(python3 -c "
import json
params = json.load(open('${PARAMETERS_FILE}'))
match = [p['ParameterValue'] for p in params if p['ParameterKey'] == 'ArangoDbUser']
print(match[0] if match else 'root')
")

  # ────────────────────────────────────────────────
  # 2a. Frontend stack — no dependency on arangodb/backend,
  #     deploy first so the site is accessible sooner
  # ────────────────────────────────────────────────
  FRONTEND_PARAMS_FILE=$(make_params_file \
    ProjectName "$PROJECT_NAME" \
    Environment "$ENVIRONMENT")

  deploy_stack \
    "${PROJECT_NAME}-${ENVIRONMENT}-frontend" \
    "cloudformation/environment/frontend.yaml" \
    "$FRONTEND_PARAMS_FILE" || true
  FRONTEND_RESULT=$?

  if [ "$FRONTEND_RESULT" = "1" ]; then
    echo -e "${RED}Frontend stack deployment failed or was aborted.${NC}"
    exit 1
  fi

  echo ""

  # ────────────────────────────────────────────────
  # 2b. ArangoDB stack (EC2 + EBS)
  # ────────────────────────────────────────────────
  ARANGO_PARAMS_FILE=$(make_params_file \
    ProjectName "$PROJECT_NAME" \
    Environment "$ENVIRONMENT" \
    ArangoDbSecurityGroupId "$SG_ARANGODB" \
    ArangoDbUser "$ARANGO_USER" \
    InstanceProfileArn "$ARANGO_INSTANCE_PROFILE_ARN")

  deploy_stack \
    "${PROJECT_NAME}-${ENVIRONMENT}-arangodb" \
    "cloudformation/environment/arangodb.yaml" \
    "$ARANGO_PARAMS_FILE" || true
  ARANGO_RESULT=$?

  if [ "$ARANGO_RESULT" = "1" ]; then
    echo -e "${RED}ArangoDB stack deployment failed or was aborted.${NC}"
    exit 1
  fi

  if [ "$ARANGO_RESULT" != "2" ]; then
    ARANGO_INSTANCE_ID=$(aws cloudformation describe-stacks \
      --stack-name "${PROJECT_NAME}-${ENVIRONMENT}-arangodb" \
      --region $AWS_REGION \
      --query 'Stacks[0].Outputs[?OutputKey==`InstanceId`].OutputValue' \
      --output text 2>/dev/null || echo "")

    if [ -n "$ARANGO_INSTANCE_ID" ]; then
      ARANGO_URL=$(aws cloudformation describe-stacks \
        --stack-name "${PROJECT_NAME}-${ENVIRONMENT}" \
        --region $AWS_REGION \
        --query 'Stacks[0].Outputs[?OutputKey==`ArangoDbUrl`].OutputValue' \
        --output text 2>/dev/null || echo "")

      echo -e "${GREEN}  ArangoDB links:${NC}"
      [ -n "$ARANGO_URL" ] && echo "    Web UI:        ${ARANGO_URL}/_db/_system/_admin/aardvark/index.html"
      echo "    EC2 instance:  https://${AWS_REGION}.console.aws.amazon.com/ec2/home?region=${AWS_REGION}#Instances:instanceId=${ARANGO_INSTANCE_ID}"
      echo "    Session Mgr:   https://${AWS_REGION}.console.aws.amazon.com/systems-manager/session-manager/${ARANGO_INSTANCE_ID}?region=${AWS_REGION}"
      echo "    Logs:          https://${AWS_REGION}.console.aws.amazon.com/cloudwatch/home?region=${AWS_REGION}#logsV2:log-groups/log-group/\$252Fec2\$252F${PROJECT_NAME}-${ENVIRONMENT}-arangodb"
    fi
  fi

  echo ""

  # ────────────────────────────────────────────────
  # 2c. Backend stack (depends on arangodb-dns export)
  # ────────────────────────────────────────────────
  BACKEND_PARAMS_FILE=$(make_params_file \
    ProjectName      "$PROJECT_NAME" \
    Environment      "$ENVIRONMENT" \
    BackendSecurityGroupId "$SG_BACKEND" \
    TaskExecutionRoleArn   "$BACKEND_EXEC_ARN" \
    TaskRoleArn            "$BACKEND_TASK_ARN")

  deploy_stack \
    "${PROJECT_NAME}-${ENVIRONMENT}-backend" \
    "cloudformation/environment/backend.yaml" \
    "$BACKEND_PARAMS_FILE" || true
  BACKEND_RESULT=$?

  if [ "$BACKEND_RESULT" = "1" ]; then
    echo -e "${RED}Backend stack deployment failed or was aborted.${NC}"
    exit 1
  fi

  echo ""
fi

# ==============================================================================
# Summary
# ==============================================================================
echo -e "${BLUE}========================================${NC}"
echo -e "${GREEN}✓ Deployment Complete!${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

if [ "$DEPLOY_MODE" != "--infra-only" ]; then
  FRONTEND_URL=$(aws cloudformation describe-stacks \
    --stack-name "${PROJECT_NAME}-${ENVIRONMENT}-frontend" \
    --region $AWS_REGION \
    --query 'Stacks[0].Outputs[?OutputKey==`FrontendUrl`].OutputValue' \
    --output text 2>/dev/null || echo "(not yet deployed)")

  FRONTEND_BUCKET=$(aws cloudformation describe-stacks \
    --stack-name "${PROJECT_NAME}-${ENVIRONMENT}-frontend" \
    --region $AWS_REGION \
    --query 'Stacks[0].Outputs[?OutputKey==`BucketName`].OutputValue' \
    --output text 2>/dev/null || echo "")

  CF_ID=$(aws cloudformation describe-stacks \
    --stack-name "${PROJECT_NAME}-${ENVIRONMENT}-frontend" \
    --region $AWS_REGION \
    --query 'Stacks[0].Outputs[?OutputKey==`CloudFrontDistributionId`].OutputValue' \
    --output text 2>/dev/null || echo "")

  BACKEND_URL=$(aws cloudformation describe-stacks \
    --stack-name "$INFRA_STACK" \
    --region $AWS_REGION \
    --query 'Stacks[0].Outputs[?OutputKey==`BackendUrl`].OutputValue' \
    --output text 2>/dev/null || echo "(not yet deployed)")

  echo -e "${GREEN}Application URLs:${NC}"
  echo "  Frontend: $FRONTEND_URL"
  echo "  Backend:  $BACKEND_URL"
  echo ""
  echo -e "${YELLOW}Next steps:${NC}"
  echo "1. Build and push backend Docker image:"
  echo "   ./scripts/app/deploy-backend.sh ${ENVIRONMENT}"
  echo ""
  echo "2. Build and deploy frontend:"
  echo "   cd react && npm run build"
  echo "   aws s3 sync build/ s3://${FRONTEND_BUCKET}/ --delete"
  echo "   aws cloudfront create-invalidation --distribution-id ${CF_ID} --paths \"/*\""
  echo ""
  echo "3. (Optional) Deploy dataset:"
  echo "   ./scripts/app/deploy-dataset.sh ${ENVIRONMENT} datasets/your-file.tar.gz"
fi
