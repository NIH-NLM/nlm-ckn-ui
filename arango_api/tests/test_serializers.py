"""
Unit tests for serializers.

These tests validate serializer logic WITHOUT requiring a database connection.
They test input validation and error handling.

Run these tests quickly with:
    python manage.py test arango_api.tests.test_serializers
"""

from django.test import SimpleTestCase

from arango_api.serializers import (
    AQLQuerySerializer,
    AdvancedGraphTraversalSerializer,
    DocumentsRequestSerializer,
    EdgeFilterOptionsSerializer,
    GraphRequestSerializer,
    GraphTraversalSerializer,
    SearchRequestSerializer,
    ShortestPathsSerializer,
    SunburstRequestSerializer,
)


class AQLQuerySerializerTestCase(SimpleTestCase):
    """Tests for AQL query validation - ensures dangerous operations are blocked."""

    def test_valid_read_query_accepted(self):
        serializer = AQLQuerySerializer(data={"query": "FOR doc IN CL RETURN doc"})
        self.assertTrue(serializer.is_valid())

    def test_empty_query_rejected(self):
        serializer = AQLQuerySerializer(data={"query": ""})
        self.assertFalse(serializer.is_valid())

    def test_write_operations_blocked(self):
        """All write operations should be blocked."""
        blocked_queries = [
            "INSERT {name: 'test'} INTO users",
            "UPDATE 'key' WITH {name: 'new'} IN users",
            "REMOVE 'key' IN users",
            "REPLACE 'key' WITH {name: 'new'} IN users",
            "DROP COLLECTION users",
            "TRUNCATE COLLECTION users",
        ]
        for query in blocked_queries:
            serializer = AQLQuerySerializer(data={"query": query})
            self.assertFalse(serializer.is_valid(), f"Should block: {query}")

    def test_system_collections_blocked(self):
        """Access to system collections should be blocked."""
        serializer = AQLQuerySerializer(data={"query": "FOR u IN _users RETURN u"})
        self.assertFalse(serializer.is_valid())


class GraphRequestSerializerTestCase(SimpleTestCase):
    """Tests for graph parameter validation."""

    def test_valid_graphs_accepted(self):
        for graph in ["ontologies", "phenotypes"]:
            serializer = GraphRequestSerializer(data={"graph": graph})
            self.assertTrue(serializer.is_valid())

    def test_invalid_graph_rejected(self):
        serializer = GraphRequestSerializer(data={"graph": "invalid"})
        self.assertFalse(serializer.is_valid())


class GraphTraversalSerializerTestCase(SimpleTestCase):
    """Tests for graph traversal request validation."""

    def test_valid_request_accepted(self):
        serializer = GraphTraversalSerializer(
            data={
                "node_ids": ["CL/0000061"],
                "depth": 2,
                "edge_direction": "OUTBOUND",
                "allowed_collections": ["CL"],
            }
        )
        self.assertTrue(serializer.is_valid())

    def test_required_fields_enforced(self):
        """Missing required fields should be rejected."""
        serializer = GraphTraversalSerializer(data={})
        self.assertFalse(serializer.is_valid())
        self.assertIn("node_ids", serializer.errors)
        self.assertIn("depth", serializer.errors)

    def test_depth_bounds_enforced(self):
        """Depth must be within valid range."""
        base = {
            "node_ids": ["CL/0000061"],
            "edge_direction": "OUTBOUND",
            "allowed_collections": ["CL"],
        }

        serializer = GraphTraversalSerializer(data={**base, "depth": 0})
        self.assertFalse(serializer.is_valid())

        serializer = GraphTraversalSerializer(data={**base, "depth": 11})
        self.assertFalse(serializer.is_valid())

    def test_invalid_edge_direction_rejected(self):
        serializer = GraphTraversalSerializer(
            data={
                "node_ids": ["CL/0000061"],
                "depth": 1,
                "edge_direction": "INVALID",
                "allowed_collections": ["CL"],
            }
        )
        self.assertFalse(serializer.is_valid())


class AdvancedGraphTraversalSerializerTestCase(SimpleTestCase):
    """Tests for advanced graph traversal request validation."""

    def test_valid_request_accepted(self):
        serializer = AdvancedGraphTraversalSerializer(
            data={
                "node_ids": ["CL/0000061"],
                "advanced_settings": {
                    "CL/0000061": {
                        "depth": 1,
                        "edgeDirection": "OUTBOUND",
                        "allowedCollections": ["CL"],
                    }
                },
            }
        )
        self.assertTrue(serializer.is_valid())

    def test_required_fields_enforced(self):
        serializer = AdvancedGraphTraversalSerializer(data={"node_ids": ["CL/0000061"]})
        self.assertFalse(serializer.is_valid())
        self.assertIn("advanced_settings", serializer.errors)


class ShortestPathsSerializerTestCase(SimpleTestCase):
    """Tests for shortest paths request validation."""

    def test_valid_request_accepted(self):
        serializer = ShortestPathsSerializer(
            data={"node_ids": ["CL/0000061", "CL/0000062"]}
        )
        self.assertTrue(serializer.is_valid())

    def test_single_node_rejected(self):
        """Shortest paths requires at least 2 nodes."""
        serializer = ShortestPathsSerializer(data={"node_ids": ["CL/0000061"]})
        self.assertFalse(serializer.is_valid())


class SearchRequestSerializerTestCase(SimpleTestCase):
    """Tests for search request validation."""

    def test_valid_request_accepted(self):
        serializer = SearchRequestSerializer(
            data={
                "search_term": "cell",
                "search_fields": ["label"],
            }
        )
        self.assertTrue(serializer.is_valid())

    def test_required_fields_enforced(self):
        serializer = SearchRequestSerializer(data={})
        self.assertFalse(serializer.is_valid())
        self.assertIn("search_term", serializer.errors)
        self.assertIn("search_fields", serializer.errors)


class SunburstRequestSerializerTestCase(SimpleTestCase):
    """Tests for sunburst request validation."""

    def test_empty_request_accepted(self):
        """Sunburst can be called with no parameters for root."""
        serializer = SunburstRequestSerializer(data={})
        self.assertTrue(serializer.is_valid())

    def test_invalid_graph_rejected(self):
        serializer = SunburstRequestSerializer(data={"graph": "invalid"})
        self.assertFalse(serializer.is_valid())


class EdgeFilterOptionsSerializerTestCase(SimpleTestCase):
    """Tests for edge filter options request validation."""

    def test_valid_request_accepted(self):
        serializer = EdgeFilterOptionsSerializer(data={"fields": ["label"]})
        self.assertTrue(serializer.is_valid())

    def test_empty_fields_rejected(self):
        serializer = EdgeFilterOptionsSerializer(data={"fields": []})
        self.assertFalse(serializer.is_valid())


class DocumentsRequestSerializerTestCase(SimpleTestCase):
    """Tests for documents request validation."""

    def test_valid_request_accepted(self):
        serializer = DocumentsRequestSerializer(data={"document_ids": ["CL/0000061"]})
        self.assertTrue(serializer.is_valid())

    def test_empty_document_ids_rejected(self):
        serializer = DocumentsRequestSerializer(data={"document_ids": []})
        self.assertFalse(serializer.is_valid())
