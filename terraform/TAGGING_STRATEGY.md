# Tagging Strategy

All AWS resources are tagged with `Project="cell-kn"` for consistent resource identification and cost tracking.

## Tag Structure

### Bootstrap Resources (terraform-bootstrap/)
All bootstrap resources have these tags:
```hcl
{
  Project     = "cell-kn"
  Name        = "<resource-name>"
  Purpose     = "<resource-purpose>"
  ManagedBy   = "Terraform"
  Environment = "shared"  # Bootstrap resources are shared
}
```

**Resources:**
- S3 bucket: `cell-kn-terraform-state`
- DynamoDB table: `cell-kn-terraform-locks`
- OIDC provider: `cell-kn-github-oidc`
- IAM role: `cell-kn-github-actions`

### Shared Resources (terraform/modules/shared/)
Shared resources (ECR, S3) have these tags:
```hcl
{
  Project = "cell-kn"
  Name    = "<resource-name>"
  Shared  = "true"
  Purpose = "<resource-purpose>"
}
```

**Resources:**
- ECR repository: `cell-kn-backend`
- S3 bucket: `cell-kn-arangodb-data`

### Environment-Specific Resources (terraform/modules/environment/)
All environment resources inherit from `local.tags`:
```hcl
locals {
  tags = merge(
    {
      Project     = var.project_name  # "cell-kn"
      Environment = var.environment   # "dev", "staging", or "prod"
      ManagedBy   = "Terraform"
    },
    var.tags  # Additional custom tags
  )
}
```

Every resource uses: `tags = merge(local.tags, { Name = "<resource-name>" })`

**Environment resources include:**
- VPC and networking (subnets, gateways, route tables)
- ECS cluster and services (backend, arangodb)
- ALB and target groups
- CloudFront distribution
- S3 bucket (frontend)
- EFS file system
- IAM roles and policies
- CloudWatch log groups
- SSM parameters
- Security groups

## Verification

### Query all resources by project:
```bash
# Using AWS CLI
aws resourcegroupstaggingapi get-resources \
  --tag-filters Key=Project,Values=cell-kn \
  --query 'ResourceTagMappingList[].ResourceARN'

# Count resources by environment
aws resourcegroupstaggingapi get-resources \
  --tag-filters Key=Project,Values=cell-kn Key=Environment,Values=dev \
  --query 'length(ResourceTagMappingList)'
```

### Cost tracking by project:
```bash
# In AWS Cost Explorer, filter by:
# Tag: Project = cell-kn

# Or by environment:
# Tag: Project = cell-kn AND Environment = dev
```

## Configuration

### Main Terraform (terraform/)
```hcl
# variables.tf
variable "project_name" {
  description = "Project name for resource naming"
  type        = string
  default     = "cell-kn"  # Default value ensures consistent tagging
}

# terraform.tfvars
project_name = "cell-kn"
```

### Bootstrap Terraform (terraform-bootstrap/)
```hcl
# terraform.tfvars
project_name = "cell-kn"
```

## Benefits

1. **Cost Allocation**: Track spending by project across all environments
2. **Resource Discovery**: Find all resources related to cell-kn project
3. **Environment Isolation**: Separate dev/staging/prod costs
4. **Automation**: Tag-based automation and cleanup scripts
5. **Compliance**: Consistent tagging across all resources

## Example Queries

### Find all dev environment resources:
```bash
aws resourcegroupstaggingapi get-resources \
  --tag-filters \
    Key=Project,Values=cell-kn \
    Key=Environment,Values=dev
```

### Find all shared resources:
```bash
aws resourcegroupstaggingapi get-resources \
  --tag-filters \
    Key=Project,Values=cell-kn \
    Key=Shared,Values=true
```

### Monthly cost by environment:
```bash
# In AWS Cost Explorer:
# Group by: Tag -> Environment
# Filter: Tag:Project = cell-kn
# Time range: Last 30 days
```
