# Environment Module Structure

This module creates a complete Cell-KN application environment on AWS. The infrastructure is organized into logical files grouping related resources together.

## File Organization

### Core Configuration

- **`locals.tf`** - Data sources (AWS account, region, AZs) and local variables (naming, domain config, network calculations, tags)
- **`variables.tf`** - Module input variables
- **`outputs.tf`** - Module outputs
- **`providers.tf`** - Provider configuration (requires AWS us-east-1 alias for ACM certificates)

### Infrastructure Components

- **`networking.tf`** - VPC, subnets (public/private), Internet Gateway, NAT Gateway, route tables
- **`alb.tf`** - Application Load Balancer, security group, target groups (backend, ArangoDB), listeners
- **`ecs-cluster.tf`** - Shared ECS cluster with Container Insights enabled
- **`service-discovery.tf`** - AWS Cloud Map private DNS namespace and ArangoDB service discovery

### Application Services

- **`frontend.tf`** - Complete frontend stack:
  - S3 bucket (versioned, encrypted, private)
  - CloudFront distribution (S3 + ALB origins, custom domain support)
  - ACM certificate (DNS-validated in us-east-1)
  - Route 53 A record (when custom domain configured)
  - CloudFront secret header for ALB verification

- **`arangodb.tf`** - Complete ArangoDB database stack:
  - S3 bucket for backups/restore (versioned, encrypted)
  - EFS file system (encrypted, lifecycle policy)
  - EFS security group and mount target
  - EFS access point (POSIX user 1000:1000)
  - SSM parameters for credentials (SecureString)
  - Security group for ECS tasks
  - IAM roles (task execution + task role with S3/SSM/EFS permissions)
  - CloudWatch log group
  - ECS task definition (multi-container with S3 restore sidecar)
  - ECS service (single instance, service discovery enabled)

- **`backend.tf`** - Complete Django backend stack:
  - ECR repository (image scanning enabled)
  - Security group for ECS tasks
  - IAM roles (task execution + task role)
  - CloudWatch log group
  - ECS task definition (single container)
  - ECS service (2+ instances with auto-scaling)
  - Auto-scaling target (2-10 instances)
  - Auto-scaling policies (CPU and memory based)

## Design Principles

1. **Functionality Grouping**: All resources for a feature are together (e.g., ArangoDB file includes IAM, EFS, S3, ECS, etc.)
2. **Self-Contained**: Each service file contains everything needed for that service to function
3. **Shared Resources**: Common infrastructure (VPC, ALB, ECS cluster) in dedicated files
4. **Logical Organization**: Files are named by their primary purpose/service

## Dependencies

Files have natural dependencies that Terraform resolves automatically:

```
locals.tf (provides variables for all files)
    ↓
networking.tf (provides VPC, subnets)
    ↓
├── alb.tf (uses subnets, VPC)
├── ecs-cluster.tf (standalone)
├── service-discovery.tf (uses VPC)
├── frontend.tf (uses ALB, uses ACM from us-east-1)
├── arangodb.tf (uses private subnet, ECS cluster, ALB target group, service discovery)
└── backend.tf (uses private subnet, ECS cluster, ALB target group)
```

## Resource Count by File

- `networking.tf`: 10 resources (VPC, IGW, subnets, NAT, route tables)
- `alb.tf`: 7 resources (ALB, SG, target groups, listeners)
- `frontend.tf`: 11 resources + 3 conditional (S3, CloudFront, ACM, Route 53)
- `arangodb.tf`: ~28 resources (S3, EFS, SSM, IAM, ECS, logs)
- `backend.tf`: ~20 resources (ECR, IAM, ECS, auto-scaling, logs)
- `service-discovery.tf`: 2 resources (namespace, service)
- `ecs-cluster.tf`: 1 resource

**Total: ~82 resources** (varies based on custom domain configuration)

## Adding New Services

To add a new service to this environment:

1. Create a new `<service>.tf` file
2. Include all related resources:
   - Security groups
   - IAM roles (execution + task)
   - CloudWatch log groups
   - ECS task definition
   - ECS service
   - Any storage (S3, EFS, RDS)
   - Any secrets (SSM parameters)
3. Add outputs to `outputs.tf` if needed
4. Update this README with the new file

## Removing Resources

To remove a service, simply delete its `.tf` file. Terraform will detect the removed resources on the next plan/apply.

**Warning**: Always run `terraform plan` first to verify what will be destroyed.
