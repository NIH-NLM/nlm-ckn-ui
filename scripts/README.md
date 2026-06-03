# Deployment Scripts

Automated deployment scripts for NLM-CKN CloudFormation infrastructure and applications.

```
scripts/
  infra/    # CloudFormation stack deployments (provision/change infrastructure)
  app/      # Application deployments (ship code to existing infrastructure)
  arango-tunnel.sh
  backup-arangodb.sh
```

## Prerequisites

- AWS CLI configured with appropriate credentials
- Docker installed and running (for backend deployment)
- Node.js and npm installed (for frontend deployment)
- CloudFormation infrastructure deployed

## Infrastructure Scripts (`scripts/infra/`)

These scripts create or update AWS infrastructure via CloudFormation. Run them when provisioning a new environment or changing infrastructure resources.

### `infra/deploy-account-setup.sh` - Account Setup
```bash
./scripts/infra/deploy-account-setup.sh
```

One-time setup per AWS account. Creates the S3 template bucket, GitHub Actions OIDC role, ECR repository, and ArangoDB dataset S3 bucket.

### `infra/deploy-environment.sh` - Environment Stack
```bash
./scripts/infra/deploy-environment.sh <environment>
```

Deploys the complete environment (dev/staging/prod) with all nested stacks. See script header for details.

## Application Scripts (`scripts/app/`)

These scripts build and deploy application code to existing infrastructure. Use these for routine code releases — no CloudFormation changes.

### `app/deploy-backend.sh` - Backend Application
```bash
./scripts/app/deploy-backend.sh <environment>
```

Builds and pushes backend Docker image to ECR, updates ECS service.

### `app/deploy-frontend.sh` - Frontend Application
```bash
./scripts/app/deploy-frontend.sh <environment>
```

Builds React app and deploys to S3/CloudFront.

### `app/deploy-dataset.sh` - ArangoDB Dataset
```bash
./scripts/app/deploy-dataset.sh <environment> <s3-key>
```

Deploys ArangoDB dataset version. Example: `./scripts/app/deploy-dataset.sh dev datasets/2024-02-17-v1.2.3.tar.gz`

### `app/deploy-all.sh` - Full Application Deployment
```bash
./scripts/app/deploy-all.sh
```

Deploys both backend and frontend in sequence.

### `app/push-backend-image.sh` - Push Backend Image Only
```bash
./scripts/app/push-backend-image.sh
```

Builds and pushes the backend Docker image without updating the ECS service. Useful before the first environment deploy.

## Operations Scripts (`scripts/`)

### `arango-tunnel.sh` - Connect to ArangoDB via SSM
```bash
./scripts/arango-tunnel.sh [environment]        # default: dev (dev|stage|sandbox|prod)
./scripts/arango-tunnel.sh stage
./scripts/arango-tunnel.sh dev --show-password  # reveal the root password
```

Opens an AWS SSM port-forwarding tunnel to the ArangoDB EC2 instance
(`localhost:8530 → instance:8529`) — no SSH key or public IP needed. It looks up
the instance from the `cell-kn-<env>-arangodb` CloudFormation stack, fetches the
root password from Secrets Manager (masked unless `--show-password` /
`SHOW_PASSWORD=1` is set), then keeps the tunnel open (Ctrl+C to stop).

Once running:
```bash
open http://localhost:8530   # Web UI
arangosh --server.endpoint tcp://localhost:8530 --server.username root --server.password <password>
```

Requires the AWS Session Manager plugin (needed to open the SSM tunnel) and AWS
credentials for the target account. Uses your default profile; set
`AWS_PROFILE=<name>` to select a different one.

### `backup-arangodb.sh` - Create Backup
```bash
./scripts/backup-arangodb.sh <environment> [backup-name]
```

Creates backup of ArangoDB data and uploads it to S3.

## Deployment Order

### Initial Setup
```bash
# 1. Account setup (one-time per AWS account)
./scripts/infra/deploy-account-setup.sh

# 2. Push initial backend image (before first environment deploy)
./scripts/app/push-backend-image.sh

# 3. Configure parameters
cp cloudformation/parameters/dev.json.example cloudformation/parameters/dev.json
# Edit cloudformation/parameters/dev.json

# 4. Deploy environment infrastructure
./scripts/infra/deploy-environment.sh dev

# 5. Deploy applications
./scripts/app/deploy-all.sh
```

### Subsequent Deployments
```bash
# Deploy only what changed
./scripts/app/deploy-backend.sh dev   # Backend only
./scripts/app/deploy-frontend.sh dev  # Frontend only
./scripts/app/deploy-dataset.sh dev datasets/new.tar.gz  # Dataset only
```

## Documentation

All scripts have comprehensive headers with:
- Usage instructions
- What it does (step-by-step)
- Prerequisites
- Examples
- Troubleshooting tips

View any script header: `head -50 scripts/app/deploy-backend.sh`

**For more information:**
- Deployment guide: `cloudformation/DEPLOYMENT.md`
- CloudFormation infrastructure: `cloudformation/README.md`
