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

import re

from rest_framework import serializers

# AQL identifier pattern: search_fields are interpolated directly into AQL
# attribute accessors (doc.`<field>`), so each must be a plain identifier.
# Rejecting anything else (backticks, dots, whitespace) prevents AQL injection.
# Leading underscores are allowed because the frontend searches system/edge
# attributes such as _from, _to and _key.
# \Z (not $) so a trailing newline (e.g. "Label\n") is not accepted.
_VALID_FIELD_NAME = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*\Z")

GRAPH_CHOICES = ["ontologies", "phenotypes"]


def _validate_edge_filter_field_names(value):
    """Reject edge filter dicts whose keys are not plain AQL identifiers.

    Edge filter keys are interpolated into AQL attribute accessors
    (e.`<field>`) by graph_service, so any key containing backticks or other
    non-identifier characters could be used for AQL injection.

    A non-dict value (e.g. a list nested inside advanced_settings, which is a
    free-form DictField and does not type-check its members) is rejected here
    so it fails with a 400 rather than reaching the query builder and raising
    a 500 on `.items()`.
    """
    if value is None:
        return value
    if not isinstance(value, dict):
        raise serializers.ValidationError(
            "Edge filter must be an object mapping field names to values."
        )
    invalid = [k for k in value if not _VALID_FIELD_NAME.match(k)]
    if invalid:
        raise serializers.ValidationError(
            f"Invalid edge filter field name(s): {invalid}"
        )
    return value


class GraphRequestSerializer(serializers.Serializer):
    """Base serializer for requests that need a graph/database parameter."""

    graph = serializers.ChoiceField(
        choices=GRAPH_CHOICES,
        required=False,
        default="ontologies",
    )


class GraphTraversalSerializer(GraphRequestSerializer):
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
    edge_filters = serializers.DictField(
        required=False,
        allow_null=True,
        default=None,
        help_text="Dictionary of edge filters",
    )
    exclude_edge_filters = serializers.DictField(
        required=False,
        allow_null=True,
        default=None,
        help_text="Dictionary of edge filters whose matching edges are hidden",
    )
    include_inter_node_edges = serializers.BooleanField(
        required=False,
        default=True,
    )

    def validate_edge_filters(self, value):
        return _validate_edge_filter_field_names(value)

    def validate_exclude_edge_filters(self, value):
        return _validate_edge_filter_field_names(value)


class AdvancedGraphTraversalSerializer(GraphRequestSerializer):
    """Serializer for advanced graph traversal with per-node settings."""

    node_ids = serializers.ListField(
        child=serializers.CharField(),
        required=True,
    )
    advanced_settings = serializers.DictField(
        required=True,
        help_text="Dictionary mapping node IDs to their traversal settings",
    )
    include_inter_node_edges = serializers.BooleanField(
        required=False,
        default=True,
    )

    def validate_advanced_settings(self, value):
        for node_id, node_settings in (value or {}).items():
            # Per-node settings must be objects; a non-dict here would reach
            # traverse_graph_advanced's settings.get(...) and raise a 500, so
            # reject it at the boundary with a 400.
            if not isinstance(node_settings, dict):
                raise serializers.ValidationError(
                    f"Settings for node '{node_id}' must be an object."
                )
            for key in ("edgeFilters", "excludeEdgeFilters"):
                _validate_edge_filter_field_names(node_settings.get(key))
        return value


class NeighborCollectionsSerializer(GraphRequestSerializer):
    """Serializer for neighbor-collections discovery requests."""

    node_id = serializers.CharField(
        required=True,
        help_text="Starting node _id",
    )
    edge_direction = serializers.ChoiceField(
        choices=["INBOUND", "OUTBOUND", "ANY"],
        required=False,
        default="ANY",
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


class EdgesBetweenSerializer(GraphRequestSerializer):
    """Serializer for finding edges between a set of nodes."""

    node_ids = serializers.ListField(
        child=serializers.CharField(),
        required=True,
        min_length=2,
        help_text="List of at least 2 node IDs to find edges between",
    )
    edge_filters = serializers.DictField(
        required=False,
        allow_null=True,
        default=None,
        help_text="Dictionary of edge filters",
    )
    exclude_edge_filters = serializers.DictField(
        required=False,
        allow_null=True,
        default=None,
        help_text="Dictionary of edge filters whose matching edges are hidden",
    )

    def validate_edge_filters(self, value):
        return _validate_edge_filter_field_names(value)

    def validate_exclude_edge_filters(self, value):
        return _validate_edge_filter_field_names(value)


class SearchRequestSerializer(serializers.Serializer):
    """Serializer for search requests."""

    db = serializers.ChoiceField(
        choices=GRAPH_CHOICES,
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

    def validate_search_fields(self, value):
        """Reject field names that are not plain AQL identifiers.

        search_fields are interpolated into AQL attribute accessors
        (doc.`<field>`) by search_service.search_by_term, so any value
        containing backticks or other non-identifier characters could be used
        for AQL injection. Allow only letters, digits and underscores.
        """
        invalid = [field for field in value if not _VALID_FIELD_NAME.match(field)]
        if invalid:
            raise serializers.ValidationError(
                f"Invalid field name(s): {invalid}. Field names must contain only "
                "letters, digits and underscores."
            )
        return value


class AQLQuerySerializer(serializers.Serializer):
    """
    Serializer for raw AQL query requests.

    Validates that queries are read-only by blocking write operations.

    TODO: For defense-in-depth, this endpoint should also use a read-only
    database user at the infrastructure level. See: arango_api/db.py
    """

    BLOCKED_OPERATIONS = [
        "INSERT",
        "UPDATE",
        "REPLACE",
        "REMOVE",
        "UPSERT",
        "CREATE",
        "DROP",
        "TRUNCATE",
    ]

    BLOCKED_PATTERNS = [
        "_system",
        "_users",
        "_graphs",
        "_queues",
        "_jobs",
        "_statistics",
    ]

    query = serializers.CharField(
        required=True,
        min_length=1,
        help_text="AQL query to execute (read-only)",
    )

    def validate_query(self, value):
        """Validate that the query doesn't contain write operations."""
        upper_query = value.upper()

        for op in self.BLOCKED_OPERATIONS:
            if op in upper_query:
                raise serializers.ValidationError(
                    f"Write operation '{op}' is not allowed. This endpoint only supports read-only queries."
                )

        lower_query = value.lower()
        for pattern in self.BLOCKED_PATTERNS:
            if pattern in lower_query:
                raise serializers.ValidationError(
                    f"Access to system collection '{pattern}' is not allowed."
                )

        return value


class SunburstRequestSerializer(GraphRequestSerializer):
    """Serializer for sunburst data requests."""

    parent_id = serializers.CharField(
        required=False,
        allow_null=True,
        default=None,
        help_text="Parent node ID for on-demand loading",
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
        choices=GRAPH_CHOICES,
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


class PhaseSerializer(serializers.Serializer):
    """Serializer for a single workflow phase."""

    id = serializers.CharField(required=True)
    originSource = serializers.ChoiceField(
        choices=["manual", "collection", "previousPhase", "multiplePhases"],
        required=False,
        default="manual",
    )
    originNodeIds = serializers.ListField(
        child=serializers.CharField(),
        required=False,
        default=list,
    )
    originCollection = serializers.CharField(
        required=False, allow_null=True, default=None
    )
    previousPhaseId = serializers.CharField(
        required=False, allow_null=True, default=None
    )
    previousPhaseIds = serializers.ListField(
        child=serializers.CharField(),
        required=False,
        default=list,
    )
    phaseCombineOperation = serializers.ChoiceField(
        choices=[
            "Union",
            "Intersection",
            "Intersection with Origins",
            "Connected Paths",
            "Symmetric Difference",
        ],
        required=False,
        default="Intersection",
    )
    originFilter = serializers.ChoiceField(
        choices=["all", "leafNodes", "nonOriginNodes", "originNodes"],
        required=False,
        default="all",
    )
    settings = serializers.DictField(required=False, default=dict)
    perNodeSettings = serializers.DictField(required=False, default=dict)

    def validate_settings(self, value):
        """Validate known keys within the settings dict (all optional)."""
        if "depth" in value:
            if not isinstance(value["depth"], int):
                raise serializers.ValidationError("'depth' must be an integer.")

        if "edgeDirection" in value:
            allowed_directions = ("ANY", "INBOUND", "OUTBOUND")
            if value["edgeDirection"] not in allowed_directions:
                raise serializers.ValidationError(
                    f"'edgeDirection' must be one of {allowed_directions}."
                )

        if "allowedCollections" in value:
            ac = value["allowedCollections"]
            if not isinstance(ac, list) or not all(isinstance(s, str) for s in ac):
                raise serializers.ValidationError(
                    "'allowedCollections' must be a list of strings."
                )

        if "setOperation" in value:
            allowed_ops = (
                "Union",
                "Intersection",
                "Intersection with Origins",
                "Connected Paths",
                "Symmetric Difference",
            )
            if value["setOperation"] not in allowed_ops:
                raise serializers.ValidationError(
                    f"'setOperation' must be one of {allowed_ops}."
                )

        if "graphType" in value:
            if not isinstance(value["graphType"], str):
                raise serializers.ValidationError("'graphType' must be a string.")

        if "includeInterNodeEdges" in value:
            if not isinstance(value["includeInterNodeEdges"], bool):
                raise serializers.ValidationError(
                    "'includeInterNodeEdges' must be a boolean."
                )

        if "returnCollections" in value:
            rc = value["returnCollections"]
            if not isinstance(rc, list) or not all(isinstance(s, str) for s in rc):
                raise serializers.ValidationError(
                    "'returnCollections' must be a list of strings."
                )

        return value


class WorkflowExecuteSerializer(GraphRequestSerializer):
    """Serializer for workflow execution requests."""

    preset_id = serializers.CharField(required=False, allow_null=True, default=None)
    phases = PhaseSerializer(many=True, required=False, default=None)
    origin_overrides = serializers.DictField(
        required=False,
        allow_null=True,
        default=None,
        help_text="Dict of {phase_id: [node_ids]} to override origins in a preset",
    )

    def validate(self, data):
        if not data.get("preset_id") and not data.get("phases"):
            raise serializers.ValidationError(
                "Either 'preset_id' or 'phases' must be provided."
            )
        return data
