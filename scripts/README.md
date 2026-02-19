# Deployment Scripts

Automated deployment scripts for Cell-KN CloudFormation infrastructure and applications.

## Prerequisites

- AWS CLI configured with appropriate credentials
- Docker installed and running (for backend deployment)
- Node.js and npm installed (for frontend deployment)
- CloudFormation infrastructure deployed

## CloudFormation Infrastructure Scripts

### `deploy-bootstrap.sh` - Bootstrap Infrastructure
```bash
./scripts/deploy-bootstrap.sh
```

One-time deployment of bootstrap infrastructure. Creates S3 buckets, GitHub OIDC, and IAM roles.

### `deploy-shared.sh` - Shared Resources
```bash
./scripts/deploy-shared.sh
```

One-time deployment of shared resources (ECR, S3 for datasets) used across all environments.

### `deploy-environment.sh` - Environment Stack
```bash
./scripts/deploy-environment.sh <environment>
```

Deploys complete environment (dev/staging/prod) with all nested stacks. See headers in scripts for details.

## Application Deployment Scripts

### `deploy-backend.sh` - Backend Application
```bash
./scripts/deploy-backend.sh
```

Builds and pushes backend Docker image to ECR, updates ECS service.

### `deploy-frontend.sh` - Frontend Application
```bash
./scripts/deploy-frontend.sh
```

Builds React app and deploys to S3/CloudFront.

### `deploy-dataset.sh` - ArangoDB Dataset
```bash
./scripts/deploy-dataset.sh <s3-key>
```

Deploys ArangoDB dataset version. Example: `./scripts/deploy-dataset.sh datasets/2024-02-17-v1.2.3.tar.gz`

### `deploy-all.sh` - Full Application Deployment
```bash
./scripts/deploy-all.sh
```

Deploys both backend and frontend in sequence.

### `backup-arangodb.sh` - Create Backup
```bash
./scripts/backup-arangodb.sh <environment> [backup-name]
```

Creates backup of ArangoDB data and uploads it to S3.

## Deployment Order

### Initial Setup
```bash
# 1. Deploy bootstrap (one-time)
./scripts/deploy-bootstrap.sh

# 2. Deploy shared resources (one-time)
./scripts/deploy-shared.sh

# 3. Configure parameters
cp cloudformation/parameters/dev.json.example cloudformation/parameters/dev.json
# Edit cloudformation/parameters/dev.json

# 4. Deploy environment
./scripts/deploy-environment.sh dev

# 5. Deploy applications
./scripts/deploy-all.sh
```

### Subsequent Deployments
```bash
# Deploy only what changed
./scripts/deploy-backend.sh   # Backend only
./scripts/deploy-frontend.sh  # Frontend only
./scripts/deploy-dataset.sh dev datasets/new.tar.gz  # Dataset only
```

## Documentation

All scripts have comprehensive headers with:
- Usage instructions
- What it does (step-by-step)
- Prerequisites
- Examples
- Troubleshooting tips

View any script header: `head -50 scripts/deploy-backend.sh`

**For more information:**
- CloudFormation infrastructure: `cloudformation/README.md`
- NIH deployment guide: `cloudformation/NIH_DEPLOYMENT.md`
- Complete conversion details: `cloudformation/CONVERSION_COMPLETE.md`
