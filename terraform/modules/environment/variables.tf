variable "project_name" {
  description = "Project name for resource naming"
  type        = string
}

variable "environment" {
  description = "Environment name (dev, staging, prod)"
  type        = string
}

variable "vpc_cidr" {
  description = "CIDR block for VPC"
  type        = string
}

variable "private_subnet_cidr" {
  description = "CIDR block for private subnet"
  type        = string
}

variable "arango_db_user" {
  description = "ArangoDB root username"
  type        = string
  sensitive   = true
}

variable "arango_db_password" {
  description = "ArangoDB root password"
  type        = string
  sensitive   = true
}

variable "django_secret_key" {
  description = "Django secret key"
  type        = string
  sensitive   = true
}

variable "domain_name" {
  description = "Base domain name (e.g., 'cell-kn.org')"
  type        = string
}

variable "hosted_zone_id" {
  description = "Route 53 hosted zone ID for the domain"
  type        = string
}

variable "arangodb_restore_file" {
  description = "S3 object key for ArangoDB restore tar.gz file (e.g., 'backups/arangodb-20240210.tar.gz'). Leave empty for no restore."
  type        = string
  default     = ""
}

variable "tags" {
  description = "Additional tags for all resources"
  type        = map(string)
  default     = {}
}

# Shared resources (created once, used by all environments)
variable "ecr_repository_url" {
  description = "Shared ECR repository URL"
  type        = string
}

variable "s3_arangodb_bucket_name" {
  description = "Shared S3 bucket name for ArangoDB datasets"
  type        = string
}
