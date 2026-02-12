# Quick Start: Bootstrap Setup

## What You're Creating

1. ✅ **S3 Bucket** - `cell-kn-terraform-state` (remote state storage)
2. ✅ **DynamoDB Table** - `cell-kn-terraform-locks` (prevents concurrent runs)
3. ✅ **GitHub OIDC Provider** - Passwordless AWS authentication
4. ✅ **IAM Role** - `cell-kn-github-actions` (deployment permissions)

## 5-Minute Setup

### 1. Configure

```bash
cd terraform-bootstrap
cp terraform.tfvars.example terraform.tfvars
```

Edit `terraform.tfvars`:
```hcl
github_org  = "your-github-username"
github_repo = "cell-kn-mvp-ui"
```

### 2. Deploy Bootstrap

```bash
terraform init
terraform apply
```

### 3. Get Configuration

```bash
terraform output
```

Copy these values:
- `terraform_state_bucket` → Use in backend config
- `dynamodb_table_name` → Use for locking
- `github_actions_role_arn` → Add to GitHub secrets

### 4. Update Main Terraform

The `backend.tf` file is already created in `terraform/` directory with the correct configuration:

```hcl
terraform {
  backend "s3" {
    bucket         = "cell-kn-terraform-state"
    key            = "dev/terraform.tfstate"
    region         = "us-east-1"
    encrypt        = true
    dynamodb_table = "cell-kn-terraform-locks"  # ✅ DynamoDB locking
  }
}
```

### 5. Migrate State

```bash
cd ../terraform
terraform init -migrate-state
```

Done! Your Terraform state is now:
- ✅ Stored remotely in S3
- ✅ Locked with DynamoDB (no concurrent runs)
- ✅ Versioned (can rollback)
- ✅ Encrypted

## GitHub Actions Setup

Add role ARN as GitHub secret:
```bash
# Get the ARN
cd terraform-bootstrap
terraform output github_actions_role_arn
```

1. Go to GitHub repo → Settings → Secrets → Actions
2. New repository secret
3. Name: `AWS_ROLE_ARN`
4. Value: `arn:aws:iam::123456789012:role/cell-kn-github-actions`

Use in workflow:
```yaml
- uses: aws-actions/configure-aws-credentials@v4
  with:
    role-to-assume: ${{ secrets.AWS_ROLE_ARN }}
    aws-region: us-east-1
```

## DynamoDB Locking Explained

**What it does:**
- Prevents two Terraform runs from happening simultaneously
- Stores a lock record when Terraform is running
- Automatically releases lock when done

**How it works:**
```
Terraform Run 1 starts
  ↓
Creates lock in DynamoDB table
  ↓
Terraform Run 2 starts
  ↓
Sees lock exists → WAITS
  ↓
Run 1 finishes → Deletes lock
  ↓
Run 2 acquires lock → Continues
```

**Cost:** ~$0.0025 per Terraform run (pennies!)

**Check current locks:**
```bash
aws dynamodb scan --table-name cell-kn-terraform-locks
```

That's it! State management is now production-ready.
