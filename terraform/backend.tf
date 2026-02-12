# Backend configuration for Terraform state
# This file is created after running terraform-bootstrap

terraform {
  backend "s3" {
    bucket         = "cell-kn-terraform-state"
    key            = "dev/terraform.tfstate"
    region         = "us-east-1"
    encrypt        = true
    dynamodb_table = "cell-kn-terraform-locks"

    # Uncomment when using GitHub Actions with OIDC
    # role_arn = "arn:aws:iam::ACCOUNT_ID:role/cell-kn-github-actions"
  }
}
