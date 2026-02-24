# Deployment Guide

## Prerequisites

- AWS CLI configured with appropriate credentials
- Docker installed and running (for backend image builds)
- `git` available

**IMPORTANT**: All stacks must be deployed in `us-east-1` due to CloudFront's ACM certificate region requirement.

### Infrastructure

The following resources must already exist in your AWS account before deploying. VPC and subnets are taken as stack parameters — this stack does not create them.

| Resource | Minimum | Notes |
|----------|---------|-------|
| VPC | 1 | You'll provide the VPC ID and CIDR |
| Public subnets | 2 | Different AZs; must have route to Internet Gateway; used by ALB |
| Private subnets | 1 (2 recommended) | Must have route to NAT Gateway; used by ECS tasks |
| Route 53 hosted zone | 1 | For custom domain DNS and ACM certificate validation |

### Restricted Accounts (sandbox/prod)

The NIH `sandbox` and `prod` accounts do not permit CloudFormation to create or modify IAM roles or EC2 security groups. The resources listed below must be created manually (or via a privileged NIH request) **before** running the environment stack deployment.
#### IAM Roles (5 per environment)

All ECS roles use a trust policy for `ecs-tasks.amazonaws.com`. The Lambda role trusts `lambda.amazonaws.com`.

| Role Name | Used By | Trust Policy | Required Permissions |
|-----------|---------|--------------|----------------------|
| `cell-kn-<env>-arangodb-exec` | `arangodb.yaml` ECS task execution | `ecs-tasks.amazonaws.com` | AWS managed: `AmazonECSTaskExecutionRolePolicy`; inline: `ssm:GetParameter`, `ssm:GetParameters` on `arn:aws:ssm:*:*:parameter/cell-kn/<env>/*` |
| `cell-kn-<env>-arangodb-task` | `arangodb.yaml` ArangoDB container runtime | `ecs-tasks.amazonaws.com` | `s3:GetObject`, `s3:PutObject`, `s3:ListBucket` on the ArangoDB data bucket; `ssm:GetParameter` on `arn:aws:ssm:*:*:parameter/cell-kn/<env>/arango/*` |
| `cell-kn-<env>-backend-exec` | `backend.yaml` ECS task execution | `ecs-tasks.amazonaws.com` | AWS managed: `AmazonECSTaskExecutionRolePolicy`; inline: `ssm:GetParameter`, `ssm:GetParameters` on `arn:aws:ssm:*:*:parameter/cell-kn/<env>/*` |
| `cell-kn-<env>-backend-task` | `backend.yaml` backend container runtime | `ecs-tasks.amazonaws.com` | No additional permissions required |
| `cell-kn-<env>-random-secret-fn` | `secrets.yaml` Lambda for secret generation | `lambda.amazonaws.com` | AWS managed: `AWSLambdaBasicExecutionRole` |

> Replace `<env>` with `sandbox` or `prod`.

#### Security Groups (4 per environment)

All security groups must be created in the NIH-provided VPC. Replace `<VPC_CIDR>` with the actual VPC CIDR (e.g. `10.x.x.x/16`).

| Name | Inbound Rules | Outbound |
|------|---------------|----------|
| `cell-kn-<env>-alb-sg` | TCP 80 from `0.0.0.0/0`; TCP 443 from `0.0.0.0/0`; TCP 8000 from `<VPC_CIDR>`; TCP 8529 from `<VPC_CIDR>` | All traffic |
| `cell-kn-<env>-backend-sg` | TCP 8000 from `<VPC_CIDR>` | All traffic |
| `cell-kn-<env>-arangodb-sg` | TCP 8529 from `<VPC_CIDR>` | All traffic |
| `cell-kn-<env>-efs-sg` | TCP 2049 (NFS) from `<VPC_CIDR>` | All traffic |

> In `dev`, the ALB security group opens ports 8000 and 8529 publicly (`0.0.0.0/0`) for direct access. The `sandbox`/`prod` rules above intentionally restrict these to VPC CIDR only.

#### How the templates consume these resources

When `Environment` is not `dev`, the templates skip creating IAM roles and security groups and instead read the pre-created resource IDs/ARNs from SSM Parameter Store. **The stack will fail at deploy time if any of these SSM parameters are missing**, which acts as an explicit pre-flight check.

Populate the following SSM parameters in the NIH account **before** running `deploy-environment.sh` (in `scripts/infra/`):

```bash
ENV=sandbox   # or prod
PROJECT=cell-kn

# Security group IDs (from the groups created above)
aws ssm put-parameter --name "/${PROJECT}/${ENV}/prereqs/sg-alb"      --value "sg-xxxxxxxxxx" --type String
aws ssm put-parameter --name "/${PROJECT}/${ENV}/prereqs/sg-backend"   --value "sg-xxxxxxxxxx" --type String
aws ssm put-parameter --name "/${PROJECT}/${ENV}/prereqs/sg-arangodb"  --value "sg-xxxxxxxxxx" --type String
aws ssm put-parameter --name "/${PROJECT}/${ENV}/prereqs/sg-efs"       --value "sg-xxxxxxxxxx" --type String

# IAM role ARNs (from the roles created above)
aws ssm put-parameter --name "/${PROJECT}/${ENV}/prereqs/iam-arangodb-exec-arn"    --value "arn:aws:iam::ACCOUNT:role/cell-kn-${ENV}-arangodb-exec"    --type String
aws ssm put-parameter --name "/${PROJECT}/${ENV}/prereqs/iam-arangodb-task-arn"    --value "arn:aws:iam::ACCOUNT:role/cell-kn-${ENV}-arangodb-task"    --type String
aws ssm put-parameter --name "/${PROJECT}/${ENV}/prereqs/iam-backend-exec-arn"     --value "arn:aws:iam::ACCOUNT:role/cell-kn-${ENV}-backend-exec"     --type String
aws ssm put-parameter --name "/${PROJECT}/${ENV}/prereqs/iam-backend-task-arn"     --value "arn:aws:iam::ACCOUNT:role/cell-kn-${ENV}-backend-task"     --type String
aws ssm put-parameter --name "/${PROJECT}/${ENV}/prereqs/iam-random-secret-fn-arn" --value "arn:aws:iam::ACCOUNT:role/cell-kn-${ENV}-random-secret-fn" --type String
```

Once all 9 parameters exist, `scripts/infra/deploy-environment.sh sandbox` (or `prod`) will proceed without attempting to create any IAM or security group resources.



## Quickstart

### 1. Gather Infrastructure Information

Collect these values from your AWS account before deploying:

```bash
# Find your VPC ID and CIDR
aws ec2 describe-vpcs \
  --query 'Vpcs[*].[VpcId,CidrBlock,Tags[?Key==`Name`].Value|[0]]' \
  --output table

# Find subnet IDs (MapPublicIpOnLaunch=true indicates public subnets)
aws ec2 describe-subnets \
  --filters "Name=vpc-id,Values=vpc-YOUR_VPC_ID" \
  --query 'Subnets[*].[SubnetId,AvailabilityZone,CidrBlock,MapPublicIpOnLaunch,Tags[?Key==`Name`].Value|[0]]' \
  --output table

# Find your Route 53 hosted zone ID
aws route53 list-hosted-zones --query 'HostedZones[*].[Id,Name]' --output table
```

### 2. Account Setup (one-time per account)

Creates the S3 template bucket, GitHub Actions OIDC role, ECR repository, and ArangoDB dataset S3 bucket. Run once per AWS account.

> **Note**: Edit `GITHUB_ORG` in `scripts/infra/deploy-account-setup.sh` before running.

```bash
./scripts/infra/deploy-account-setup.sh
```

The script displays the target account and prompts for confirmation before deploying anything.


### 3. Push Initial Backend Image

The environment stack creates the ECS service referencing `${ECR_URL}:latest`. If no image exists in ECR when the stack deploys, the service will start but tasks will immediately fail — the app won't be reachable until an image is pushed. Push the image first so the service comes up healthy on the first deploy.

```bash
./scripts/app/push-backend-image.sh
```

This only requires the account setup to be complete (ECR URL is read from SSM). It does not require the environment stack. Builds the image from the current git SHA, pushes it, and also tags it as `latest`.

### 4. Deploy Environment Stack

**Note**: `ArangoDbPassword`, `DjangoSecretKey`, and the CloudFront origin secret are randomly generated by CloudFormation on first deploy — no need to supply them.

#### dev

```bash
cp cloudformation/parameters/dev.json.example cloudformation/parameters/dev.json
# Edit dev.json with your VPC/subnet/domain values, then:
./scripts/infra/deploy-environment.sh dev
```

#### sandbox / prod (NIH restricted accounts)

Before deploying to a restricted account, IAM roles and security groups must be pre-created and their IDs stored in SSM. See [Restricted Accounts (sandbox/prod)](#restricted-accounts-sandboxprod) in the Prerequisites section above.

```bash
cp cloudformation/parameters/dev.json.example cloudformation/parameters/sandbox.json
# Edit sandbox.json with NIH VPC/subnet/domain values, then:
./scripts/infra/deploy-environment.sh sandbox
```


### 5. Deploy Backend Application

For subsequent deploys, build and push an updated backend image:

```bash
./scripts/app/deploy-backend.sh dev   # or sandbox / prod
```

This builds with the current git SHA as the image tag, pushes to ECR, and updates the ECS service.

### 6. Deploy Frontend Application

```bash
./scripts/app/deploy-frontend.sh dev   # or sandbox / prod
```

**Tip**: To deploy both backend and frontend together, use:

```bash
./scripts/app/deploy-all.sh
```

### 7. Deploy Dataset (optional)

To load an ArangoDB dataset from S3:

```bash
./scripts/app/deploy-dataset.sh dev datasets/your-file.tar.gz
```

### 8. Validate Deployment

```bash
# Check stack status
aws cloudformation describe-stacks \
  --stack-name cell-kn-dev \
  --query 'Stacks[0].StackStatus'

# Get service URLs
aws cloudformation describe-stacks \
  --stack-name cell-kn-dev \
  --query 'Stacks[0].Outputs[?OutputKey==`FrontendUrl` || OutputKey==`BackendUrl` || OutputKey==`AlbDnsName`].[OutputKey,OutputValue]' \
  --output table

# Test backend health
ALB=$(aws cloudformation describe-stacks \
  --stack-name cell-kn-dev \
  --query 'Stacks[0].Outputs[?OutputKey==`AlbDnsName`].OutputValue' \
  --output text)
curl http://$ALB:8000/health

# Check ECS service status
aws ecs describe-services \
  --cluster cell-kn-dev-cluster \
  --services cell-kn-dev-backend cell-kn-dev-arangodb \
  --query 'services[*].{Name:serviceName,Status:status,Desired:desiredCount,Running:runningCount}' \
  --output table

# Verify security groups (dev)
aws ec2 describe-security-groups \
  --filters "Name=tag:Project,Values=cell-kn" "Name=tag:Environment,Values=dev" \
  --query 'SecurityGroups[*].[GroupId,GroupName]' \
  --output table
```

## NIH-Specific Considerations

### Required IAM permissions

Your NIH AWS account may have restricted IAM permissions. The deployment user/role needs:

| Service | Required Access |
|---------|----------------|
| ECS | Create/manage clusters, services, task definitions |
| ECR | Create/manage repositories |
| S3 | Create/manage buckets |
| CloudFront | Create/manage distributions |
| Route 53 | Create/manage records in hosted zone |
| ACM | Create/manage certificates |
| IAM | Create service roles (dev only; sandbox/prod use pre-created roles) |
| CloudWatch | Create log groups |
| Lambda | Create functions (for secrets generation) |
| SSM | Read/write parameters |

### Data residency

All data remains within your NIH AWS account and region:
- EFS: encrypted at rest, stays in region
- S3: encrypted at rest (AES256), stays in region
- CloudWatch Logs: stays in region

The ACM certificate is created in `us-east-1` (required by CloudFront) but contains no application data.

### Encryption

All storage is encrypted by default:

| Service | Default | Upgrade to CMK |
|---------|---------|----------------|
| EFS | AWS-managed key | Change `KmsKeyId` in `arangodb.yaml` |
| S3 | AES256 | Change `SSEAlgorithm` to `aws:kms` |
| ECR | AES256 | Configure at repository level |
| CloudWatch Logs | Default | Add `KmsKeyId` to log group |

### Compliance tagging

All resources are tagged with `Project`, `Environment`, and `ManagedBy: CloudFormation`. To add NIH-required compliance tags, add them to the `Tags` sections in each template:

```yaml
- Key: CostCenter
  Value: YOUR-NIH-COST-CENTER
- Key: DataClassification
  Value: PHI
- Key: ComplianceFramework
  Value: HIPAA
```
