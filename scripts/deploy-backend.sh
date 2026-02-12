#!/bin/bash
# ==============================================================================
# deploy-backend.sh - Deploy Backend Application
# ==============================================================================
# Builds the backend Docker image, pushes to ECR, and updates the ECS service
# with zero-downtime deployment.
#
# USAGE:
#   ./deploy-backend.sh
#
# WHAT IT DOES:
#   1. Logs in to Amazon ECR
#   2. Builds Docker image from project root
#   3. Tags image with 'latest' and timestamp
#   4. Pushes to ECR
#   5. Forces new ECS deployment
#   6. Waits for service to stabilize
#
# PREREQUISITES:
#   - AWS CLI configured with appropriate credentials
#   - Docker installed and running
#   - Terraform infrastructure deployed (terraform apply)
#   - Dockerfile in project root
#
# ENVIRONMENT VARIABLES:
#   AWS_REGION    AWS region (default: us-east-1)
#
# ROLLBACK:
#   List available images:
#     aws ecr describe-images \
#       --repository-name cell-kn-backend \
#       --query 'sort_by(imageDetails,&imagePushedAt)[-10:].imageTags[0]'
#
#   Update ECS to use specific tag via AWS Console or update task definition
#
# MONITORING:
#   Watch logs:
#     aws logs tail /ecs/cell-kn-dev-backend --follow
#
#   Check service status:
#     aws ecs describe-services \
#       --cluster cell-kn-dev-cluster \
#       --services cell-kn-dev-backend
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
ECR_REPO=$(terraform output -raw ecr_repository_url 2>/dev/null)
ECS_CLUSTER=$(terraform output -raw ecs_cluster_name 2>/dev/null)
AWS_REGION=${AWS_REGION:-us-east-1}

if [ -z "$ECR_REPO" ] || [ -z "$ECS_CLUSTER" ]; then
    echo -e "${RED}Error: Could not get Terraform outputs. Make sure infrastructure is deployed.${NC}"
    exit 1
fi

echo "  ECR Repository: $ECR_REPO"
echo "  ECS Cluster: $ECS_CLUSTER"
echo "  AWS Region: $AWS_REGION"

# Change to project root
cd ..

# Login to ECR
echo -e "\n${GREEN}Logging in to Amazon ECR...${NC}"
aws ecr get-login-password --region $AWS_REGION | \
    docker login --username AWS --password-stdin $ECR_REPO

# Build Docker image
echo -e "\n${GREEN}Building Docker image...${NC}"
docker build -t $ECR_REPO:latest .

if [ $? -ne 0 ]; then
    echo -e "${RED}Error: Docker build failed!${NC}"
    exit 1
fi

# Tag with timestamp for rollback capability
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
docker tag $ECR_REPO:latest $ECR_REPO:$TIMESTAMP

# Push to ECR
echo -e "\n${GREEN}Pushing image to ECR...${NC}"
docker push $ECR_REPO:latest
docker push $ECR_REPO:$TIMESTAMP

echo -e "${GREEN}Image pushed with tags: latest, $TIMESTAMP${NC}"

# Update ECS service
echo -e "\n${GREEN}Updating ECS service...${NC}"

# Get service name from cluster (assumes standard naming)
SERVICE_NAME="${ECS_CLUSTER%-cluster}-backend"

aws ecs update-service \
    --cluster $ECS_CLUSTER \
    --service $SERVICE_NAME \
    --force-new-deployment \
    --region $AWS_REGION \
    --no-cli-pager

if [ $? -eq 0 ]; then
    echo -e "\n${GREEN}✓ Deployment initiated successfully!${NC}"
    echo -e "\n${YELLOW}Monitoring deployment status...${NC}"
    echo -e "${YELLOW}(Press Ctrl+C to exit monitoring, deployment will continue)${NC}\n"

    # Wait for service to stabilize
    aws ecs wait services-stable \
        --cluster $ECS_CLUSTER \
        --services $SERVICE_NAME \
        --region $AWS_REGION

    echo -e "\n${GREEN}✓ Service is stable and running!${NC}"
else
    echo -e "${RED}Error: Failed to update ECS service${NC}"
    exit 1
fi

# Show service info
echo -e "\n${GREEN}Service Status:${NC}"
aws ecs describe-services \
    --cluster $ECS_CLUSTER \
    --services $SERVICE_NAME \
    --region $AWS_REGION \
    --query 'services[0].{Status:status,Desired:desiredCount,Running:runningCount,Pending:pendingCount}' \
    --output table

# Get backend URL
cd terraform
BACKEND_URL=$(terraform output -raw backend_url 2>/dev/null)
echo -e "\n${GREEN}Backend URL: $BACKEND_URL${NC}"
