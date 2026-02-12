output "vpc_id" {
  description = "VPC ID"
  value       = module.environment.vpc_id
}

output "alb_dns_name" {
  description = "ALB DNS name"
  value       = module.environment.alb_dns_name
}

output "alb_zone_id" {
  description = "ALB hosted zone ID"
  value       = module.environment.alb_zone_id
}

output "backend_url" {
  description = "Backend service URL"
  value       = module.environment.backend_url
}

output "arangodb_url" {
  description = "ArangoDB management URL"
  value       = module.environment.arangodb_url
}

output "cloudfront_distribution_id" {
  description = "CloudFront distribution ID"
  value       = module.environment.cloudfront_distribution_id
}

output "cloudfront_domain_name" {
  description = "CloudFront distribution domain name"
  value       = module.environment.cloudfront_domain_name
}

output "s3_bucket_name" {
  description = "S3 bucket name for frontend"
  value       = module.environment.s3_bucket_name
}

output "ecr_repository_url" {
  description = "ECR repository URL for backend"
  value       = module.environment.ecr_repository_url
}

output "ecs_cluster_name" {
  description = "ECS cluster name"
  value       = module.environment.ecs_cluster_name
}

output "efs_id" {
  description = "EFS file system ID"
  value       = module.environment.efs_id
}

output "s3_arangodb_bucket_name" {
  description = "S3 bucket name for ArangoDB data"
  value       = module.environment.s3_arangodb_bucket_name
}

output "arangodb_service_discovery_name" {
  description = "ArangoDB service discovery DNS name (internal)"
  value       = module.environment.arangodb_service_discovery_name
}
