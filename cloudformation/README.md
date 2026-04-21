# NLM-CKN CloudFormation Infrastructure

CloudFormation-based infrastructure for deploying the NLM-CKN application to AWS.

**IMPORTANT**: All stacks must be deployed in `us-east-1` due to CloudFront's ACM certificate region requirement.

→ **[Deployment Guide](DEPLOYMENT.md)** — step-by-step deploy instructions
→ **[Troubleshooting](TROUBLESHOOTING.md)** — common issues and fixes


## Environments

| Environment | Account | IAM / Security Group Access |
|---|---|---|
| `dev` | Our account (full access) | CloudFormation creates all resources |
| `sandbox` | NIH restricted account | IAM roles and security groups must be pre-created manually |
| `prod` | NIH restricted account | IAM roles and security groups must be pre-created manually |



## Architecture

```
Bootstrap Stack (one-time, dev account only)
├── S3 bucket for templates
├── S3 bucket for state/outputs
├── GitHub OIDC provider
└── IAM role for GitHub Actions

Shared Resources Stack (one-time, shared across environments)
├── ECR repository (backend Docker images)
└── S3 bucket (ArangoDB datasets)

Environment Stack (per environment: dev, sandbox, prod)
├── Secrets (Lambda generates ArangoDB password, Django key, CloudFront secret)
├── Security Groups (ALB, backend, ArangoDB EC2)  ← must be pre-created in NIH accounts
├── ECS Cluster
├── Service Discovery (Cloud Map)
├── Application Load Balancer
├── ArangoDB EC2 Instance (EBS persistence, S3 restore via UserData)
├── Backend ECS Service (auto-scaling 2-10 tasks)
└── Frontend (S3, CloudFront, ACM certificate)

Note: VPC and subnets are NIH-provided and taken as stack parameters
```



## File Structure

```
cloudformation/
├── README.md                           # This file
├── DEPLOYMENT.md                       # Step-by-step deployment guide (incl. NIH considerations)
├── TROUBLESHOOTING.md                  # Common issues and fixes
├── bootstrap/
│   └── bootstrap.yaml                  # Bootstrap stack
├── shared/
│   └── shared-resources.yaml           # Shared ECR and S3
├── environment/
│   ├── main.yaml                       # Orchestrator (nested stacks)
│   ├── secrets.yaml                    # Lambda generates all random secrets
│   ├── security-groups.yaml            # Security groups
│   ├── ecs-cluster.yaml                # ECS cluster
│   ├── service-discovery.yaml          # Cloud Map
│   ├── alb.yaml                        # Load balancer
│   ├── arangodb.yaml                   # ArangoDB EC2 instance + EBS
│   ├── backend.yaml                    # Backend service + auto-scaling
│   └── frontend.yaml                   # S3 + CloudFront + ACM
├── scripts/
│   ├── deploy-bootstrap.sh             # Deploy bootstrap
│   ├── deploy-shared.sh                # Deploy shared resources
│   ├── deploy-environment.sh           # Deploy environment stack
│   ├── deploy-backend.sh               # Build and deploy backend image
│   └── deploy-dataset.sh              # Load ArangoDB dataset
└── parameters/
    └── dev.json.example                # Example parameters file
```

## Parameters Reference

### Required

| Parameter | Description | Example |
|-----------|-------------|---------|
| `ProjectName` | Project name | `cell-kn` |
| `Environment` | Environment name | `dev`, `sandbox`, `prod` |
| `VpcId` | VPC ID (NIH-provided) | `vpc-12345678` |
| `VpcCidr` | VPC CIDR for security group rules | `10.x.x.x/16` |
| `PublicSubnetIds` | Public subnet IDs for ALB (min 2) | `subnet-abc123,subnet-def456` |
| `PrivateSubnetIds` | Private subnet IDs for ECS tasks (min 1) | `subnet-ghi789,subnet-jkl012` |
| `DomainName` | Base domain name | `cell-kn-mvp.org` |
| `HostedZoneId` | Route 53 hosted zone ID | `Z018047920VCMG6465Q74` |

### Optional

| Parameter | Default | Description |
|-----------|---------|-------------|
| `ArangoDbUser` | `root` | ArangoDB username |
| `PrivateSubnetCount` | `2` | Number of private subnets (1 or 2) |

## Stack Exports

### From Shared Resources Stack

```
cell-kn-shared-ecr-url              # ECR repository URL
cell-kn-shared-ecr-arn              # ECR repository ARN
cell-kn-shared-ecr-name             # ECR repository name
cell-kn-shared-arangodb-bucket      # S3 bucket name for datasets
cell-kn-shared-arangodb-bucket-arn  # S3 bucket ARN
```

### From Environment Stack

```
cell-kn-<env>-vpc-id                    # VPC ID
cell-kn-<env>-ecs-cluster-name          # ECS cluster name (backend only)
cell-kn-<env>-alb-dns-name              # ALB DNS name
cell-kn-<env>-cloudfront-domain         # CloudFront domain name
cell-kn-<env>-backend-url               # Backend URL
cell-kn-<env>-frontend-url              # Frontend URL
cell-kn-<env>-arangodb-instance-id      # ArangoDB EC2 instance ID
cell-kn-<env>-arangodb-private-ip       # ArangoDB EC2 private IP
cell-kn-<env>-arangodb-dns              # ArangoDB Cloud Map DNS name
cell-kn-<env>-dataset-version-param     # SSM parameter name for dataset version
```



## Security

### Traffic flow

All public traffic enters through CloudFront (HTTPS). The ALB is internet-facing but protected by a shared secret header — requests without the correct `X-Custom-Origin-Header` value are rejected with `403 Forbidden` at the listener level before reaching any ECS task.

```
Browser → CloudFront (HTTPS) → ALB (HTTP, header-gated) → ECS tasks / EC2 instance (private subnet)
```

### Origin secret enforcement

CloudFront sets `X-Custom-Origin-Header: <secret>` on every request to the ALB. Each ALB listener (ports 8000 and 8529) has a listener rule that only forwards requests carrying the correct value; everything else gets a `403`. The secret is randomly generated by CloudFormation on first deploy and never entered manually.

### ArangoDB access

The ArangoDB web UI and REST API are routed through CloudFront at `/_db/*`, `/_api/*`, and `/_admin/*` — they are not directly exposed. Direct requests to the ALB on port 8529 without the origin secret are rejected.

### Encryption

| Layer | Mechanism |
|-------|-----------|
| In transit (browser → CloudFront) | TLS 1.2+ enforced by CloudFront viewer policy |
| In transit (CloudFront → ALB) | HTTP within AWS network; protected by origin secret |
| In transit (ALB → backend ECS tasks) | HTTP within private VPC subnet |
| In transit (ALB → ArangoDB EC2) | HTTP within private VPC subnet |
| EBS at rest (ArangoDB data volume) | AWS-managed encryption key (gp3, `Encrypted: true`) |
| S3 at rest | AES-256 |
| ECR at rest | AES-256 |
| SSM parameters | Standard (plaintext) for non-sensitive config (hostnames, user IDs, version tracking) |
| Secrets Manager secrets | AES-256 encrypted at rest for sensitive credentials (passwords, keys) |

### Secrets management

All application secrets (ArangoDB password, Django secret key, CloudFront origin secret) are generated by a Lambda-backed CloudFormation custom resource on first deploy and stored in **AWS Secrets Manager** (encrypted at rest). Secrets are stable across stack updates — re-deploying will never rotate them. Consumers reference secrets via `{{resolve:secretsmanager:...}}` dynamic references or Secrets Manager ARNs in ECS task definitions and EC2 UserData; the plaintext values are never stored in SSM Parameter Store or CloudFormation outputs.

---

## Cost

Estimated monthly cost per environment: **~$83-139/month**

| Service | Estimated Cost |
|---------|----------------|
| ECS Fargate (backend, 2-10 tasks auto-scaling) | $35-80/month |
| EC2 t4g.medium (ArangoDB, 1 instance) | ~$25/month |
| EBS gp3 50 GB (ArangoDB data volume) | ~$4/month |
| Application Load Balancer | $16/month |
| S3 (frontend + datasets) | $1-5/month |
| CloudFront | $1-5/month |
| CloudWatch Logs | $1-3/month |

**Note**: NAT Gateway (~$32/month) and VPC costs are not included — these are NIH-provided infrastructure costs.
