# Data sources
data "aws_caller_identity" "current" {}
data "aws_region" "current" {}
data "aws_availability_zones" "available" {
  state = "available"
}

locals {
  # Naming
  name_prefix = "${var.project_name}-${var.environment}"

  # Domain configuration
  # For prod environment, use apex domain. For others, use subdomain.
  full_domain_name = var.environment == "prod" ? var.domain_name : "${var.environment}.${var.domain_name}"

  # Django configuration (auto-calculated from domain)
  django_allowed_hosts        = "localhost,${local.full_domain_name}"
  django_cors_allowed_origins = "https://${local.full_domain_name}"

  # Network calculations
  availability_zones = slice(data.aws_availability_zones.available.names, 0, 2)
  public_subnet_cidrs = [
    cidrsubnet(var.vpc_cidr, 8, 0),
    cidrsubnet(var.vpc_cidr, 8, 1)
  ]

  # Common tags
  tags = merge(
    {
      Project     = var.project_name
      Environment = var.environment
      ManagedBy   = "Terraform"
    },
    var.tags
  )
}
