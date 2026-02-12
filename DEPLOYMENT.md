# Cell-KN AWS Deployment Guide

Complete guide for deploying Cell-KN to AWS with Terraform.

## Overview

This deployment creates:
- Frontend served via CloudFront + S3
- Backend Django API on ECS Fargate
- ArangoDB database on ECS Fargate with EFS persistence
- S3-based backup and restore for ArangoDB
- Complete networking (VPC, subnets, ALB, etc.)

## Prerequisites

- AWS CLI configured with credentials
- Terraform >= 1.0
- Docker installed
- Node.js and npm (for frontend)

## Initial Setup

### 1. Configure Terraform Variables

```bash
cd terraform
cp terraform.tfvars.example terraform.tfvars
```

Edit `terraform.tfvars` with your values:

```hcl
# Network
private_subnet_cidr = "10.0.1.0/24"

# Secrets
arango_db_password = "strong-password"
django_secret_key  = "django-secret"

# Custom Domain (required)
domain_name    = "cell-kn.org"
hosted_zone_id = "Z0441030102JW92C98Q3U"

# Optional - for ArangoDB restore
arangodb_restore_file = "backups/my-backup.tar.gz"
```

**Note**: `django_allowed_hosts` and `django_cors_allowed_origins` are auto-calculated from your domain.

### 2. Deploy Infrastructure

```bash
terraform init
terraform plan
terraform apply
```

### 3. Build and Deploy Backend

```bash
./scripts/deploy-backend.sh
```

Builds Django Docker image, pushes to ECR, and updates ECS.

### 4. Build and Deploy Frontend

```bash
./scripts/deploy-frontend.sh
```

Builds React app with API URL, uploads to S3, invalidates CloudFront.

### 5. Full Deployment

Or deploy everything at once:

```bash
./scripts/deploy-all.sh
```

## ArangoDB Backup and Restore

### Creating a Backup

```bash
# Option 1: From running container
./scripts/backup-arangodb.sh

# Option 2: Manual tar from EFS
tar -czf backup.tar.gz -C / var/lib/arangodb3 var/lib/arangodb3-apps
aws s3 cp backup.tar.gz s3://$(terraform output -raw s3_arangodb_bucket_name)/backups/
```

### Restoring from Backup

Update `terraform.tfvars`:

```hcl
arangodb_restore_file = "backups/my-backup-20240210.tar.gz"
```

Then:

```bash
terraform apply
# Restart ECS service to trigger restore
```

See [terraform/ARANGODB_S3_RESTORE.md](terraform/ARANGODB_S3_RESTORE.md) for detailed instructions.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Internet                                 │
└────────────┬──────────────────────────┬─────────────────────────┘
             │                          │
             ↓                          ↓
    ┌────────────────┐        ┌────────────────────┐
    │   CloudFront   │        │   ALB (Public)     │
    │   (Frontend)   │        │  - Port 8000       │
    └────────┬───────┘        │  - Port 8529       │
             │                └─────────┬──────────┘
             ↓                          │
    ┌────────────────┐                 │
    │   S3 Bucket    │                 ↓
    │   (Static)     │        ┌────────────────────┐
    └────────────────┘        │  Private Subnet    │
                               │                    │
    ┌────────────────┐        │  ┌──────────────┐  │
    │   S3 Bucket    │←───────┼──│  Backend ECS │  │
    │  (ArangoDB     │        │  │  (Django)    │  │
    │   Backups)     │        │  └──────────────┘  │
    └────────────────┘        │                    │
                               │  ┌──────────────┐  │
    ┌────────────────┐        │  │ ArangoDB ECS │  │
    │   EFS Volume   │←───────┼──│ (Database)   │  │
    │  (Persistent)  │        │  └──────────────┘  │
    └────────────────┘        └────────────────────┘
```

## Configuration Files

### Frontend Environment

See [react/ENV_CONFIG.md](react/ENV_CONFIG.md)

- `.env.development` - Development (uses proxy)
- `.env.production` - Production (uses ALB URL)

### Terraform Variables

See [terraform/README.md](terraform/README.md)

Minimal required configuration (5 variables).

### Docker Images

- `Dockerfile` - Backend Django application
- `docker/Dockerfile.arangodb` - Custom ArangoDB with S3 restore
- `docker/arangodb-entrypoint.sh` - Restore logic

## Outputs

After deployment:

```bash
cd terraform

# Get all URLs
terraform output cloudfront_domain_name  # Frontend
terraform output backend_url             # Backend API
terraform output arangodb_url            # Database UI

# Get resources
terraform output s3_bucket_name          # Frontend bucket
terraform output s3_arangodb_bucket_name # Backup bucket
terraform output ecr_repository_url      # Backend ECR
terraform output ecr_arangodb_repository_url # ArangoDB ECR
```

## Monitoring

### CloudWatch Logs

```bash
# Backend logs
aws logs tail /ecs/cell-kn-dev-backend --follow

# ArangoDB logs
aws logs tail /ecs/cell-kn-dev-arangodb --follow
```

### ECS Service Status

```bash
CLUSTER=$(cd terraform && terraform output -raw ecs_cluster_name)

aws ecs describe-services \
  --cluster $CLUSTER \
  --services cell-kn-dev-backend cell-kn-dev-arangodb \
  --query 'services[*].{Name:serviceName,Status:status,Running:runningCount,Desired:desiredCount}'
```

### S3 Backups

```bash
aws s3 ls s3://$(cd terraform && terraform output -raw s3_arangodb_bucket_name)/backups/
```

## Updating

### Update Backend Code

```bash
./scripts/deploy-backend.sh
```

### Update Frontend Code

```bash
./scripts/deploy-frontend.sh
```

### Update Infrastructure

```bash
cd terraform
terraform plan
terraform apply
```

### Force ArangoDB Restart

To trigger a restore or restart ArangoDB:

```bash
CLUSTER=$(cd terraform && terraform output -raw ecs_cluster_name)
aws ecs update-service \
  --cluster $CLUSTER \
  --service cell-kn-dev-arangodb \
  --force-new-deployment
```

## Troubleshooting

### Backend not starting

1. Check ECR image exists:
   ```bash
   aws ecr describe-images --repository-name cell-kn-dev-backend
   ```

2. Check ECS task logs:
   ```bash
   aws logs tail /ecs/cell-kn-dev-backend --follow
   ```

### ArangoDB restore not working

See [terraform/ARANGODB_S3_RESTORE.md](terraform/ARANGODB_S3_RESTORE.md)

### Frontend shows API errors

1. Check API URL in browser console
2. Verify CORS settings in Django
3. Check ALB health checks:
   ```bash
   aws elbv2 describe-target-health \
     --target-group-arn $(aws elbv2 describe-target-groups \
       --names cell-kn-dev-backend-tg --query 'TargetGroups[0].TargetGroupArn' --output text)
   ```

## Costs

Estimated monthly costs (us-east-1):

- **NAT Gateway**: ~$32
- **ALB**: ~$16
- **ECS Fargate**: ~$30 (2 backend + 1 db)
- **EFS**: ~$1 (first GB free)
- **S3**: Minimal (pay per use)
- **CloudFront**: Minimal (pay per use)
- **ECR**: $0.10/GB/month

**Total**: ~$80-100/month

## Cleanup

```bash
# Delete S3 contents first
aws s3 rm s3://$(cd terraform && terraform output -raw s3_bucket_name) --recursive
aws s3 rm s3://$(cd terraform && terraform output -raw s3_arangodb_bucket_name) --recursive

# Destroy infrastructure
cd terraform
terraform destroy
```

## Security

### Production Checklist

- [ ] Use HTTPS/SSL certificates (ACM)
- [ ] Restrict ArangoDB port 8529 access
- [ ] Enable MFA on AWS account
- [ ] Use AWS Secrets Manager instead of SSM
- [ ] Enable VPC Flow Logs
- [ ] Set up CloudWatch alarms
- [ ] Configure backup retention policies
- [ ] Enable AWS CloudTrail
- [ ] Restrict IAM permissions
- [ ] Use private ECR repositories

### Current Security Posture

✅ All S3 buckets block public access
✅ EFS encrypted at rest
✅ SSM parameters encrypted
✅ Private subnets for compute
✅ Security groups restrict traffic
✅ IAM roles follow least privilege

⚠️ ALB uses HTTP (add HTTPS for production)
⚠️ ArangoDB port exposed on ALB (restrict or remove)

## Support

- Terraform docs: [terraform/README.md](terraform/README.md)
- Deployment scripts: [scripts/README.md](scripts/README.md)
- Frontend config: [react/ENV_CONFIG.md](react/ENV_CONFIG.md)
- ArangoDB S3: [terraform/ARANGODB_S3_RESTORE.md](terraform/ARANGODB_S3_RESTORE.md)
