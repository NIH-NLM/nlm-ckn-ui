# Shared Resources Architecture

## Overview

The infrastructure is now split into **shared resources** (created once) and **environment-specific resources** (created per environment).

## Structure

```
terraform/
├── main.tf                      # Orchestrates shared + environment modules
├── modules/
│   ├── shared/                  # Shared across all environments
│   │   ├── ecr.tf              # Backend Docker registry
│   │   ├── arangodb-s3.tf      # ArangoDB datasets bucket
│   │   ├── variables.tf
│   │   └── outputs.tf
│   └── environment/             # Per-environment resources
│       ├── networking.tf       # VPC, subnets (isolated per env)
│       ├── alb.tf              # Load balancer (per env)
│       ├── frontend.tf         # S3 + CloudFront (per env)
│       ├── backend.tf          # ECS service (uses shared ECR)
│       ├── arangodb.tf         # ECS service + EFS (uses shared S3)
│       └── ...
```

## Shared Resources

### ECR Repository: `cell-kn-backend`
- **Single registry** for all environments
- Images tagged by version: `v1.2.3`, `latest`, etc.
- Same image can be deployed to dev, staging, prod
- Lifecycle policy: keeps last 30 images

### S3 Bucket: `cell-kn-arangodb-data`
- **Single bucket** for all datasets
- Organized by prefix:
  ```
  s3://cell-kn-arangodb-data/
  ├── datasets/          # Versioned datasets
  │   ├── 2024-02-11-v1.2.3.tar.gz
  │   └── 2024-02-12-v1.2.4.tar.gz
  └── backups/           # Manual backups
  ```
- Lifecycle policies:
  - Archive datasets to Glacier after 90 days
  - Move to Deep Archive after 180 days
  - Expire backups after 30 days
- All environments read from same bucket

## Environment-Specific Resources

Each environment (dev, staging, prod) gets its own:
- VPC and networking
- ECS cluster
- ECS services (backend, arangodb)
- EFS volumes (persistent per environment)
- ALB and target groups
- CloudFront distribution
- S3 bucket for frontend
- SSM parameters (secrets per environment)

## Benefits

### 1. No Artifact Duplication
**Before:**
```
ECR: cell-kn-dev-backend, cell-kn-staging-backend, cell-kn-prod-backend
S3:  cell-kn-dev-arangodb-data, cell-kn-staging-arangodb-data, ...
```

**After:**
```
ECR: cell-kn-backend (shared)
S3:  cell-kn-arangodb-data (shared)
```

### 2. Consistent Deployments
- Build once, deploy everywhere
- Same Docker image in all environments
- Same dataset version across environments

### 3. Cost Savings
- No duplicate storage costs
- Single ECR repository
- Single S3 bucket with unified lifecycle policies

### 4. Simpler Management
- One place to manage images
- One place to manage datasets
- Clear separation: shared vs environment-specific

## Deployment Workflow

### Initial Setup (Once)

```bash
cd terraform
terraform init
terraform apply  # Creates shared + dev environment
```

This creates:
1. Shared module: ECR + S3
2. Environment module: Everything else for dev

### Adding New Environments

For staging:
```bash
cd terraform-staging
terraform init

# Copy terraform.tfvars from dev, change:
# - environment = "staging"
# - vpc_cidr = "10.1.0.0/16"
# - private_subnet_cidr = "10.1.1.0/24"

terraform apply  # Reuses shared ECR + S3
```

For prod:
```bash
cd terraform-prod
terraform init

# environment = "prod"
# vpc_cidr = "10.2.0.0/16"

terraform apply  # Reuses shared ECR + S3
```

### Deploying Backend

**Same for all environments:**
```bash
# Build and push to shared ECR
ECR_REPO=$(terraform output -raw ecr_repository_url)
docker build -t $ECR_REPO:v1.2.3 .
docker push $ECR_REPO:v1.2.3

# Deploy to dev
cd terraform-dev
./scripts/deploy-backend.sh v1.2.3

# Deploy same image to staging
cd terraform-staging
./scripts/deploy-backend.sh v1.2.3

# Deploy same image to prod
cd terraform-prod
./scripts/deploy-backend.sh v1.2.3
```

### Deploying Datasets

**Upload once, use everywhere:**
```bash
# Upload dataset to shared S3
aws s3 cp data.tar.gz s3://cell-kn-arangodb-data/datasets/2024-02-11-v1.2.3.tar.gz

# Deploy to dev
cd terraform-dev
./scripts/deploy-dataset.sh datasets/2024-02-11-v1.2.3.tar.gz

# Deploy same dataset to staging
cd terraform-staging
./scripts/deploy-dataset.sh datasets/2024-02-11-v1.2.3.tar.gz

# Deploy same dataset to prod
cd terraform-prod
./scripts/deploy-dataset.sh datasets/2024-02-11-v1.2.3.tar.gz
```

## Terraform State Management

### Recommended Setup

Use separate state files for safety:

```bash
# terraform-dev/backend.tf
terraform {
  backend "s3" {
    bucket = "cell-kn-terraform-state"
    key    = "dev/terraform.tfstate"
    region = "us-east-1"
  }
}

# terraform-staging/backend.tf
terraform {
  backend "s3" {
    bucket = "cell-kn-terraform-state"
    key    = "staging/terraform.tfstate"
    region = "us-east-1"
  }
}
```

**Important:** First environment creates shared resources. Subsequent environments import them:

```bash
# In staging/prod
terraform import module.shared.aws_ecr_repository.backend cell-kn-backend
terraform import module.shared.aws_s3_bucket.arangodb_data cell-kn-arangodb-data
```

Or use `prevent_destroy` lifecycle to protect shared resources.

## Migration from Current Setup

If you already have `cell-kn-dev-backend` ECR and `cell-kn-dev-arangodb-data` S3:

### Option 1: Rename Existing Resources (Recommended)

```bash
# Rename ECR repository
aws ecr describe-repositories --repository-names cell-kn-dev-backend
# Create new repo with correct name via AWS Console or CLI
aws ecr create-repository --repository-name cell-kn-backend

# Copy images
# (or just rebuild and push to new repo)

# Rename S3 bucket (copy to new bucket)
aws s3 mb s3://cell-kn-arangodb-data
aws s3 sync s3://cell-kn-dev-arangodb-data/ s3://cell-kn-arangodb-data/

# Deploy new infrastructure
terraform apply
```

### Option 2: Import Existing Resources

```bash
# Import existing dev resources as shared
terraform import module.shared.aws_ecr_repository.backend cell-kn-dev-backend
terraform import module.shared.aws_s3_bucket.arangodb_data cell-kn-dev-arangodb-data

# Update shared module to match existing names
# (or rename resources in AWS to match new names)
```

## IAM Permissions

Environment-specific IAM roles need access to shared resources:

### Backend Task Role
- Read from shared ECR (handled by ECS task execution role)
- No additional permissions needed

### ArangoDB Task Role
- Read/write to shared S3 bucket
- IAM policy in `arangodb.tf` already references `var.s3_arangodb_bucket_name`

## Security Considerations

### Shared Resources Access
- All environments can access shared ECR (read-only via IAM)
- All environments can access shared S3 (read/write via IAM)
- Use S3 bucket policies if you need to restrict access per environment

### Isolation
- Each environment has isolated networking (separate VPCs)
- Each environment has isolated EFS (cannot share database files)
- Each environment has isolated SSM parameters (separate secrets)

## Cost Impact

**Savings:**
- 1 ECR instead of 3+ (save ~$0.10/GB * 2 environments)
- 1 S3 bucket instead of 3+ (save storage + request costs)
- Unified lifecycle policies reduce storage costs

**Additional Costs:**
- None (shared resources cost the same as per-environment)

## Summary

**Key Changes:**
- ✅ ECR and S3 now shared across environments
- ✅ Build once, deploy everywhere
- ✅ Single source of truth for images and datasets
- ✅ Environment isolation maintained (VPC, ECS, EFS)
- ✅ Simpler artifact management

**Deployment becomes:**
```bash
# Upload once
docker push cell-kn-backend:v1.2.3
aws s3 cp data.tar.gz s3://cell-kn-arangodb-data/datasets/v1.2.3.tar.gz

# Deploy everywhere
for env in dev staging prod; do
  cd terraform-$env
  ./scripts/deploy-backend.sh v1.2.3
  ./scripts/deploy-dataset.sh datasets/v1.2.3.tar.gz
done
```

Much simpler!
