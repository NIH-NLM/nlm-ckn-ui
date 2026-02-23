#!/bin/bash
# ==============================================================================
# deploy-backend.sh - Deploy Backend Application
# ==============================================================================
# Builds the backend Docker image, pushes to ECR with an immutable git SHA tag,
# registers a new ECS task definition revision, and updates the ECS service.
#
# USAGE:
#   ./scripts/deploy-backend.sh <environment>
#
# ARGUMENTS:
#   environment    Environment name: dev, sandbox, or prod
#
# WHAT IT DOES:
#   1. Reads ECR URL and ECS names from SSM / CloudFormation stack outputs
#   2. Determines image tag from git commit SHA (immutable)
#   3. Logs in to Amazon ECR
#   4. Builds Docker image from project root
#   5. Tags image with git SHA (e.g. abc1234) - never overwrites an existing tag
#   6. Pushes to ECR
#   7. Stores the active image tag in SSM (/${ProjectName}/${Environment}/backend/image-tag)
#   8. Registers a new ECS task definition revision with the specific image URI
#   9. Updates ECS service to use the new task definition
#  10. Waits for service to stabilize
#
# PREREQUISITES:
#   - AWS CLI configured with appropriate credentials
#   - Docker installed and running
#   - CloudFormation environment stack deployed
#   - Dockerfile in project root
#   - git available (used to determine image tag)
#
# ENVIRONMENT VARIABLES:
#   AWS_REGION    AWS region (default: us-east-1)
#   IMAGE_TAG     Override the git SHA tag (optional, e.g. for CI pipelines)
#
# ROLLBACK:
#   List recent image tags (most recent first):
#     aws ecr describe-images \
#       --repository-name cell-kn-backend \
#       --query 'sort_by(imageDetails,&imagePushedAt)[-10:].imageTags[0]' \
#       --output table
#
#   Deploy a specific tag:
#     IMAGE_TAG=abc1234 ./scripts/deploy-backend.sh <environment>
#
# MONITORING:
#   Watch logs:
#     aws logs tail /ecs/cell-kn-<env>-backend --follow
#
#   Check service status:
#     aws ecs describe-services \
#       --cluster cell-kn-<env>-cluster \
#       --services cell-kn-<env>-backend
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

# Change to project root (script lives in scripts/)
cd "$(dirname "$0")/.."

# Determine image tag (immutable git SHA, overridable for CI)
if [ -n "$IMAGE_TAG" ]; then
  echo -e "${YELLOW}Using provided IMAGE_TAG: $IMAGE_TAG${NC}"
else
  IMAGE_TAG=$(git rev-parse --short HEAD 2>/dev/null) || {
    echo -e "${RED}Error: Could not determine git SHA. Are you in a git repository?${NC}"
    echo "Set IMAGE_TAG environment variable to override."
    exit 1
  }
fi

echo -e "${GREEN}Getting infrastructure details from CloudFormation / SSM...${NC}"

# Read ECR URL from SSM (written by shared-resources stack)
ECR_REPO=$(aws ssm get-parameter \
  --name "/${PROJECT_NAME}/shared/ecr-url" \
  --query 'Parameter.Value' \
  --output text \
  --region "$AWS_REGION" 2>/dev/null) || {
  echo -e "${RED}Error: Could not read ECR URL from SSM (/${PROJECT_NAME}/shared/ecr-url).${NC}"
  echo "Make sure the shared-resources stack is deployed."
  exit 1
}

# Read service name from the backend service stack (cell-kn-<env>-backend)
BACKEND_STACK="${PROJECT_NAME}-${ENVIRONMENT}-backend"
SERVICE_NAME=$(aws cloudformation describe-stacks \
  --stack-name "$BACKEND_STACK" \
  --region "$AWS_REGION" \
  --query 'Stacks[0].Outputs[?OutputKey==`ServiceName`].OutputValue' \
  --output text 2>/dev/null) || SERVICE_NAME=""

# Read ECS cluster name from the infra stack exports (set by ecs-cluster.yaml nested stack)
ECS_CLUSTER=$(aws cloudformation list-exports \
  --region "$AWS_REGION" \
  --query "Exports[?Name=='${PROJECT_NAME}-${ENVIRONMENT}-cluster-name'].Value" \
  --output text 2>/dev/null) || ECS_CLUSTER=""

TASK_FAMILY="${PROJECT_NAME}-${ENVIRONMENT}-backend"

if [ -z "$ECR_REPO" ] || [ -z "$ECS_CLUSTER" ] || [ -z "$SERVICE_NAME" ]; then
  echo -e "${RED}Error: Could not read required values.${NC}"
  echo "  ECR Repo:    ${ECR_REPO:-(empty)} — needs shared stack deployed"
  echo "  ECS Cluster: ${ECS_CLUSTER:-(empty)} — needs infra stack (cell-kn-${ENVIRONMENT}) deployed"
  echo "  ECS Service: ${SERVICE_NAME:-(empty)} — needs backend stack (${BACKEND_STACK}) deployed"
  exit 1
fi

FULL_IMAGE_URI="${ECR_REPO}:${IMAGE_TAG}"

echo "  ECR Repository: $ECR_REPO"
echo "  ECS Cluster:    $ECS_CLUSTER"
echo "  ECS Service:    $SERVICE_NAME"
echo "  Task Family:    $TASK_FAMILY"
echo "  Image Tag:      $IMAGE_TAG"
echo "  Full Image URI: $FULL_IMAGE_URI"
echo "  AWS Region:     $AWS_REGION"

# Login to ECR
echo -e "\n${GREEN}Logging in to Amazon ECR...${NC}"
aws ecr get-login-password --region "$AWS_REGION" | \
  docker login --username AWS --password-stdin "$ECR_REPO"

# Check if this image tag already exists in ECR (immutability guard)
if aws ecr describe-images \
    --repository-name "$(echo "$ECR_REPO" | sed 's|.*/||')" \
    --image-ids imageTag="$IMAGE_TAG" \
    --region "$AWS_REGION" \
    --no-cli-pager \
    > /dev/null 2>&1; then
  echo -e "${YELLOW}Image ${FULL_IMAGE_URI} already exists in ECR - skipping build and push.${NC}"
  echo -e "${YELLOW}To force a rebuild, commit new changes or set IMAGE_TAG to a different value.${NC}"
else
  # Build Docker image
  # Explicitly target linux/amd64 — ECS Fargate runs on x86_64.
  # Required when building on ARM64 hosts (Apple M-series).
  echo -e "\n${GREEN}Building Docker image (linux/amd64)...${NC}"
  docker build --platform linux/amd64 -t "$FULL_IMAGE_URI" .

  # Push to ECR
  echo -e "\n${GREEN}Pushing image to ECR...${NC}"
  docker push "$FULL_IMAGE_URI"
  echo -e "${GREEN}✓ Image pushed: ${FULL_IMAGE_URI}${NC}"
fi

# Store the active image tag in SSM (for auditability and rollback reference)
SSM_IMAGE_TAG_PARAM="/${PROJECT_NAME}/${ENVIRONMENT}/backend/image-tag"
echo -e "\n${GREEN}Storing active image tag in SSM (${SSM_IMAGE_TAG_PARAM})...${NC}"
aws ssm put-parameter \
  --name "$SSM_IMAGE_TAG_PARAM" \
  --value "$IMAGE_TAG" \
  --type String \
  --overwrite \
  --region "$AWS_REGION" \
  --no-cli-pager

# Fetch the current task definition and register a new revision with the new image URI
echo -e "\n${GREEN}Registering new task definition revision with image ${IMAGE_TAG}...${NC}"

CURRENT_TASK_DEF=$(aws ecs describe-task-definition \
  --task-definition "$TASK_FAMILY" \
  --region "$AWS_REGION" \
  --query 'taskDefinition' \
  --output json)

# Build new task definition JSON with updated image URI
NEW_TASK_DEF=$(echo "$CURRENT_TASK_DEF" | python3 -c "
import json, sys
td = json.load(sys.stdin)
# Update image in the backend container
for c in td.get('containerDefinitions', []):
    if c.get('name') == 'backend':
        c['image'] = '${FULL_IMAGE_URI}'
        break
# Remove fields that cannot be included in register-task-definition
for key in ['taskDefinitionArn', 'revision', 'status', 'requiresAttributes',
            'compatibilities', 'registeredAt', 'registeredBy']:
    td.pop(key, None)
print(json.dumps(td))
")

NEW_TASK_DEF_ARN=$(aws ecs register-task-definition \
  --cli-input-json "$NEW_TASK_DEF" \
  --region "$AWS_REGION" \
  --query 'taskDefinition.taskDefinitionArn' \
  --output text \
  --no-cli-pager)

echo -e "${GREEN}✓ Registered: $NEW_TASK_DEF_ARN${NC}"

# Update ECS service to use the new task definition revision
echo -e "\n${GREEN}Updating ECS service to use new task definition...${NC}"
aws ecs update-service \
  --cluster "$ECS_CLUSTER" \
  --service "$SERVICE_NAME" \
  --task-definition "$NEW_TASK_DEF_ARN" \
  --region "$AWS_REGION" \
  --no-cli-pager

echo -e "\n${GREEN}✓ Deployment initiated successfully!${NC}"
echo -e "${YELLOW}Monitoring deployment status...${NC}"
echo -e "${YELLOW}(Press Ctrl+C to exit monitoring, deployment will continue)${NC}\n"

# Wait for service to stabilize
aws ecs wait services-stable \
  --cluster "$ECS_CLUSTER" \
  --services "$SERVICE_NAME" \
  --region "$AWS_REGION"

echo -e "\n${GREEN}✓ Service is stable and running!${NC}"

# Show service info
echo -e "\n${GREEN}Service Status:${NC}"
aws ecs describe-services \
  --cluster "$ECS_CLUSTER" \
  --services "$SERVICE_NAME" \
  --region "$AWS_REGION" \
  --query 'services[0].{Status:status,Desired:desiredCount,Running:runningCount,Pending:pendingCount,TaskDef:taskDefinition}' \
  --output table

# Show backend URL from infra stack outputs (BackendUrl lives in cell-kn-<env>)
INFRA_STACK="${PROJECT_NAME}-${ENVIRONMENT}"
BACKEND_URL=$(aws cloudformation describe-stacks \
  --stack-name "$INFRA_STACK" \
  --region "$AWS_REGION" \
  --query 'Stacks[0].Outputs[?OutputKey==`BackendUrl`].OutputValue' \
  --output text 2>/dev/null)

echo -e "\n${GREEN}Backend URL:  $BACKEND_URL${NC}"
echo -e "${GREEN}Image Tag:    $IMAGE_TAG${NC}"
echo -e "${GREEN}Full Image:   $FULL_IMAGE_URI${NC}"
