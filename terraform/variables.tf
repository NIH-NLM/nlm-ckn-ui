variable "aws_region" {
  description = "AWS region for resources"
  type        = string
  default     = "us-east-1"
}

variable "project_name" {
  description = "Project name for resource naming"
  type        = string
  default     = "cell-kn"
}

variable "environment" {
  description = "Environment name (dev, staging, prod)"
  type        = string
  default     = "dev"
}

variable "vpc_cidr" {
  description = "CIDR block for VPC"
  type        = string
  default     = "10.0.0.0/16"
}

variable "private_subnet_cidr" {
  description = "CIDR block for private subnet"
  type        = string
}

variable "arango_db_user" {
  description = "ArangoDB root username"
  type        = string
  default     = "root"
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

variable "arangodb_restore_file" {
  description = "S3 object key for ArangoDB restore tar.gz file (optional)"
  type        = string
  default     = ""
}

variable "domain_name" {
  description = "Base domain name (e.g., 'cell-kn.org')"
  type        = string
}

variable "hosted_zone_id" {
  description = "Route 53 hosted zone ID for the domain"
  type        = string
}
