output "vpc_id" {
  description = "VPC ID"
  value       = aws_vpc.main.id
}

output "alb_dns_name" {
  description = "ALB DNS name"
  value       = aws_lb.main.dns_name
}

output "alb_zone_id" {
  description = "ALB hosted zone ID"
  value       = aws_lb.main.zone_id
}

output "backend_url" {
  description = "Backend service URL"
  value       = "http://${aws_lb.main.dns_name}:8000"
}

output "arangodb_url" {
  description = "ArangoDB management URL"
  value       = "http://${aws_lb.main.dns_name}:8529"
}

output "cloudfront_distribution_id" {
  description = "CloudFront distribution ID"
  value       = aws_cloudfront_distribution.frontend.id
}

output "cloudfront_domain_name" {
  description = "CloudFront distribution domain name"
  value       = aws_cloudfront_distribution.frontend.domain_name
}

output "s3_bucket_name" {
  description = "S3 bucket name for frontend"
  value       = aws_s3_bucket.frontend.id
}

output "ecr_repository_url" {
  description = "ECR repository URL for backend (shared)"
  value       = var.ecr_repository_url
}

output "ecs_cluster_name" {
  description = "ECS cluster name"
  value       = aws_ecs_cluster.main.name
}

output "efs_id" {
  description = "EFS file system ID"
  value       = aws_efs_file_system.arangodb.id
}

output "s3_arangodb_bucket_name" {
  description = "S3 bucket name for ArangoDB data (shared)"
  value       = var.s3_arangodb_bucket_name
}

output "arangodb_service_discovery_name" {
  description = "ArangoDB service discovery DNS name"
  value       = "arangodb.${aws_service_discovery_private_dns_namespace.main.name}"
}

output "arangodb_dataset_version_parameter" {
  description = "SSM parameter name for ArangoDB dataset version"
  value       = aws_ssm_parameter.arangodb_dataset_version.name
}

output "arangodb_service_name" {
  description = "ArangoDB ECS service name"
  value       = aws_ecs_service.arangodb.name
}

output "domain_name" {
  description = "Domain name for the environment"
  value       = local.full_domain_name
}

output "frontend_url" {
  description = "Frontend URL"
  value       = "https://${local.full_domain_name}"
}

output "django_allowed_hosts" {
  description = "Django ALLOWED_HOSTS value"
  value       = local.django_allowed_hosts
}

output "django_cors_allowed_origins" {
  description = "Django CORS_ALLOWED_ORIGINS value"
  value       = local.django_cors_allowed_origins
}

output "cloudfront_secret_header" {
  description = "Secret header value for CloudFront -> ALB communication"
  value       = random_password.cloudfront_secret.result
  sensitive   = true
}
