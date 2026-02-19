#!/bin/bash
# ==============================================================================
# backup-arangodb.sh - Create ArangoDB Backup
# ==============================================================================
# Creates a backup of ArangoDB data and uploads it to S3.
# Uses ECS Exec to create a tar.gz archive inside the ArangoDB container.
#
# USAGE:
#   ./scripts/backup-arangodb.sh <environment> [backup-name]
#
# ARGUMENTS:
#   environment    Environment name: dev, sandbox, or prod
#   backup-name    Optional. Name for the backup file
#                  Default: arangodb-backup-YYYYMMDD-HHMMSS
#
# WHAT IT DOES:
#   1. Reads ECS cluster/service names from CloudFormation stack outputs
#   2. Reads S3 bucket name from SSM Parameter Store
#   3. Finds the running ArangoDB task
#   4. Executes tar command inside container to create backup archive
#   5. Uploads the archive from the container to S3
#
# PREREQUISITES:
#   - AWS CLI configured with appropriate credentials
#   - CloudFormation environment stack deployed
#   - ECS Exec enabled on the ArangoDB service (see below)
#
# ENABLE ECS EXEC (one-time setup):
#   aws ecs update-service \
#     --cluster cell-kn-<env>-cluster \
#     --service cell-kn-<env>-arangodb \
#     --enable-execute-command
#
# ALTERNATIVE BACKUP METHODS:
#   - Use arangodump for database-level backups
#   - Mount EFS on EC2 instance and tar from there
#   - Use ArangoDB Hot Backups (commercial feature)
#
# RESTORE FROM BACKUP:
#   ./scripts/deploy-dataset.sh <environment> backups/<backup-name>.tar.gz
# ==============================================================================
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check arguments
if [ $# -lt 1 ]; then
  echo "Usage: $0 <environment> [backup-name]"
  echo "Example: $0 dev"
  echo "Example: $0 dev my-backup-name"
  exit 1
fi

ENVIRONMENT=$1
BACKUP_NAME=${2:-"arangodb-backup-$(date +%Y%m%d-%H%M%S)"}
PROJECT_NAME="cell-kn"
AWS_REGION=${AWS_REGION:-us-east-1}
STACK_NAME="${PROJECT_NAME}-${ENVIRONMENT}"

# Validate environment
if [[ ! "$ENVIRONMENT" =~ ^(dev|sandbox|prod)$ ]]; then
  echo -e "${RED}Error: Environment must be dev, sandbox, or prod${NC}"
  exit 1
fi

echo -e "${GREEN}ArangoDB Backup Script${NC}"
echo "  Environment: $ENVIRONMENT"
echo "  Backup Name: $BACKUP_NAME"
echo ""

echo "==> Getting infrastructure details from CloudFormation / SSM..."

# Read ECS cluster name from stack outputs
CLUSTER=$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --region "$AWS_REGION" \
  --query 'Stacks[0].Outputs[?OutputKey==`EcsClusterName`].OutputValue' \
  --output text 2>/dev/null) || {
  echo -e "${RED}Error: Could not read stack outputs from ${STACK_NAME}.${NC}"
  echo "Make sure the environment stack is deployed."
  exit 1
}

SERVICE=$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --region "$AWS_REGION" \
  --query 'Stacks[0].Outputs[?OutputKey==`ArangoDbServiceName`].OutputValue' \
  --output text 2>/dev/null)

# Read S3 bucket name from SSM (written by shared-resources stack)
S3_BUCKET=$(aws ssm get-parameter \
  --name "/${PROJECT_NAME}/shared/arangodb-bucket-name" \
  --query 'Parameter.Value' \
  --output text \
  --region "$AWS_REGION" 2>/dev/null) || {
  echo -e "${RED}Error: Could not read S3 bucket name from SSM.${NC}"
  echo "Make sure the shared-resources stack is deployed."
  exit 1
}

if [ -z "$CLUSTER" ] || [ -z "$SERVICE" ]; then
  echo -e "${RED}Error: Could not read required values from stack ${STACK_NAME}.${NC}"
  exit 1
fi

echo "  ECS Cluster: $CLUSTER"
echo "  ECS Service: $SERVICE"
echo "  S3 Bucket:   $S3_BUCKET"

# Get running ArangoDB task
echo -e "\n${GREEN}Finding ArangoDB task...${NC}"
TASK_ARN=$(aws ecs list-tasks \
    --cluster "$CLUSTER" \
    --service-name "$SERVICE" \
    --desired-status RUNNING \
    --region "$AWS_REGION" \
    --query 'taskArns[0]' \
    --output text)

if [ -z "$TASK_ARN" ] || [ "$TASK_ARN" = "None" ]; then
    echo -e "${RED}Error: No running ArangoDB task found${NC}"
    exit 1
fi

echo "  Task ARN: $TASK_ARN"

# Execute backup command in the container
echo -e "\n${GREEN}Creating backup archive inside container...${NC}"
aws ecs execute-command \
    --cluster "$CLUSTER" \
    --task "$TASK_ARN" \
    --container arangodb \
    --region "$AWS_REGION" \
    --interactive \
    --command "tar -czf /tmp/${BACKUP_NAME}.tar.gz -C / var/lib/arangodb3 var/lib/arangodb3-apps"

# Upload backup from container to S3
echo -e "\n${GREEN}Uploading backup to S3...${NC}"
aws ecs execute-command \
    --cluster "$CLUSTER" \
    --task "$TASK_ARN" \
    --container arangodb \
    --region "$AWS_REGION" \
    --interactive \
    --command "aws s3 cp /tmp/${BACKUP_NAME}.tar.gz s3://${S3_BUCKET}/backups/${BACKUP_NAME}.tar.gz"

echo -e "\n${GREEN}✓ Backup complete!${NC}"
echo "  S3 location: s3://${S3_BUCKET}/backups/${BACKUP_NAME}.tar.gz"
echo ""
echo -e "${YELLOW}To restore from this backup:${NC}"
echo "  ./scripts/deploy-dataset.sh ${ENVIRONMENT} backups/${BACKUP_NAME}.tar.gz"
echo ""
echo -e "${GREEN}Note: For production, consider using ArangoDB's built-in backup tools:${NC}"
echo -e "  - arangodump for database-level backups"
echo -e "  - Hot backups for full data backups"
