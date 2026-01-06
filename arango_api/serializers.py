"""
DRF Serializers for request validation.

Serializers validate incoming request data before it reaches the service layer.
Each serializer defines the expected fields, types, and constraints for an endpoint.

Usage in views:
    serializer = GraphTraversalSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)  # Raises 400 if invalid
    data = serializer.validated_data  # Safe to use

See: https://www.django-rest-framework.org/api-guide/serializers/
"""
from rest_framework import serializers


class GraphRequestSerializer(serializers.Serializer):
    """Base serializer for requests that need a graph/database parameter."""

    graph = serializers.ChoiceField(
        choices=["ontologies", "phenotypes"],
        required=False,
        default="ontologies",
    )


class GraphTraversalSerializer(serializers.Serializer):
    """Serializer for graph traversal requests."""

    node_ids = serializers.ListField(
        child=serializers.CharField(),
        required=True,
        help_text="List of starting node IDs",
    )
    depth = serializers.IntegerField(
        required=True,
        min_value=1,
        max_value=10,
        help_text="Maximum traversal depth",
    )
    edge_direction = serializers.ChoiceField(
        choices=["INBOUND", "OUTBOUND", "ANY"],
        required=True,
    )
    allowed_collections = serializers.ListField(
        child=serializers.CharField(),
        required=True,
        help_text="List of vertex collection names to include",
    )
    graph = serializers.ChoiceField(
        choices=["ontologies", "phenotypes"],
        required=False,
        default="ontologies",
    )
    edge_filters = serializers.DictField(
        required=False,
        allow_null=True,
        default=None,
        help_text="Dictionary of edge filters",
    )
    include_inter_node_edges = serializers.BooleanField(
        required=False,
        default=True,
    )


class AdvancedGraphTraversalSerializer(serializers.Serializer):
    """Serializer for advanced graph traversal with per-node settings."""

    node_ids = serializers.ListField(
        child=serializers.CharField(),
        required=True,
    )
    advanced_settings = serializers.DictField(
        required=True,
        help_text="Dictionary mapping node IDs to their traversal settings",
    )
    graph = serializers.ChoiceField(
        choices=["ontologies", "phenotypes"],
        required=False,
        default="ontologies",
    )
    include_inter_node_edges = serializers.BooleanField(
        required=False,
        default=True,
    )


class ShortestPathsSerializer(serializers.Serializer):
    """Serializer for shortest paths requests."""

    node_ids = serializers.ListField(
        child=serializers.CharField(),
        required=True,
        min_length=2,
        help_text="List of at least 2 node IDs",
    )
    edge_direction = serializers.ChoiceField(
        choices=["INBOUND", "OUTBOUND", "ANY"],
        required=False,
        default="ANY",
    )


class SearchRequestSerializer(serializers.Serializer):
    """Serializer for search requests."""

    db = serializers.ChoiceField(
        choices=["ontologies", "phenotypes"],
        required=False,
        default="ontologies",
        help_text="Database/graph to search",
    )
    search_term = serializers.CharField(
        required=True,
        min_length=1,
        help_text="Term to search for",
    )
    search_fields = serializers.ListField(
        child=serializers.CharField(),
        required=True,
        min_length=1,
        help_text="List of fields to search within",
    )


class AQLQuerySerializer(serializers.Serializer):
    """Serializer for raw AQL query requests."""

    query = serializers.CharField(
        required=True,
        min_length=1,
        help_text="AQL query to execute",
    )


class SunburstRequestSerializer(serializers.Serializer):
    """Serializer for sunburst data requests."""

    parent_id = serializers.CharField(
        required=False,
        allow_null=True,
        default=None,
        help_text="Parent node ID for on-demand loading",
    )
    graph = serializers.ChoiceField(
        choices=["ontologies", "phenotypes"],
        required=False,
        default="ontologies",
    )


class EdgeFilterOptionsSerializer(serializers.Serializer):
    """Serializer for edge filter options requests."""

    fields = serializers.ListField(
        child=serializers.CharField(),
        required=True,
        min_length=1,
        help_text="List of edge attribute names to get options for",
    )


class DocumentsRequestSerializer(serializers.Serializer):
    """Serializer for document retrieval requests."""

    db = serializers.ChoiceField(
        choices=["ontologies", "phenotypes"],
        required=False,
        default="ontologies",
        help_text="Database/graph to fetch from",
    )
    document_ids = serializers.ListField(
        child=serializers.CharField(),
        required=True,
        min_length=1,
        help_text="List of document IDs to fetch",
    )
