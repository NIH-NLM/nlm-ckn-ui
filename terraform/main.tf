terraform {
  required_version = ">= 1.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

# CloudFront requires ACM certificates to be in us-east-1
provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"
}

# ============================================================================
# Shared Resources (Created once, used by all environments)
# ============================================================================

module "shared" {
  source = "./modules/shared"

  project_name = var.project_name
}

# ============================================================================
# Environment-Specific Resources
# ============================================================================

module "environment" {
  source = "./modules/environment"

  providers = {
    aws.us_east_1 = aws.us_east_1
  }

  # Shared resources
  ecr_repository_url      = module.shared.ecr_repository_url
  s3_arangodb_bucket_name = module.shared.s3_arangodb_bucket_name

  # Environment-specific config
  project_name          = var.project_name
  environment           = var.environment
  vpc_cidr              = var.vpc_cidr
  private_subnet_cidr   = var.private_subnet_cidr
  arango_db_user        = var.arango_db_user
  arango_db_password    = var.arango_db_password
  django_secret_key     = var.django_secret_key
  arangodb_restore_file = var.arangodb_restore_file
  domain_name           = var.domain_name
  hosted_zone_id        = var.hosted_zone_id
}
