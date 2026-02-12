# Deployment Scripts

Automated deployment scripts for AWS infrastructure.

## Prerequisites

- AWS CLI configured with appropriate credentials
- Docker installed and running
- Terraform infrastructure deployed (run `terraform apply` first)
- Node.js and npm installed

## Scripts

### `deploy-dataset.sh`
Deploys a new ArangoDB dataset version.

```bash
./scripts/deploy-dataset.sh datasets/2024-02-11-v1.2.3.tar.gz
```

**What it does:**
1. Validates dataset exists in S3
2. Updates SSM parameter with new dataset version
3. Forces ArangoDB service restart
4. Init container detects version change and restores new dataset

**Usage:**
```bash
# Upload dataset to S3
aws s3 cp my-data.tar.gz s3://cell-kn-dev-arangodb-data/datasets/2024-02-11-v1.2.3.tar.gz

# Deploy the dataset
./scripts/deploy-dataset.sh datasets/2024-02-11-v1.2.3.tar.gz
```

See [VERSIONED_DEPLOYMENTS.md](../VERSIONED_DEPLOYMENTS.md) for full documentation.

### `deploy-all.sh`
Deploys both backend and frontend in sequence.

```bash
./scripts/deploy-all.sh
```

**What it does:**
1. Builds and pushes backend Docker image to ECR
2. Updates ECS service with new image
3. Builds React frontend with correct API URL
4. Uploads frontend to S3
5. Invalidates CloudFront cache

### `deploy-backend.sh`
Deploys only the backend application.

```bash
./scripts/deploy-backend.sh
```

**What it does:**
1. Logs in to Amazon ECR
2. Builds Docker image from project root
3. Tags image with `latest` and timestamp
4. Pushes to ECR
5. Forces new ECS deployment
6. Waits for service to stabilize

### `deploy-frontend.sh`
Deploys only the frontend application.

```bash
./scripts/deploy-frontend.sh
```

**What it does:**
1. Gets ALB DNS name from Terraform
2. Builds React app with `REACT_APP_API_URL` set to backend
3. Syncs build files to S3
4. Creates CloudFront invalidation
5. Shows application URLs

## Usage

### First Time Setup

1. Deploy infrastructure:
   ```bash
   cd terraform
   terraform init
   terraform apply
   ```

2. Deploy applications:
   ```bash
   cd ..
   ./scripts/deploy-all.sh
   ```

### Subsequent Deployments

Deploy everything:
```bash
./scripts/deploy-all.sh
```

Or deploy individually:
```bash
# Backend only (after code changes)
./scripts/deploy-backend.sh

# Frontend only (after UI changes)
./scripts/deploy-frontend.sh
```

## Environment Variables

The scripts read Terraform outputs automatically. You can override with environment variables:

```bash
# Override AWS region (default: us-east-1)
AWS_REGION=us-west-2 ./scripts/deploy-backend.sh
```

## What Gets Deployed

### Backend (`deploy-backend.sh`)
- Docker image built from root `Dockerfile`
- Pushed to ECR with tags: `latest` and timestamp
- ECS service force-deployment (zero-downtime)
- Service health monitored until stable

### Frontend (`deploy-frontend.sh`)
- React build with `REACT_APP_API_URL=http://<alb-dns>:8000`
- Static files uploaded to S3
- CloudFront cache invalidated
- Served via CloudFront CDN

## Rollback

### Backend Rollback
List available images:
```bash
aws ecr describe-images \
  --repository-name $(cd terraform && terraform output -raw ecr_repository_url | cut -d'/' -f2) \
  --query 'sort_by(imageDetails,& imagePushedAt)[-10:].imageTags[0]' \
  --output table
```

Update ECS to use specific tag:
```bash
# Update task definition to use old image tag, then update service
# Or use AWS Console to select previous task definition revision
```

### Frontend Rollback
S3 versioning is enabled, use AWS Console to restore previous version.

## Monitoring

### Check Backend Logs
```bash
aws logs tail /ecs/cell-kn-dev-backend --follow
```

### Check ArangoDB Logs
```bash
aws logs tail /ecs/cell-kn-dev-arangodb --follow
```

### Check ECS Service Status
```bash
CLUSTER=$(cd terraform && terraform output -raw ecs_cluster_name)
aws ecs describe-services \
  --cluster $CLUSTER \
  --services cell-kn-dev-backend \
  --query 'services[0].{Status:status,Desired:desiredCount,Running:runningCount}'
```

## Troubleshooting

### "Could not get Terraform outputs"
- Ensure you're running from project root or scripts directory
- Run `terraform apply` in terraform directory first

### Docker build fails
- Check `Dockerfile` in project root exists
- Ensure Docker daemon is running
- Check for syntax errors in Dockerfile

### ECR login fails
- Verify AWS credentials: `aws sts get-caller-identity`
- Check AWS region is correct
- Ensure ECR repository exists

### ECS deployment hangs
- Check CloudWatch logs for application errors
- Verify security groups allow traffic
- Check health check configuration in Terraform

### Frontend shows API errors
- Verify backend is running: `curl http://<alb-dns>:8000/arango_api/collections/`
- Check CORS settings in Django backend
- Inspect browser console for actual API URL being called
- Verify `REACT_APP_API_URL` was set correctly during build

### CloudFront shows old version
- Wait a few minutes for invalidation to propagate
- Check invalidation status:
  ```bash
  CF_DIST=$(cd terraform && terraform output -raw cloudfront_distribution_id)
  aws cloudfront get-invalidation --distribution-id $CF_DIST --id <INVALIDATION_ID>
  ```
- Try hard refresh in browser (Ctrl+Shift+R or Cmd+Shift+R)

## CI/CD Integration

These scripts can be used in CI/CD pipelines:

```yaml
# Example GitHub Actions
- name: Deploy to AWS
  run: ./scripts/deploy-all.sh
  env:
    AWS_ACCESS_KEY_ID: ${{ secrets.AWS_ACCESS_KEY_ID }}
    AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
    AWS_REGION: us-east-1
```

## Security Notes

- Scripts use `set -e` to exit on any error
- ECR credentials are temporary (via `aws ecr get-login-password`)
- No secrets are logged or committed
- S3 sync uses `--delete` to remove old files
- CloudFront invalidation ensures fresh content

## Performance Tips

- **Parallel builds**: Run `deploy-backend.sh` and `deploy-frontend.sh` in parallel
- **Image caching**: Docker layers are cached for faster builds
- **Incremental builds**: Only changed files trigger rebuilds
- **CloudFront edge caching**: Global CDN for fast frontend delivery
