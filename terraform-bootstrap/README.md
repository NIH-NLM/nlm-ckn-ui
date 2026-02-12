# Terraform Bootstrap

This directory contains infrastructure for Terraform state management and GitHub Actions authentication.

## What It Creates

1. **S3 Bucket** - Remote state storage (`cell-kn-terraform-state`)
   - Versioning enabled
   - Encryption enabled
   - Public access blocked
   - Lifecycle: expire old versions after 90 days

2. **DynamoDB Table** - State locking (`cell-kn-terraform-locks`)
   - Prevents concurrent Terraform runs
   - Pay-per-request billing

3. **GitHub OIDC Provider** - Passwordless authentication
   - Allows GitHub Actions to authenticate with AWS
   - No long-lived credentials needed

4. **IAM Role** - GitHub Actions deployment role
   - Assumes role via OIDC
   - Scoped to specific GitHub repository
   - Admin access (can be scoped down for production)

## Prerequisites

- AWS CLI configured with admin credentials
- Terraform installed
- GitHub repository URL

## Setup Instructions

### 1. Configure Variables

```bash
cd terraform-bootstrap
cp terraform.tfvars.example terraform.tfvars
```

Edit `terraform.tfvars`:
```hcl
aws_region  = "us-east-1"
project_name = "cell-kn"
github_org   = "your-github-org"      # Your GitHub org or username
github_repo  = "cell-kn-mvp-ui"       # Your repository name
```

### 2. Deploy Bootstrap Infrastructure

```bash
terraform init
terraform plan
terraform apply
```

**Important:** This is the only Terraform that runs with local state. All other Terraform will use the S3 backend created here.

### 3. Note the Outputs

```bash
terraform output
```

You'll see:
- `terraform_state_bucket` - Use this in backend config
- `github_actions_role_arn` - Use this in GitHub Actions
- `dynamodb_table_name` - Use this for state locking

### 4. Update Main Terraform Backend

The bootstrap outputs show you what to put in `terraform/backend.tf`:

```bash
# Get the configuration
terraform output backend_config
```

Update `terraform/backend.tf`:
```hcl
terraform {
  backend "s3" {
    bucket         = "cell-kn-terraform-state"
    key            = "dev/terraform.tfstate"
    region         = "us-east-1"
    encrypt        = true
    dynamodb_table = "cell-kn-terraform-locks"
  }
}
```

### 5. Migrate Existing State (if applicable)

If you already have Terraform state locally:

```bash
cd ../terraform

# Initialize with new backend
terraform init -migrate-state

# Verify
terraform state list
```

### 6. Configure GitHub Actions

Add this to your GitHub Actions workflow:

```yaml
name: Deploy

on:
  push:
    branches: [main]

permissions:
  id-token: write   # Required for OIDC
  contents: read

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Configure AWS Credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${{ secrets.AWS_ROLE_ARN }}
          aws-region: us-east-1

      - name: Setup Terraform
        uses: hashicorp/setup-terraform@v3

      - name: Terraform Init
        run: terraform init
        working-directory: terraform

      - name: Terraform Plan
        run: terraform plan
        working-directory: terraform

      - name: Terraform Apply
        if: github.ref == 'refs/heads/main'
        run: terraform apply -auto-approve
        working-directory: terraform
```

Add the role ARN as a GitHub secret:
```bash
# Get role ARN
cd terraform-bootstrap
terraform output github_actions_role_arn

# Add to GitHub:
# Settings → Secrets → Actions → New repository secret
# Name: AWS_ROLE_ARN
# Value: arn:aws:iam::123456789012:role/cell-kn-github-actions
```

## Multiple Environments

For staging and prod environments, use different state keys:

### Staging
```hcl
# terraform-staging/backend.tf
terraform {
  backend "s3" {
    bucket         = "cell-kn-terraform-state"
    key            = "staging/terraform.tfstate"  # Different key
    region         = "us-east-1"
    encrypt        = true
    dynamodb_table = "cell-kn-terraform-locks"
  }
}
```

### Production
```hcl
# terraform-prod/backend.tf
terraform {
  backend "s3" {
    bucket         = "cell-kn-terraform-state"
    key            = "prod/terraform.tfstate"  # Different key
    region         = "us-east-1"
    encrypt        = true
    dynamodb_table = "cell-kn-terraform-locks"
  }
}
```

## Security Best Practices

### 1. Scope Down IAM Permissions (Production)

The default setup uses `AdministratorAccess` for simplicity. For production:

1. Edit `terraform-bootstrap/main.tf`
2. Comment out `aws_iam_role_policy_attachment.github_actions_admin`
3. Uncomment and customize `aws_iam_role_policy.github_actions_scoped`
4. Add only the services you need (ECS, ECR, S3, CloudFront, etc.)

### 2. Restrict GitHub Repository

The OIDC role is already scoped to your specific repository:
```hcl
"token.actions.githubusercontent.com:sub" = "repo:your-org/your-repo:*"
```

You can further restrict to specific branches:
```hcl
"token.actions.githubusercontent.com:sub" = "repo:your-org/your-repo:ref:refs/heads/main"
```

### 3. Enable MFA Delete on State Bucket

For production:
```bash
aws s3api put-bucket-versioning \
  --bucket cell-kn-terraform-state \
  --versioning-configuration Status=Enabled,MFADelete=Enabled \
  --mfa "arn:aws:iam::ACCOUNT_ID:mfa/USER TOKENCODE"
```

### 4. Add Bucket Logging

```hcl
resource "aws_s3_bucket_logging" "terraform_state" {
  bucket = aws_s3_bucket.terraform_state.id

  target_bucket = aws_s3_bucket.logs.id
  target_prefix = "terraform-state-logs/"
}
```

## Disaster Recovery

### Restore from S3 Versioning

If state is corrupted:

```bash
# List versions
aws s3api list-object-versions \
  --bucket cell-kn-terraform-state \
  --prefix dev/terraform.tfstate

# Restore specific version
aws s3api copy-object \
  --bucket cell-kn-terraform-state \
  --copy-source cell-kn-terraform-state/dev/terraform.tfstate?versionId=VERSION_ID \
  --key dev/terraform.tfstate
```

### Backup State Locally

```bash
# Download current state
aws s3 cp s3://cell-kn-terraform-state/dev/terraform.tfstate ./terraform.tfstate.backup

# Restore if needed
aws s3 cp ./terraform.tfstate.backup s3://cell-kn-terraform-state/dev/terraform.tfstate
```

## Troubleshooting

### "Error acquiring the state lock"

Someone else is running Terraform, or a previous run crashed:

```bash
# Check lock
aws dynamodb get-item \
  --table-name cell-kn-terraform-locks \
  --key '{"LockID":{"S":"cell-kn-terraform-state/dev/terraform.tfstate-md5"}}'

# Force unlock (use with caution!)
terraform force-unlock LOCK_ID
```

### "Access Denied" on GitHub Actions

1. Verify role ARN is correct in GitHub secrets
2. Check OIDC provider thumbprint is current
3. Verify repository name matches condition in assume role policy

```bash
# Update OIDC thumbprint if needed
terraform apply -replace="aws_iam_openid_connect_provider.github"
```

### State Bucket Doesn't Exist

If you deleted the bucket:

1. Remove backend config from `terraform/backend.tf` temporarily
2. Recreate bootstrap infrastructure
3. Re-add backend config
4. Run `terraform init -migrate-state`

## Cost

**Very low:**
- S3: ~$0.023/GB/month + requests
- DynamoDB: Pay-per-request (pennies for Terraform operations)
- IAM: Free

Typical monthly cost: **< $1**

## Cleanup

⚠️ **WARNING:** Only do this if you're sure you want to delete everything!

```bash
# Delete all Terraform state first
cd ../terraform
terraform destroy

# Then delete bootstrap (this deletes the state bucket!)
cd ../terraform-bootstrap
terraform destroy
```

## Summary

**One-time setup:**
```bash
cd terraform-bootstrap
terraform init
terraform apply
```

**Configure main Terraform:**
```bash
cd ../terraform
# Update backend.tf with outputs from bootstrap
terraform init -migrate-state
```

**Deploy from GitHub Actions:**
- Push to main branch
- GitHub Actions uses OIDC to assume AWS role
- Terraform reads/writes state to S3
- DynamoDB prevents concurrent runs

No AWS credentials in GitHub! 🎉
