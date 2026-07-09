# Deployment Scripts

Application deployment and operations scripts for NLM-CKN.

> **Infrastructure lives elsewhere.** CloudFormation, environment provisioning,
> account setup, and the ArangoDB monitoring stack now live in the
> [`nlm-ckn-iac`](https://github.com/Springbok-LLC/nlm-ckn-iac) repository. This
> repo (`nlm-ckn-ui`) ships application code to infrastructure that `nlm-ckn-iac`
> has already provisioned.

```
scripts/
  common.sh          # Shared constants (PROJECT_NAME) sourced by app + ops scripts
  app/               # Application deployments (ship code to existing infrastructure)
  ops/               # Operational helpers (smoke test, ...)
  sandbox/           # Sandbox-account deploy (separate naming; see sandbox/README.md)
  dev/               # Local developer helpers
  arango-tunnel.sh
  backup-arangodb.sh
```

## Prerequisites

- AWS CLI configured with appropriate credentials
- Docker installed and running (for backend deployment)
- Node.js and npm installed (for frontend deployment)
- Infrastructure already provisioned via [`nlm-ckn-iac`](https://github.com/Springbok-LLC/nlm-ckn-iac)

## Provisioning infrastructure

Account setup and environment stacks are deployed from the `nlm-ckn-iac` repo,
not here:

```bash
# in the nlm-ckn-iac repo
./deploy/01-deploy-account-setup.sh          # one-time per AWS account
./deploy/02-deploy-environment.sh <env>      # provision an environment
```

These create the ECR repo, the ArangoDB dataset S3 bucket, the GitHub OIDC role
(`nlm-ckn-github-actions`), and the per-environment stacks
(`nlm-ckn-<env>`, `nlm-ckn-<env>-frontend`, `nlm-ckn-<env>-arangodb`,
`nlm-ckn-<env>-backend`). The scripts below discover those resources at runtime
from CloudFormation outputs/exports and SSM.

## Application Scripts (`scripts/app/`)

These build and deploy application code to existing infrastructure. Use these for
routine code releases — no CloudFormation changes. They (and the ops scripts)
source [`scripts/common.sh`](./common.sh), which defines `PROJECT_NAME="nlm-ckn"`.

### `app/deploy-backend.sh` - Backend Application
```bash
./scripts/app/deploy-backend.sh <environment>
```

Builds and pushes the backend Docker image to ECR, then updates the ECS service.

### `app/deploy-frontend.sh` - Frontend Application
```bash
./scripts/app/deploy-frontend.sh <environment>
```

Builds the React app and deploys to S3/CloudFront.

### `app/deploy-dataset.sh` - ArangoDB Dataset
```bash
./scripts/app/deploy-dataset.sh <environment> <s3-key>
```

Deploys an ArangoDB dataset version. Example: `./scripts/app/deploy-dataset.sh dev datasets/2024-02-17-v1.2.3.tar.gz`

### `app/deploy-all.sh` - Full Application Deployment
```bash
./scripts/app/deploy-all.sh
```

Deploys both backend and frontend in sequence.

### `app/push-backend-image.sh` - Push Backend Image Only
```bash
./scripts/app/push-backend-image.sh
```

Builds and pushes the backend Docker image without updating the ECS service.
Useful before the first environment deploy.

## Operations Scripts

### `arango-tunnel.sh` - Connect to ArangoDB via SSM
```bash
./scripts/arango-tunnel.sh [environment]        # default: dev (dev|stage|sandbox|prod)
./scripts/arango-tunnel.sh stage
./scripts/arango-tunnel.sh dev --show-password  # reveal the root password
```

Opens an AWS SSM port-forwarding tunnel to the ArangoDB EC2 instance
(`localhost:8530 → instance:8529`) — no SSH key or public IP needed. It looks up
the instance from the `nlm-ckn-<env>-arangodb` CloudFormation stack, fetches the
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

Creates a backup of ArangoDB data and uploads it to S3.

### `ops/smoke-test.sh` - Post-deploy smoke test
```bash
AWS_PROFILE=springbok ./scripts/ops/smoke-test.sh [env] [options]
```

Fast, read-only pass/fail check of the public edge (CloudFront → S3 app and
CloudFront → backend ALB), exercising frontend, backend, and ArangoDB
connectivity end to end. Exits non-zero on any failure, so it can gate a deploy.

> **ArangoDB monitoring + wedge detection** (the `…-monitoring` stack, the
> read-only monitor user, and the correlation dashboard) now lives in
> [`nlm-ckn-iac`](https://github.com/Springbok-LLC/nlm-ckn-iac) under
> `environment/services/monitoring/`. Deploy it and its helper scripts from that
> repo.

## Deployment Order

### Initial Setup
```bash
# 1. Account setup + environment provisioning (in the nlm-ckn-iac repo)
#    ./deploy/01-deploy-account-setup.sh
#    ./deploy/02-deploy-environment.sh dev

# 2. Push initial backend image (before first environment deploy)
./scripts/app/push-backend-image.sh

# 3. Deploy applications
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

All scripts have comprehensive headers with usage, step-by-step behavior,
prerequisites, examples, and troubleshooting tips.

View any script header: `head -50 scripts/app/deploy-backend.sh`

**For more information:**
- Deployment procedure and mental model: [`DEPLOYMENT-NOTES.md`](./DEPLOYMENT-NOTES.md)
- Infrastructure (CloudFormation): [`nlm-ckn-iac`](https://github.com/Springbok-LLC/nlm-ckn-iac)
