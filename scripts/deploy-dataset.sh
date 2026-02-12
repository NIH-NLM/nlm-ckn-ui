#!/bin/bash
# ==============================================================================
# deploy-dataset.sh - Deploy ArangoDB Dataset Version
# ==============================================================================
# Deploys a new ArangoDB dataset version using SSM parameter-based versioning.
# The init container automatically detects version changes and restores only
# when the version differs from the currently deployed dataset.
#
# USAGE:
#   ./deploy-dataset.sh <s3-key>
#
# ARGUMENTS:
#   s3-key    S3 object key for the dataset tar.gz file
#             Example: datasets/2024-02-11-v1.2.3.tar.gz
#
# WHAT IT DOES:
#   1. Validates dataset exists in S3
#   2. Updates SSM parameter with new dataset version
#   3. Forces ArangoDB service restart
#   4. Init container detects version change and restores new dataset
#
# PREREQUISITES:
#   - AWS CLI configured with appropriate credentials
#   - Terraform infrastructure deployed (terraform apply)
#   - Dataset tar.gz file uploaded to S3
#
# EXAMPLES:
#   # Upload dataset to S3
#   aws s3 cp my-data.tar.gz s3://cell-kn-arangodb-data/datasets/2024-02-11-v1.2.3.tar.gz
#
#   # Deploy the dataset
#   ./scripts/deploy-dataset.sh datasets/2024-02-11-v1.2.3.tar.gz
#
#   # Rollback to previous version
#   ./scripts/deploy-dataset.sh datasets/2024-02-10-v1.2.2.tar.gz
#
# SEE ALSO:
#   ../VERSIONED_DEPLOYMENTS.md - Complete documentation on versioned deployments
# ==============================================================================
set -e

if [ $# -ne 1 ]; then
  echo "Usage: $0 <s3-key>"
  echo "Example: $0 datasets/2024-02-11-v1.2.3.tar.gz"
  exit 1
fi

DATASET_S3_KEY="$1"

# Change to terraform directory
cd "$(dirname "$0")/../terraform" || exit 1

echo "==> Getting Terraform outputs..."
SSM_PARAMETER=$(terraform output -raw arangodb_dataset_version_parameter)
CLUSTER=$(terraform output -raw ecs_cluster_name)
SERVICE=$(terraform output -raw arangodb_service_name)
S3_BUCKET=$(terraform output -raw s3_arangodb_bucket_name)

echo "==> Checking if dataset exists in S3..."
if ! aws s3 ls "s3://${S3_BUCKET}/${DATASET_S3_KEY}" > /dev/null 2>&1; then
  echo "ERROR: Dataset not found: s3://${S3_BUCKET}/${DATASET_S3_KEY}"
  echo ""
  echo "Available datasets:"
  aws s3 ls "s3://${S3_BUCKET}/datasets/" --recursive
  exit 1
fi

echo "==> Current dataset version:"
aws ssm get-parameter --name "$SSM_PARAMETER" --query 'Parameter.Value' --output text 2>/dev/null || echo "none"

echo ""
echo "==> Updating dataset version to: $DATASET_S3_KEY"
aws ssm put-parameter \
  --name "$SSM_PARAMETER" \
  --value "$DATASET_S3_KEY" \
  --overwrite

echo ""
echo "==> Restarting ArangoDB service..."
aws ecs update-service \
  --cluster "$CLUSTER" \
  --service "$SERVICE" \
  --force-new-deployment \
  --query 'service.{Status:status,DesiredCount:desiredCount}' \
  --output table

echo ""
echo "==> Deployment initiated!"
echo ""
echo "Monitor deployment:"
echo "  aws ecs describe-services --cluster $CLUSTER --services $SERVICE"
echo ""
echo "Watch logs:"
echo "  aws logs tail /ecs/\$(cd ../terraform && terraform output -raw project_name)-\$(cd ../terraform && terraform output -raw environment)-arangodb --follow"
echo ""
echo "Check version after deployment:"
echo "  cat <efs-mount>/.dataset-version"
