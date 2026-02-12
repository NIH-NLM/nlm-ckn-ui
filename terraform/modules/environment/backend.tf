# ============================================================================
# Backend ECS Service
# ============================================================================
# Note: ECR repository is shared across environments (see modules/shared/ecr.tf)

resource "aws_security_group" "backend_tasks" {
  name_prefix = "${local.name_prefix}-backend-"
  description = "Security group for backend ECS tasks"
  vpc_id      = aws_vpc.main.id

  ingress {
    from_port   = 8000
    to_port     = 8000
    protocol    = "tcp"
    cidr_blocks = [aws_vpc.main.cidr_block]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(local.tags, { Name = "${local.name_prefix}-backend-sg" })
  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_iam_role" "backend_task_execution" {
  name = "${local.name_prefix}-backend-exec"

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

  tags = merge(local.tags, { Name = "${local.name_prefix}-backend-exec-role" })
}

resource "aws_iam_role_policy_attachment" "backend_task_execution" {
  role       = aws_iam_role.backend_task_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy" "backend_ssm_access" {
  name = "${local.name_prefix}-backend-ssm"
  role = aws_iam_role.backend_task_execution.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["ssm:GetParameters", "ssm:GetParameter"]
      Resource = "arn:aws:ssm:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:parameter/${var.project_name}/${var.environment}/*"
    }]
  })
}

resource "aws_iam_role" "backend_task" {
  name = "${local.name_prefix}-backend-task"

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

  tags = merge(local.tags, { Name = "${local.name_prefix}-backend-task-role" })
}

resource "aws_cloudwatch_log_group" "backend" {
  name              = "/ecs/${local.name_prefix}-backend"
  retention_in_days = 7
  tags              = merge(local.tags, { Name = "${local.name_prefix}-backend-logs" })
}

resource "aws_ecs_task_definition" "backend" {
  family                   = "${local.name_prefix}-backend"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = 256
  memory                   = 512
  execution_role_arn       = aws_iam_role.backend_task_execution.arn
  task_role_arn            = aws_iam_role.backend_task.arn

  container_definitions = jsonencode([{
    name      = "backend"
    image     = "${var.ecr_repository_url}:latest"
    essential = true
    portMappings = [{
      containerPort = 8000
      protocol      = "tcp"
    }]
    environment = [
      { name = "SECRET_KEY", value = var.django_secret_key },
      { name = "DEBUG", value = "False" },
      { name = "ALLOWED_HOSTS", value = var.django_allowed_hosts },
      { name = "CORS_ALLOW_ALL_ORIGINS", value = "False" },
      { name = "CORS_ALLOWED_ORIGINS", value = var.django_cors_allowed_origins },
      { name = "SECURE_SSL_REDIRECT", value = "True" },
      { name = "SESSION_COOKIE_SECURE", value = "True" },
      { name = "CSRF_COOKIE_SECURE", value = "True" },
      { name = "ARANGO_DB_HOST", value = "http://arangodb.${local.name_prefix}.local:8529" },
      { name = "ARANGO_DB_NAME_ONTOLOGIES", value = "Cell-KN-Ontologies" },
      { name = "ARANGO_DB_NAME_PHENOTYPES", value = "Cell-KN-Phenotypes" },
      { name = "GRAPH_NAME_ONTOLOGIES", value = "KN-Ontologies-v2.0" },
      { name = "GRAPH_NAME_PHENOTYPES", value = "KN-Phenotypes-v2.0" }
    ]
    secrets = [
      { name = "ARANGO_DB_USER", valueFrom = aws_ssm_parameter.arango_db_user.arn },
      { name = "ARANGO_DB_PASSWORD", valueFrom = aws_ssm_parameter.arango_db_password.arn }
    ]
    command = ["python", "manage.py", "runserver", "0.0.0.0:8000"]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.backend.name
        "awslogs-region"        = data.aws_region.current.name
        "awslogs-stream-prefix" = "ecs"
      }
    }
  }])

  tags = merge(local.tags, { Name = "${local.name_prefix}-backend-task" })
}

resource "aws_ecs_service" "backend" {
  name            = "${local.name_prefix}-backend"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.backend.arn
  desired_count   = 2
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = [aws_subnet.private.id]
    security_groups  = [aws_security_group.backend_tasks.id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.backend.arn
    container_name   = "backend"
    container_port   = 8000
  }

  depends_on = [aws_ecs_service.arangodb]

  tags = merge(local.tags, { Name = "${local.name_prefix}-backend-service" })
}

# ============================================================================
# Backend Auto-Scaling
# ============================================================================
