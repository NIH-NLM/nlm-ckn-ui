# Cell-KN Infrastructure Terraform

Single-module Terraform configuration that deploys a complete Cell-KN application environment on AWS.

## What Gets Deployed

A single module creates everything needed for the application:

- **VPC**: Network with public and private subnets, NAT gateway
- **Frontend**: S3 bucket with CloudFront CDN
- **Backend**: ECS Fargate service running Django on port 8000
- **Database**: ECS Fargate service running ArangoDB 3.12 on port 8529
  - Init container for S3 restore (amazon/aws-cli)
  - Main container (standard arangodb:3.12 image)
- **Storage**: EFS for ArangoDB persistent data + S3 for backups/restore
- **Load Balancer**: ALB exposing backend and database management UI
- **Registry**: ECR repository for backend Docker image
- **Secrets**: SSM Parameter Store for credentials

## Architecture

```
https://dev.cell-kn.org
    ↓
CloudFront Distribution
├── /* → S3 (Frontend static files)
└── /arango_api/* → ALB:8000 (Backend API)
    ↓
Private Subnet
├── Backend ECS Tasks (2-10 auto-scaling) → ECR Image
│   └── Connects to arangodb.cell-kn-dev.local:8529 (Service Discovery)
└── ArangoDB ECS Task (1x) → EFS Storage + S3 Restore
```

## Module Structure

```
terraform/
├── main.tf                     # Root - calls environment module
├── variables.tf                # Root variables (minimal)
├── outputs.tf                  # Root outputs
├── terraform.tfvars.example    # Example configuration
└── modules/
    └── environment/            # Single module with all resources
        ├── main.tf             # All infrastructure
        ├── variables.tf        # Module inputs
        └── outputs.tf          # Module outputs
```

## Quick Start

### 1. Configure Variables

```bash
cp terraform.tfvars.example terraform.tfvars
```

Edit `terraform.tfvars` - required variables:

```hcl
# Network
private_subnet_cidr = "10.0.1.0/24"

# Secrets
arango_db_password = "strong-password-here"
django_secret_key  = "django-secret-key-here"

# Custom Domain (required)
domain_name    = "cell-kn.org"
hosted_zone_id = "Z0441030102JW92C98Q3U"
```

**Note**: `django_allowed_hosts` and `django_cors_allowed_origins` are auto-calculated from your domain.

Everything else has sensible defaults:
- VPC CIDR: `10.0.0.0/16`
- Project name: `cell-kn`
- Environment: `dev`
- Public subnets: Auto-calculated from VPC CIDR
- ECS resources: Backend (512 CPU, 1024 MB), ArangoDB (1024 CPU, 2048 MB)

### 2. Deploy

```bash
terraform init
terraform plan
terraform apply
```

### 3. Build and Push Backend

```bash
# Get ECR URL
ECR_REPO=$(terraform output -raw ecr_repository_url)

# Login and push
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin $ECR_REPO
docker build -t $ECR_REPO:latest .
docker push $ECR_REPO:latest

# Deploy to ECS
aws ecs update-service --cluster $(terraform output -raw ecs_cluster_name) \
  --service cell-kn-dev-backend --force-new-deployment
```

### 4. Deploy Frontend

```bash
# Build frontend (no REACT_APP_API_URL needed - uses relative paths)
cd ../react
npm run build

# Upload to S3
S3_BUCKET=$(cd ../terraform && terraform output -raw s3_bucket_name)
aws s3 sync build/ s3://$S3_BUCKET/ --delete

# Invalidate CloudFront cache
CF_DIST_ID=$(cd ../terraform && terraform output -raw cloudfront_distribution_id)
aws cloudfront create-invalidation --distribution-id $CF_DIST_ID --paths "/*"
```

**Note**: React uses relative URLs (`/arango_api/*`) which CloudFront routes to the backend.

## Custom Domain Setup

The infrastructure requires a custom domain configured in Route 53. This provides a unified domain for both frontend and backend with automatic HTTPS via ACM certificates.

### Benefits

- **Single domain**: `https://dev.cell-kn.org` serves both frontend and backend API
- **No CORS issues**: Same-origin requests, no cross-domain complexity
- **HTTPS by default**: Free ACM certificates, automatic renewal
- **No environment variables**: React uses relative URLs (`/arango_api/*`)
- **Environment isolation**: Each environment gets its own subdomain

### Domain Structure

```
dev.cell-kn.org     → Development environment
staging.cell-kn.org → Staging environment (if created)
cell-kn.org         → Production environment (environment = "prod")
```

### Configuration

Required variables in `terraform.tfvars`:

```hcl
domain_name    = "cell-kn.org"
hosted_zone_id = "Z0441030102JW92C98Q3U"
```

The infrastructure automatically:
1. Determines the subdomain based on `environment` variable
   - `environment = "dev"` → `dev.cell-kn.org`
   - `environment = "prod"` → `cell-kn.org` (apex domain)
2. Creates ACM certificate in us-east-1 (required for CloudFront)
3. Validates certificate via DNS (automatic with Route 53)
4. Configures CloudFront with custom domain and HTTPS
5. Adds Route 53 A record pointing to CloudFront
6. Auto-calculates Django `ALLOWED_HOSTS` and `CORS_ALLOWED_ORIGINS`

### Django Configuration

Django settings are **auto-calculated** from your domain:

```hcl
# You don't need to set these - they're derived from domain_name
# For environment = "dev" and domain_name = "cell-kn.org":
django_allowed_hosts        = "localhost,dev.cell-kn.org"
django_cors_allowed_origins = "https://dev.cell-kn.org"
```

Since both frontend and backend are served from the same domain, CORS complexity is eliminated.

### Security

CloudFront is configured to:
- Only accept requests to the custom domain (blocks direct CloudFront URL)
- Send a secret header to the ALB to verify requests come from CloudFront
- Force HTTPS with modern TLS (TLSv1.2_2021)

## Variables

### Required

| Variable | Description | Example |
|----------|-------------|---------|
| `private_subnet_cidr` | Private subnet CIDR | `10.0.1.0/24` |
| `arango_db_password` | ArangoDB password | `strong-password` |
| `django_secret_key` | Django secret | Generate with Django |
| `domain_name` | Base domain name | `cell-kn.org` |
| `hosted_zone_id` | Route 53 hosted zone ID | `Z0441030102JW92C98Q3U` |

**Note**: `django_allowed_hosts` and `django_cors_allowed_origins` are auto-calculated from `domain_name`.

### Optional (with defaults)

| Variable | Default | Description |
|----------|---------|-------------|
| `aws_region` | `us-east-1` | AWS region |
| `project_name` | `cell-kn` | Project name for resources |
| `environment` | `dev` | Environment (dev/staging/prod) |
| `vpc_cidr` | `10.0.0.0/16` | VPC CIDR block |
| `arango_db_user` | `root` | ArangoDB username |
| `arangodb_restore_file` | `""` | S3 key for restore file |

## Outputs

```bash
terraform output frontend_url              # Main frontend URL (custom domain or CloudFront)
terraform output custom_domain             # Custom domain if configured
terraform output cloudfront_domain_name    # CloudFront default domain
terraform output alb_dns_name              # Load balancer URL
terraform output backend_url               # Backend API URL (via ALB)
terraform output arangodb_url              # Database management URL
terraform output ecr_repository_url        # Docker registry URL
terraform output s3_bucket_name            # Frontend bucket
terraform output ecs_cluster_name          # ECS cluster name
terraform output efs_id                    # Storage volume ID
```

## Resource Naming

Following [terraform-best-practices.com/naming](https://www.terraform-best-practices.com/naming):

**Pattern**: `{project}-{environment}-{resource-type}`

Examples:
- VPC: `cell-kn-dev-vpc`
- ALB: `cell-kn-dev-alb`
- Backend Target Group: `cell-kn-dev-backend-tg`
- ECS Cluster: `cell-kn-dev-cluster`
- S3 Bucket: `cell-kn-dev-frontend`

All resources tagged with:
- `Project`: Project name
- `Environment`: Environment name
- `ManagedBy`: `Terraform`
- `Name`: Resource-specific name

## Managing Secrets

Update secrets in SSM Parameter Store:

```bash
# Update database password
aws ssm put-parameter \
  --name "/cell-kn/dev/arango/db-password" \
  --value "new-password" \
  --type "SecureString" \
  --overwrite

# Restart services to pick up changes
aws ecs update-service \
  --cluster cell-kn-dev-cluster \
  --service cell-kn-dev-backend \
  --force-new-deployment
```

## Logs

View ECS service logs:

```bash
# Backend logs
aws logs tail /ecs/cell-kn-dev-backend --follow

# ArangoDB logs
aws logs tail /ecs/cell-kn-dev-arangodb --follow
```

## Network Details

The module automatically creates:

- **VPC**: Single VPC with DNS enabled
- **Public Subnets**: 2 subnets across 2 AZs (auto-calculated as `10.0.0.0/24` and `10.0.1.0/24` if VPC is `10.0.0.0/16`)
- **Private Subnet**: 1 subnet (your specified CIDR)
- **Internet Gateway**: For public subnet internet access
- **NAT Gateway**: For private subnet outbound internet
- **Route Tables**: Separate for public (via IGW) and private (via NAT)

## EFS Configuration

ArangoDB data persists in EFS with:

- **Encryption**: At rest
- **Lifecycle**: Transition to Infrequent Access after 30 days
- **Mount Points**:
  - `/var/lib/arangodb3` → EFS `/arangodb/data`
  - `/var/lib/arangodb3-apps` → EFS `/arangodb/apps`
- **Access Point**: POSIX user 1000:1000

## Container Sizing

### Default Resource Allocation

**ArangoDB:**
- CPU: 1024 units (1 vCPU)
- Memory: 2048 MB (2 GB)
- Desired Count: 1 (single instance)

**Backend:**
- CPU: 256 units (0.25 vCPU)
- Memory: 512 MB
- Desired Count: 2-10 (auto-scaling enabled)

### Fargate Valid Combinations

Fargate only allows specific CPU/memory combinations:

| CPU (units) | Memory Options (MB) |
|-------------|---------------------|
| 256 (0.25)  | 512, 1024, 2048 |
| 512 (0.5)   | 1024, 2048, 3072, 4096 |
| 1024 (1)    | 2048-8192 (1GB increments) |
| 2048 (2)    | 4096-16384 (1GB increments) |
| 4096 (4)    | 8192-30720 (1GB increments) |

### Sizing by Workload

**Light Load** (< 10 concurrent users):
```hcl
# ArangoDB: 512 CPU, 1024 MB
# Backend: 512 CPU, 1024 MB
```

**Medium Load** (10-50 concurrent users) - **Current defaults**:
```hcl
# ArangoDB: 1024 CPU, 2048 MB
# Backend: 256 CPU, 512 MB (auto-scales 2-10 tasks)
```

**Heavy Load** (50-200 concurrent users):
```hcl
# ArangoDB: 2048 CPU, 4096 MB
# Backend: 1024 CPU, 2048 MB, desired_count = 3-5
```

### Cost Implications

Fargate pricing (us-east-1):
- vCPU: $0.04048/hour
- GB RAM: $0.004445/hour

**Current monthly costs** (1 ArangoDB + 2-10 Backend):
- ArangoDB: ~$36/month (1 vCPU, 2 GB)
- Backend (minimum): ~$18/month (2 tasks @ 0.25 vCPU, 512 MB each)
- Backend (maximum): ~$90/month (10 tasks @ 0.25 vCPU, 512 MB each)
- **Total: ~$54-126/month** for compute (typically ~$54-72 at normal load)

### Monitoring Usage

Monitor CloudWatch metrics to right-size:

```bash
# Check CPU utilization
aws cloudwatch get-metric-statistics \
  --namespace AWS/ECS \
  --metric-name CPUUtilization \
  --dimensions Name=ServiceName,Value=cell-kn-dev-backend \
               Name=ClusterName,Value=cell-kn-dev-cluster \
  --start-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 300 \
  --statistics Average,Maximum
```

The backend auto-scales when CPU > 70% or Memory > 80%, so you'll see task count increase automatically during traffic spikes.

## Service Discovery

Backend connects to ArangoDB via **AWS Cloud Map** (private DNS):

- **ArangoDB DNS**: `arangodb.cell-kn-dev.local`
- **Connection**: Direct within VPC (no ALB hop)
- **Benefits**: Lower latency, no extra cost, private-only access

The ALB still exposes port 8529 for external access to the ArangoDB web UI during development. For production, remove this listener.

## Dataset Versioning

ArangoDB supports **versioned dataset deployments** where you can deploy specific dataset versions without manual EFS manipulation.

### How It Works

1. **SSM Parameter** stores current dataset version: `/{project}/{environment}/arango/dataset-version`
2. **Init Container** checks SSM on startup and compares with `.dataset-version` file on EFS
3. **Auto-Restore** triggers only when version changes (not on every restart)
4. **Multiple Versions** can be kept in S3 for easy rollback

### Deploying a Dataset

```bash
# 1. Upload dataset to S3
aws s3 cp my-data.tar.gz s3://cell-kn-arangodb-data/datasets/2024-02-11-v1.2.3.tar.gz

# 2. Deploy the dataset version
./scripts/deploy-dataset.sh datasets/2024-02-11-v1.2.3.tar.gz
```

**What happens:**
- Script validates dataset exists in S3
- Updates SSM parameter with new version
- Forces ArangoDB service restart
- Init container detects version change and restores new dataset

### Checking Current Version

```bash
# Get deployed version from SSM
aws ssm get-parameter \
  --name /cell-kn/dev/arango/dataset-version \
  --query 'Parameter.Value' \
  --output text
```

### Rollback to Previous Version

```bash
# List available datasets
aws s3 ls s3://cell-kn-arangodb-data/datasets/

# Deploy previous version
./scripts/deploy-dataset.sh datasets/2024-02-10-v1.2.2.tar.gz
```

### Best Practices

**Naming Convention:**
- Use descriptive names: `datasets/YYYY-MM-DD-v{version}.tar.gz`
- Or match backend version: `datasets/v{backend-version}.tar.gz`
- Keep multiple versions in S3 for easy rollback

**Testing Flow:**
```bash
# Deploy to dev first
./scripts/deploy-dataset.sh datasets/2024-02-11-v1.2.3.tar.gz

# Verify in dev
curl https://dev.cell-kn.org/arango_api/health

# Deploy to staging/prod when ready
```

See [VERSIONED_DEPLOYMENTS.md](../VERSIONED_DEPLOYMENTS.md) for complete documentation.

## Security

### Default Configuration

- Backend and database run in private subnet (no direct internet)
- S3 bucket blocks all public access
- CloudFront uses Origin Access Control (OAC)
- EFS encrypted at rest
- SSM parameters are SecureString type
- ALB exposes ports 8000 and 8529

### Production Recommendations

1. **Restrict Database Access**: Remove port 8529 ALB listener (backend uses service discovery)
2. **Add HTTPS**: Configure ACM certificate on ALB
3. **Custom Domain**: Use Route53 with ACM for frontend and backend
4. **Secrets**: Use AWS Secrets Manager for automatic rotation
5. **Monitoring**: Enable detailed CloudWatch metrics
6. **Backups**: Configure EFS backup policy
7. **Scale Backend**: Enable auto-scaling for backend tasks based on CPU/memory

## Cleanup

```bash
# Empty S3 bucket (required before destroy)
aws s3 rm s3://$(terraform output -raw s3_bucket_name) --recursive

# Destroy all infrastructure
terraform destroy
```

## Troubleshooting

### Tasks Not Starting

Check task stopped reason:

```bash
aws ecs describe-tasks \
  --cluster cell-kn-dev-cluster \
  --tasks $(aws ecs list-tasks --cluster cell-kn-dev-cluster \
    --service cell-kn-dev-backend --query 'taskArns[0]' --output text)
```

### Health Check Failures

```bash
aws elbv2 describe-target-health \
  --target-group-arn $(aws elbv2 describe-target-groups \
    --names cell-kn-dev-backend-tg --query 'TargetGroups[0].TargetGroupArn' --output text)
```

### Database Connection Issues

1. Verify ArangoDB is running: `aws ecs describe-services --cluster cell-kn-dev-cluster --services cell-kn-dev-arangodb`
2. Check security groups allow port 8529
3. Verify `ARANGO_DB_HOST` points to ALB DNS name

## Module Reusability

Deploy multiple environments:

```hcl
# main.tf
module "dev" {
  source = "./modules/environment"

  project_name               = "cell-kn"
  environment                = "dev"
  private_subnet_cidr        = "10.0.1.0/24"
  arango_db_password         = var.dev_db_password
  django_secret_key          = var.dev_secret_key
  django_allowed_hosts       = "dev.example.com"
  django_cors_allowed_origins = "https://dev-app.example.com"
}

module "prod" {
  source = "./modules/environment"

  project_name               = "cell-kn"
  environment                = "prod"
  private_subnet_cidr        = "10.1.1.0/24"
  vpc_cidr                   = "10.1.0.0/16"  # Different VPC
  arango_db_password         = var.prod_db_password
  django_secret_key          = var.prod_secret_key
  django_allowed_hosts       = "api.example.com"
  django_cors_allowed_origins = "https://app.example.com"
}
```

## Cost Estimates

Monthly costs (us-east-1):

- **NAT Gateway**: ~$32
- **ALB**: ~$16
- **ECS Fargate**: ~$30 (2 backend + 1 db task)
- **EFS**: ~$1 (first GB free)
- **CloudFront**: Pay per use
- **S3**: Pay per use
- **ECR**: $0.10/GB/month

**Total**: ~$80-100/month for dev environment

Reduce costs by:
- Stopping ECS services when not in use
- Using smaller task sizes
- Removing NAT gateway (but lose private subnet internet)
