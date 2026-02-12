output "ecr_repository_url" {
  description = "ECR repository URL for backend images"
  value       = aws_ecr_repository.backend.repository_url
}

output "ecr_repository_arn" {
  description = "ECR repository ARN"
  value       = aws_ecr_repository.backend.arn
}

output "s3_arangodb_bucket_name" {
  description = "S3 bucket name for ArangoDB datasets"
  value       = aws_s3_bucket.arangodb_data.id
}

output "s3_arangodb_bucket_arn" {
  description = "S3 bucket ARN for ArangoDB datasets"
  value       = aws_s3_bucket.arangodb_data.arn
}
