#!/bin/bash
# ==============================================================================
# push-backend-image.sh - Build and push backend image to ECR
# ==============================================================================
# Builds the backend Docker image and pushes it to ECR. Does NOT require the
# environment stack to be deployed — use this before deploying an environment
# for the first time so ECS tasks start healthy immediately.
#
# For subsequent deploys (build + push + ECS service update), use deploy-backend.sh.
#
# USAGE:
#   ./scripts/push-backend-image.sh
#
# ENVIRONMENT VARIABLES:
#   AWS_REGION    AWS region (default: us-east-1)
#   IMAGE_TAG     Override the git SHA tag (optional, e.g. for CI pipelines)
# ==============================================================================
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

PROJECT_NAME="cell-kn"
AWS_REGION=${AWS_REGION:-us-east-1}

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

# Read ECR URL from SSM (written by scripts/infra/deploy-account-setup.sh)
ECR_REPO=$(aws ssm get-parameter \
  --name "/${PROJECT_NAME}/shared/ecr-url" \
  --query 'Parameter.Value' \
  --output text \
  --region "$AWS_REGION" 2>/dev/null) || {
  echo -e "${RED}Error: Could not read ECR URL from SSM (/${PROJECT_NAME}/shared/ecr-url).${NC}"
  echo "Run ./scripts/infra/deploy-account-setup.sh first."
  exit 1
}

FULL_IMAGE_URI="${ECR_REPO}:${IMAGE_TAG}"

echo "  ECR Repository: $ECR_REPO"
echo "  Image Tag:      $IMAGE_TAG"
echo "  Full Image URI: $FULL_IMAGE_URI"
echo ""

# Login to ECR
echo -e "${GREEN}Logging in to Amazon ECR...${NC}"
aws ecr get-login-password --region "$AWS_REGION" | \
  docker login --username AWS --password-stdin "$ECR_REPO"

# Check if this image tag already exists in ECR
if aws ecr describe-images \
    --repository-name "$(echo "$ECR_REPO" | sed 's|.*/||')" \
    --image-ids imageTag="$IMAGE_TAG" \
    --region "$AWS_REGION" \
    --no-cli-pager \
    > /dev/null 2>&1; then
  echo -e "${YELLOW}Image ${FULL_IMAGE_URI} already exists in ECR - skipping build and push.${NC}"
else
  echo -e "\n${GREEN}Building Docker image...${NC}"
  docker build --platform linux/amd64 -t "$FULL_IMAGE_URI" .

  echo -e "\n${GREEN}Pushing image to ECR...${NC}"
  docker push "$FULL_IMAGE_URI"
  echo -e "${GREEN}✓ Image pushed: ${FULL_IMAGE_URI}${NC}"
fi

# Also tag as latest so the environment stack's placeholder reference resolves
echo -e "\n${GREEN}Tagging as latest...${NC}"
docker tag "$FULL_IMAGE_URI" "${ECR_REPO}:latest"
docker push "${ECR_REPO}:latest"

echo -e "\n${GREEN}✓ Done. You can now run:${NC}"
echo "   ./scripts/infra/deploy-environment.sh <environment>"
