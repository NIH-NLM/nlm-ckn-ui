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
#   6. Pushes to ECR, and moves the `latest` tag onto the same image
#      (the CloudFormation task definition pulls `latest`)
#   7. If the backend stack is still provisioning, stops here so CloudFormation
#      can pick up the image and finish; otherwise continues:
#   8. Stores the active image tag in SSM (/${ProjectName}/${Environment}/backend/image-tag)
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
#       --repository-name nlm-ckn-backend \
#       --query 'sort_by(imageDetails,&imagePushedAt)[-10:].imageTags[0]' \
#       --output table
#
#   Deploy a specific tag:
#     IMAGE_TAG=abc1234 ./scripts/deploy-backend.sh <environment>
#
# MONITORING:
#   Watch logs:
#     aws logs tail /ecs/nlm-ckn-<env>-backend --follow
#
#   Check service status:
#     aws ecs describe-services \
#       --cluster nlm-ckn-<env>-cluster \
#       --services nlm-ckn-<env>-backend
# ==============================================================================
set -e

# Capture the script dir before any cd so we can find sibling scripts later.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

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
source "$SCRIPT_DIR/../common.sh"
AWS_REGION=${AWS_REGION:-us-east-1}
STACK_NAME="${PROJECT_NAME}-${ENVIRONMENT}"

# Validate environment
if [[ ! "$ENVIRONMENT" =~ ^(dev|stage|sandbox|prod)$ ]]; then
  echo -e "${RED}Error: Environment must be dev, stage, sandbox, or prod${NC}"
  exit 1
fi

# Change to project root (script lives in scripts/app/)
cd "$(dirname "$0")/../.."

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

# The backend stack (nlm-ckn-<env>-backend) creates the ECS service. Its name is
# deterministic and matches the task family, so derive it directly rather than
# reading a CloudFormation output — that output is absent while the stack is
# still provisioning and would resolve to the literal string "None", which then
# slips past the empty-check below and produces "Service not found".
BACKEND_STACK="${PROJECT_NAME}-${ENVIRONMENT}-backend"
SERVICE_NAME="${PROJECT_NAME}-${ENVIRONMENT}-backend"

# Read ECS cluster name from the infra stack exports (set by ecs-cluster.yaml nested stack)
ECS_CLUSTER=$(aws cloudformation list-exports \
  --region "$AWS_REGION" \
  --query "Exports[?Name=='${PROJECT_NAME}-${ENVIRONMENT}-cluster-name'].Value" \
  --output text 2>/dev/null) || ECS_CLUSTER=""

TASK_FAMILY="${PROJECT_NAME}-${ENVIRONMENT}-backend"

if [ -z "$ECR_REPO" ] || [ -z "$ECS_CLUSTER" ] || [ -z "$SERVICE_NAME" ]; then
  echo -e "${RED}Error: Could not read required values.${NC}"
  echo "  ECR Repo:    ${ECR_REPO:-(empty)} — needs shared stack deployed"
  echo "  ECS Cluster: ${ECS_CLUSTER:-(empty)} — needs infra stack (nlm-ckn-${ENVIRONMENT}) deployed"
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
  docker build --platform linux/amd64 --build-arg UI_VERSION="$IMAGE_TAG" -t "$FULL_IMAGE_URI" .

  # Push to ECR
  echo -e "\n${GREEN}Pushing image to ECR...${NC}"
  docker push "$FULL_IMAGE_URI"
  echo -e "${GREEN}✓ Image pushed: ${FULL_IMAGE_URI}${NC}"
fi

# Also move the `latest` tag onto this image. The CloudFormation-managed task
# definition pulls `nlm-ckn-backend:latest`, so a fresh stack CREATE hangs until
# a `latest` exists — pushing only the immutable SHA tag never unblocks it.
# Retag server-side (copy the manifest to the `latest` tag) rather than
# docker pull/tag/push: it works whether or not the build/push above was skipped,
# and it doesn't fail on arm64 hosts (the image is linux/amd64-only, so a local
# `docker pull` of the manifest list has no matching platform).
echo -e "\n${GREEN}Updating 'latest' tag -> ${IMAGE_TAG}...${NC}"
ECR_REPO_NAME="$(echo "$ECR_REPO" | sed 's|.*/||')"
IMAGE_MANIFEST=$(aws ecr batch-get-image \
  --repository-name "$ECR_REPO_NAME" \
  --image-ids imageTag="$IMAGE_TAG" \
  --query 'images[0].imageManifest' \
  --output text \
  --region "$AWS_REGION")
if PUT_OUTPUT=$(aws ecr put-image \
    --repository-name "$ECR_REPO_NAME" \
    --image-tag latest \
    --image-manifest "$IMAGE_MANIFEST" \
    --region "$AWS_REGION" \
    --no-cli-pager 2>&1); then
  echo -e "${GREEN}✓ latest -> ${IMAGE_TAG}${NC}"
elif echo "$PUT_OUTPUT" | grep -q "ImageAlreadyExistsException"; then
  echo -e "${GREEN}✓ latest already points to ${IMAGE_TAG}${NC}"
else
  echo -e "${RED}Error updating 'latest' tag:${NC}"
  echo "$PUT_OUTPUT"
  exit 1
fi

# If the backend stack is still provisioning, CloudFormation owns the ECS service
# and task definition — a hung CREATE just needs the image to exist so its tasks
# can start. Registering a task-def revision or updating the service here would
# fight the in-flight stack, so stop after the push and let CloudFormation finish.
STACK_STATUS=$(aws cloudformation describe-stacks \
  --stack-name "$BACKEND_STACK" \
  --region "$AWS_REGION" \
  --query 'Stacks[0].StackStatus' \
  --output text 2>/dev/null) || STACK_STATUS=""

case "$STACK_STATUS" in
  # Successful, deployable terminal states — the ECS service/task-def exist, so
  # continue to the SSM + ECS rollout below. (UPDATE_ROLLBACK_COMPLETE rolled
  # back to a prior working state, so its resources are usable too.)
  CREATE_COMPLETE|UPDATE_COMPLETE|IMPORT_COMPLETE|UPDATE_ROLLBACK_COMPLETE)
    ;;
  # Empty status means the describe-stacks lookup failed or the stack doesn't
  # exist yet — preserve the prior behavior of falling through.
  "")
    ;;
  # Failed terminal states that also end in _COMPLETE (e.g. ROLLBACK_COMPLETE,
  # DELETE_COMPLETE) or otherwise. The stack has no usable ECS resources, so an
  # SSM/ECS rollout would fight the broken stack or fail confusingly. Stop here.
  ROLLBACK_COMPLETE|ROLLBACK_FAILED|UPDATE_ROLLBACK_FAILED|DELETE_COMPLETE|DELETE_FAILED|CREATE_FAILED|UPDATE_FAILED)
    echo -e "\n${RED}Backend stack ${BACKEND_STACK} is in a failed state (status: ${STACK_STATUS}).${NC}"
    echo -e "${RED}The image has been pushed, but resolve the stack in CloudFormation before deploying application code.${NC}"
    exit 1
    ;;
  # Anything else is a non-terminal, in-progress state — still provisioning.
  *)
    echo -e "\n${YELLOW}Backend stack ${BACKEND_STACK} is not ready (status: ${STACK_STATUS}).${NC}"
    echo -e "${YELLOW}The image has been pushed — CloudFormation will pick it up as it finishes provisioning.${NC}"
    echo -e "${YELLOW}Re-run this script once the stack reaches a *_COMPLETE state to roll out future revisions.${NC}"
    exit 0
    ;;
esac

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

# Show backend URL from infra stack outputs (BackendUrl lives in nlm-ckn-<env>)
INFRA_STACK="${PROJECT_NAME}-${ENVIRONMENT}"
BACKEND_URL=$(aws cloudformation describe-stacks \
  --stack-name "$INFRA_STACK" \
  --region "$AWS_REGION" \
  --query 'Stacks[0].Outputs[?OutputKey==`BackendUrl`].OutputValue' \
  --output text 2>/dev/null)

echo -e "\n${GREEN}Backend URL:  $BACKEND_URL${NC}"
echo -e "${GREEN}Image Tag:    $IMAGE_TAG${NC}"
echo -e "${GREEN}Full Image:   $FULL_IMAGE_URI${NC}"

# Smoke test the deployment through the public edge (advisory — never fails the deploy).
echo -e "\n${GREEN}Running smoke test...${NC}"
"$SCRIPT_DIR/../ops/smoke-test.sh" "$ENVIRONMENT" || \
  echo -e "${YELLOW}Smoke test reported failures (non-blocking).${NC}"
