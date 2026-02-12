# ============================================================================
# S3 Bucket for ArangoDB Data (Shared across all environments)
# ============================================================================

resource "aws_s3_bucket" "arangodb_data" {
  bucket = "${var.project_name}-arangodb-data"
  tags = merge(var.tags, {
    Name    = "${var.project_name}-arangodb-data"
    Shared  = "true"
    Purpose = "ArangoDB datasets for all environments"
    Project = "cell-kn"
  })
}

resource "aws_s3_bucket_versioning" "arangodb_data" {
  bucket = aws_s3_bucket.arangodb_data.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "arangodb_data" {
  bucket = aws_s3_bucket.arangodb_data.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "arangodb_data" {
  bucket                  = aws_s3_bucket.arangodb_data.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_lifecycle_configuration" "arangodb_data" {
  bucket = aws_s3_bucket.arangodb_data.id

  rule {
    id     = "archive-old-datasets"
    status = "Enabled"

    filter {
      prefix = "datasets/"
    }

    transition {
      days          = 90
      storage_class = "GLACIER"
    }

    transition {
      days          = 180
      storage_class = "DEEP_ARCHIVE"
    }
  }

  rule {
    id     = "expire-old-backups"
    status = "Enabled"

    filter {
      prefix = "backups/"
    }

    expiration {
      days = 30
    }
  }
}
