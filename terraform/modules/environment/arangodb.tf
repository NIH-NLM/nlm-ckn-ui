# ============================================================================
# S3 Bucket for ArangoDB Data
# ============================================================================
# Note: S3 bucket is shared across environments (see modules/shared/arangodb-s3.tf)

# Data source for shared S3 bucket
data "aws_s3_bucket" "arangodb_data" {
  bucket = var.s3_arangodb_bucket_name
}
# ============================================================================
# EFS for ArangoDB
# ============================================================================

resource "aws_efs_file_system" "arangodb" {
  encrypted = true
  lifecycle_policy {
    transition_to_ia = "AFTER_30_DAYS"
  }
  tags = merge(local.tags, { Name = "${local.name_prefix}-efs" })
}

resource "aws_security_group" "efs" {
  name_prefix = "${local.name_prefix}-efs-"
  description = "Security group for EFS mount targets"
  vpc_id      = aws_vpc.main.id

  ingress {
    description = "NFS from VPC"
    from_port   = 2049
    to_port     = 2049
    protocol    = "tcp"
    cidr_blocks = [aws_vpc.main.cidr_block]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(local.tags, { Name = "${local.name_prefix}-efs-sg" })
  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_efs_mount_target" "arangodb" {
  file_system_id  = aws_efs_file_system.arangodb.id
  subnet_id       = aws_subnet.private.id
  security_groups = [aws_security_group.efs.id]
}

resource "aws_efs_access_point" "arangodb" {
  file_system_id = aws_efs_file_system.arangodb.id

  posix_user {
    gid = 1000
    uid = 1000
  }

  root_directory {
    path = "/arangodb"
    creation_info {
      owner_gid   = 1000
      owner_uid   = 1000
      permissions = "755"
    }
  }

  tags = merge(local.tags, { Name = "${local.name_prefix}-efs-ap-arangodb" })
}

# ============================================================================
# SSM Parameter Store (ArangoDB Secrets)
# ============================================================================

resource "aws_ssm_parameter" "arango_db_user" {
  name  = "/${var.project_name}/${var.environment}/arango/db-user"
  type  = "SecureString"
  value = var.arango_db_user
  tags  = merge(local.tags, { Name = "${local.name_prefix}-arango-db-user" })
}

resource "aws_ssm_parameter" "arango_db_password" {
  name  = "/${var.project_name}/${var.environment}/arango/db-password"
  type  = "SecureString"
  value = var.arango_db_password
  tags  = merge(local.tags, { Name = "${local.name_prefix}-arango-db-password" })
}

resource "aws_ssm_parameter" "arangodb_dataset_version" {
  name  = "/${var.project_name}/${var.environment}/arango/dataset-version"
  type  = "String"
  value = var.arangodb_restore_file != "" ? var.arangodb_restore_file : "none"
  tags  = merge(local.tags, { Name = "${local.name_prefix}-arango-dataset-version" })

  lifecycle {
    ignore_changes = [value]
  }
}
# ============================================================================
# ArangoDB ECS Service
# ============================================================================

resource "aws_security_group" "arangodb_tasks" {
  name_prefix = "${local.name_prefix}-arangodb-"
  description = "Security group for ArangoDB ECS tasks"
  vpc_id      = aws_vpc.main.id

  ingress {
    from_port   = 8529
    to_port     = 8529
    protocol    = "tcp"
    cidr_blocks = [aws_vpc.main.cidr_block]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(local.tags, { Name = "${local.name_prefix}-arangodb-sg" })
  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_iam_role" "arangodb_task_execution" {
  name = "${local.name_prefix}-arangodb-exec"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = {
        Service = "ecs-tasks.amazonaws.com"
      }
      Action = "sts:AssumeRole"
    }]
  })

  tags = merge(local.tags, { Name = "${local.name_prefix}-arangodb-exec-role" })
}

resource "aws_iam_role_policy_attachment" "arangodb_task_execution" {
  role       = aws_iam_role.arangodb_task_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy" "arangodb_ssm_access" {
  name = "${local.name_prefix}-arangodb-ssm"
  role = aws_iam_role.arangodb_task_execution.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["ssm:GetParameters", "ssm:GetParameter"]
      Resource = "arn:aws:ssm:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:parameter/${var.project_name}/${var.environment}/*"
    }]
  })
}

resource "aws_iam_role" "arangodb_task" {
  name = "${local.name_prefix}-arangodb-task"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = {
        Service = "ecs-tasks.amazonaws.com"
      }
      Action = "sts:AssumeRole"
    }]
  })

  tags = merge(local.tags, { Name = "${local.name_prefix}-arangodb-task-role" })
}

# IAM policy for ArangoDB task to access S3 bucket
resource "aws_iam_role_policy" "arangodb_s3_access" {
  name = "${local.name_prefix}-arangodb-s3"
  role = aws_iam_role.arangodb_task.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "s3:GetObject",
        "s3:ListBucket",
        "s3:PutObject"
      ]
      Resource = [
        data.aws_s3_bucket.arangodb_data.arn,
        "${data.aws_s3_bucket.arangodb_data.arn}/*"
      ]
    }]
  })
}

# IAM policy for ArangoDB task to read SSM parameters
resource "aws_iam_role_policy" "arangodb_task_ssm_access" {
  name = "${local.name_prefix}-arangodb-task-ssm"
  role = aws_iam_role.arangodb_task.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["ssm:GetParameter", "ssm:GetParameters"]
      Resource = "arn:aws:ssm:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:parameter/${var.project_name}/${var.environment}/*"
    }]
  })
}

resource "aws_cloudwatch_log_group" "arangodb" {
  name              = "/ecs/${local.name_prefix}-arangodb"
  retention_in_days = 7
  tags              = merge(local.tags, { Name = "${local.name_prefix}-arangodb-logs" })
}

resource "aws_ecs_task_definition" "arangodb" {
  family                   = "${local.name_prefix}-arangodb"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = 1024
  memory                   = 2048
  execution_role_arn       = aws_iam_role.arangodb_task_execution.arn
  task_role_arn            = aws_iam_role.arangodb_task.arn

  container_definitions = jsonencode([
    # Init/sidecar container for S3 restore
    {
      name      = "s3-restore"
      image     = "amazon/aws-cli:latest"
      essential = false
      command = [
        "sh",
        "-c",
        <<-EOT
          set -e
          echo "==> S3 Restore Init Container"

          # Get current dataset version from SSM
          echo "Reading dataset version from SSM..."
          CURRENT_VERSION=$(aws ssm get-parameter \
            --name "/${PROJECT_NAME}/${ENVIRONMENT}/arango/dataset-version" \
            --query 'Parameter.Value' \
            --output text 2>/dev/null || echo "none")

          echo "Current dataset version: $CURRENT_VERSION"

          # Skip if no dataset configured
          if [ "$CURRENT_VERSION" = "none" ] || [ -z "$CURRENT_VERSION" ]; then
            echo "No dataset version configured, skipping restore"
            exit 0
          fi

          # Check last restored version
          LAST_RESTORED="none"
          if [ -f "/var/lib/arangodb3/.dataset-version" ]; then
            LAST_RESTORED=$(cat /var/lib/arangodb3/.dataset-version)
            echo "Last restored version: $LAST_RESTORED"
          else
            echo "No previous restore found"
          fi

          # Skip if already on current version
          if [ "$CURRENT_VERSION" = "$LAST_RESTORED" ]; then
            echo "Already on version $CURRENT_VERSION, skipping restore"
            exit 0
          fi

          # Restore needed - clear existing data
          echo "Version change detected: $LAST_RESTORED -> $CURRENT_VERSION"
          echo "Clearing existing data..."
          rm -rf /var/lib/arangodb3/*
          rm -rf /var/lib/arangodb3-apps/*

          # Download and extract from S3
          echo "Downloading s3://$ARANGODB_S3_BUCKET/$CURRENT_VERSION"
          aws s3 cp "s3://$ARANGODB_S3_BUCKET/$CURRENT_VERSION" /tmp/restore.tar.gz

          echo "Extracting backup..."
          tar -xzf /tmp/restore.tar.gz -C /
          rm /tmp/restore.tar.gz

          # Save version marker
          echo "$CURRENT_VERSION" > /var/lib/arangodb3/.dataset-version
          echo "Restore completed successfully to version $CURRENT_VERSION"
        EOT
      ]
      environment = [
        {
          name  = "ARANGODB_S3_BUCKET"
          value = var.s3_arangodb_bucket_name
        },
        {
          name  = "PROJECT_NAME"
          value = var.project_name
        },
        {
          name  = "ENVIRONMENT"
          value = var.environment
        }
      ]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.arangodb.name
          "awslogs-region"        = data.aws_region.current.name
          "awslogs-stream-prefix" = "restore"
        }
      }
      mountPoints = [
        {
          sourceVolume  = "efs-data"
          containerPath = "/var/lib/arangodb3"
          readOnly      = false
        },
        {
          sourceVolume  = "efs-apps"
          containerPath = "/var/lib/arangodb3-apps"
          readOnly      = false
        }
      ]
    },
    # Main ArangoDB container
    {
      name      = "arangodb"
      image     = "arangodb:3.12"
      essential = true
      dependsOn = [
        {
          containerName = "s3-restore"
          condition     = "SUCCESS"
        }
      ]
      portMappings = [{
        containerPort = 8529
        protocol      = "tcp"
      }]
      secrets = [{
        name      = "ARANGO_ROOT_PASSWORD"
        valueFrom = aws_ssm_parameter.arango_db_password.arn
      }]
      command = ["arangod"]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.arangodb.name
          "awslogs-region"        = data.aws_region.current.name
          "awslogs-stream-prefix" = "arangodb"
        }
      }
      mountPoints = [
        {
          sourceVolume  = "efs-data"
          containerPath = "/var/lib/arangodb3"
          readOnly      = false
        },
        {
          sourceVolume  = "efs-apps"
          containerPath = "/var/lib/arangodb3-apps"
          readOnly      = false
        }
      ]
    }
  ])

  volume {
    name = "efs-data"
    efs_volume_configuration {
      file_system_id = aws_efs_file_system.arangodb.id
      root_directory = "/arangodb/data"
    }
  }

  volume {
    name = "efs-apps"
    efs_volume_configuration {
      file_system_id = aws_efs_file_system.arangodb.id
      root_directory = "/arangodb/apps"
    }
  }

  tags = merge(local.tags, { Name = "${local.name_prefix}-arangodb-task" })
}

resource "aws_ecs_service" "arangodb" {
  name            = "${local.name_prefix}-arangodb"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.arangodb.arn
  desired_count   = 1
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = [aws_subnet.private.id]
    security_groups  = [aws_security_group.arangodb_tasks.id, aws_security_group.efs.id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.arangodb.arn
    container_name   = "arangodb"
    container_port   = 8529
  }

  service_registries {
    registry_arn = aws_service_discovery_service.arangodb.arn
  }

  tags = merge(local.tags, { Name = "${local.name_prefix}-arangodb-service" })
}

# ============================================================================
