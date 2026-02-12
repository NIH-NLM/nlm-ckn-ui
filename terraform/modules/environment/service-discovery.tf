# ============================================================================
# Service Discovery (AWS Cloud Map)
# ============================================================================

resource "aws_service_discovery_private_dns_namespace" "main" {
  name        = "${local.name_prefix}.local"
  vpc         = aws_vpc.main.id
  description = "Private DNS namespace for ${local.name_prefix}"

  tags = merge(local.tags, { Name = "${local.name_prefix}-dns-namespace" })
}

resource "aws_service_discovery_service" "arangodb" {
  name = "arangodb"

  dns_config {
    namespace_id = aws_service_discovery_private_dns_namespace.main.id

    dns_records {
      ttl  = 10
      type = "A"
    }

    routing_policy = "MULTIVALUE"
  }

  health_check_custom_config {
    failure_threshold = 1
  }

  tags = merge(local.tags, { Name = "${local.name_prefix}-arangodb-discovery" })
}
