#!/bin/bash
# ==============================================================================
# backup-arangodb.sh - Create ArangoDB Backup
# ==============================================================================
# Creates a backup of ArangoDB data and prepares it for S3 upload.
# Uses ECS Exec to create a tar.gz archive inside the ArangoDB container.
#
# USAGE:
#   ./backup-arangodb.sh [backup-name]
#
# ARGUMENTS:
#   backup-name    Optional. Name for the backup file
#                  Default: arangodb-backup-YYYYMMDD-HHMMSS
#
# WHAT IT DOES:
#   1. Finds running ArangoDB task
#   2. Executes tar command inside container to create backup
#   3. Shows manual steps to upload to S3
#
# PREREQUISITES:
#   - AWS CLI configured with appropriate credentials
#   - ECS Exec enabled on the ArangoDB service (requires update)
#   - Terraform infrastructure deployed (terraform apply)
#
# ENABLE ECS EXEC (one-time setup):
#   aws ecs update-service \
#     --cluster cell-kn-dev-cluster \
#     --service cell-kn-dev-arangodb \
#     --enable-execute-command
#
# COMPLETE BACKUP PROCESS:
#   # 1. Run this script
#   ./backup-arangodb.sh my-backup
#
#   # 2. Upload from container to S3
#   aws ecs execute-command \
#     --cluster cell-kn-dev-cluster \
#     --task <TASK_ARN> \
#     --container arangodb \
#     --interactive \
#     --command "aws s3 cp /tmp/my-backup.tar.gz s3://cell-kn-arangodb-data/backups/"
#
# ALTERNATIVE BACKUP METHODS:
#   - Use arangodump for database-level backups
#   - Mount EFS on EC2 instance and tar from there
#   - Use ArangoDB Hot Backups (commercial feature)
#
# RESTORE FROM BACKUP:
#   See VERSIONED_DEPLOYMENTS.md for restore instructions
# ==============================================================================
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Default values
BACKUP_NAME=${1:-"arangodb-backup-$(date +%Y%m%d-%H%M%S)"}

# Change to terraform directory
cd "$(dirname "$0")/../terraform"

echo -e "${GREEN}ArangoDB Backup Script${NC}"

# Get Terraform outputs
S3_BUCKET=$(terraform output -raw s3_arangodb_bucket_name 2>/dev/null)
ECS_CLUSTER=$(terraform output -raw ecs_cluster_name 2>/dev/null)
AWS_REGION=${AWS_REGION:-us-east-1}

if [ -z "$S3_BUCKET" ] || [ -z "$ECS_CLUSTER" ]; then
    echo -e "${RED}Error: Could not get Terraform outputs.${NC}"
    exit 1
fi

echo "  S3 Bucket: $S3_BUCKET"
echo "  Backup Name: $BACKUP_NAME"

# Get running ArangoDB task
SERVICE_NAME="${ECS_CLUSTER%-cluster}-arangodb"

echo -e "\n${GREEN}Finding ArangoDB task...${NC}"
TASK_ARN=$(aws ecs list-tasks \
    --cluster $ECS_CLUSTER \
    --service-name $SERVICE_NAME \
    --desired-status RUNNING \
    --region $AWS_REGION \
    --query 'taskArns[0]' \
    --output text)

if [ -z "$TASK_ARN" ] || [ "$TASK_ARN" = "None" ]; then
    echo -e "${RED}Error: No running ArangoDB task found${NC}"
    exit 1
fi

echo "  Task ARN: $TASK_ARN"

# Execute backup command in the container
echo -e "\n${GREEN}Creating backup archive...${NC}"
echo -e "${YELLOW}This will run inside the ArangoDB container${NC}"

# Create tar.gz archive
aws ecs execute-command \
    --cluster $ECS_CLUSTER \
    --task $TASK_ARN \
    --container arangodb \
    --region $AWS_REGION \
    --interactive \
    --command "tar -czf /tmp/${BACKUP_NAME}.tar.gz -C / var/lib/arangodb3 var/lib/arangodb3-apps"

echo -e "\n${GREEN}Uploading backup to S3...${NC}"

# Copy from container to S3 (requires ECS Exec enabled)
# Alternative: Use EFS mount from another instance or use a separate backup container

echo -e "${YELLOW}Manual backup process:${NC}"
echo -e "  1. The backup file is created at /tmp/${BACKUP_NAME}.tar.gz inside the container"
echo -e "  2. Use ECS Exec or copy to EFS then upload to S3:"
echo -e ""
echo -e "     # Option A: If you have ECS Exec enabled:"
echo -e "     aws ecs execute-command --cluster $ECS_CLUSTER \\"
echo -e "       --task $TASK_ARN --container arangodb --interactive \\"
echo -e "       --command \"aws s3 cp /tmp/${BACKUP_NAME}.tar.gz s3://${S3_BUCKET}/backups/${BACKUP_NAME}.tar.gz\""
echo -e ""
echo -e "     # Option B: Mount EFS on an EC2 instance and upload from there"
echo -e ""
echo -e "${YELLOW}To restore from this backup, update terraform.tfvars:${NC}"
echo -e "  arangodb_restore_file = \"backups/${BACKUP_NAME}.tar.gz\""

echo -e "\n${GREEN}Note: For production, consider using ArangoDB's built-in backup tools:${NC}"
echo -e "  - arangodump for database-level backups"
echo -e "  - Hot backups for full data backups"
