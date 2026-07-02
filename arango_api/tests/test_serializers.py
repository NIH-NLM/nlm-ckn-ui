"""
Unit tests for serializers.

These tests validate serializer logic WITHOUT requiring a database connection.
They test input validation and error handling.

Run these tests quickly with:
    python manage.py test arango_api.tests.test_serializers
"""

import json

from django.conf import settings
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

    def test_graph_traversal_accepts_exclude_edge_filters(self):
        from arango_api.serializers import GraphTraversalSerializer

        s = GraphTraversalSerializer(
            data={
                "node_ids": ["CL/0000061"],
                "depth": 1,
                "edge_direction": "ANY",
                "allowed_collections": ["CL"],
                "exclude_edge_filters": {"Label": ["DERIVES_FROM"]},
            }
        )
        self.assertTrue(s.is_valid(), s.errors)
        self.assertEqual(
            s.validated_data["exclude_edge_filters"], {"Label": ["DERIVES_FROM"]}
        )

    def test_graph_traversal_rejects_unsafe_edge_filter_key(self):
        from arango_api.serializers import GraphTraversalSerializer

        s = GraphTraversalSerializer(
            data={
                "node_ids": ["CL/0000061"],
                "depth": 1,
                "edge_direction": "ANY",
                "allowed_collections": ["CL"],
                "exclude_edge_filters": {"bad`key": ["x"]},
            }
        )
        self.assertFalse(s.is_valid())
        self.assertIn("exclude_edge_filters", s.errors)

    def test_graph_traversal_rejects_field_name_with_trailing_newline(self):
        # `$` matches before a trailing newline in Python; the validator must
        # use `\Z` so "Label\n" is rejected.
        from arango_api.serializers import GraphTraversalSerializer

        s = GraphTraversalSerializer(
            data={
                "node_ids": ["CL/0000061"],
                "depth": 1,
                "edge_direction": "ANY",
                "allowed_collections": ["CL"],
                "edge_filters": {"Label\n": ["IS_A"]},
            }
        )
        self.assertFalse(s.is_valid())
        self.assertIn("edge_filters", s.errors)


class EdgesBetweenSerializerTestCase(SimpleTestCase):
    """Tests for edges-between request validation."""

    def test_edges_between_accepts_exclude_edge_filters(self):
        from arango_api.serializers import EdgesBetweenSerializer

        s = EdgesBetweenSerializer(
            data={
                "node_ids": ["CL/0000061", "CL/0000151"],
                "exclude_edge_filters": {"Label": ["DERIVES_FROM"]},
            }
        )
        self.assertTrue(s.is_valid(), s.errors)
        self.assertEqual(
            s.validated_data["exclude_edge_filters"], {"Label": ["DERIVES_FROM"]}
        )

    def test_edges_between_rejects_unsafe_edge_filter_key(self):
        from arango_api.serializers import EdgesBetweenSerializer

        s = EdgesBetweenSerializer(
            data={
                "node_ids": ["CL/0000061", "CL/0000151"],
                "edge_filters": {"bad`key": ["x"]},
            }
        )
        self.assertFalse(s.is_valid())
        self.assertIn("edge_filters", s.errors)


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

    def test_advanced_settings_rejects_unsafe_edge_filter_key(self):
        from arango_api.serializers import AdvancedGraphTraversalSerializer

        s = AdvancedGraphTraversalSerializer(
            data={
                "node_ids": ["CL/0000061"],
                "advanced_settings": {
                    "CL/0000061": {"excludeEdgeFilters": {"bad`key": ["x"]}}
                },
            }
        )
        self.assertFalse(s.is_valid())
        self.assertIn("advanced_settings", s.errors)

    def test_advanced_settings_accepts_valid_edge_filter_keys(self):
        from arango_api.serializers import AdvancedGraphTraversalSerializer

        s = AdvancedGraphTraversalSerializer(
            data={
                "node_ids": ["CL/0000061"],
                "advanced_settings": {
                    "CL/0000061": {
                        "edgeFilters": {"Label": ["IS_A"]},
                        "excludeEdgeFilters": {"Label": ["DERIVES_FROM"]},
                    }
                },
            }
        )
        self.assertTrue(s.is_valid(), s.errors)

    def test_advanced_settings_rejects_non_dict_edge_filters(self):
        # A nested edge filter that is not an object (e.g. a list) must be
        # rejected with a 400 rather than reaching the query builder and
        # raising a 500 on `.items()`.
        from arango_api.serializers import AdvancedGraphTraversalSerializer

        s = AdvancedGraphTraversalSerializer(
            data={
                "node_ids": ["CL/0000061"],
                "advanced_settings": {
                    "CL/0000061": {"excludeEdgeFilters": ["Label"]}
                },
            }
        )
        self.assertFalse(s.is_valid())
        self.assertIn("advanced_settings", s.errors)

    def test_advanced_settings_rejects_non_dict_node_settings(self):
        # A per-node settings entry that is not an object (e.g. a list) must be
        # rejected with a 400 rather than reaching traverse_graph_advanced's
        # settings.get(...) and raising a 500.
        from arango_api.serializers import AdvancedGraphTraversalSerializer

        s = AdvancedGraphTraversalSerializer(
            data={
                "node_ids": ["CL/0000061"],
                "advanced_settings": {"CL/0000061": ["not", "an", "object"]},
            }
        )
        self.assertFalse(s.is_valid())
        self.assertIn("advanced_settings", s.errors)


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

    def test_injection_field_names_rejected(self):
        # search_fields are interpolated into AQL (doc.`<field>`), so values
        # containing backticks or other non-identifier characters must be
        # rejected to prevent AQL injection.
        for bad_field in ["label`", "a` OR true OR `b", "doc.label", "with space"]:
            serializer = SearchRequestSerializer(
                data={"search_term": "cell", "search_fields": [bad_field]}
            )
            self.assertFalse(
                serializer.is_valid(), f"expected {bad_field!r} to be rejected"
            )
            self.assertIn("search_fields", serializer.errors)

    def test_identifier_field_names_accepted(self):
        # Real field names (letters, digits, underscores) remain valid.
        serializer = SearchRequestSerializer(
            data={
                "search_term": "cell",
                # Includes _from/_to: the frontend searches edge/system
                # attributes, so leading underscores must be accepted.
                "search_fields": [
                    "label",
                    "gene_symbol",
                    "number_of_amino_acids",
                    "_from",
                    "_to",
                ],
            }
        )
        self.assertTrue(serializer.is_valid(), serializer.errors)

    def test_real_frontend_search_fields_accepted(self):
        # Regression guard for "search returns no results": the frontend sends
        # search_fields from getAllSearchableFields() (every collection's
        # individual_fields[].field_to_display), which includes edge attributes
        # like _from/_to. If the field-name validator rejects any of them, the
        # whole request 400s and the user sees zero results.
        #
        # Drive the validator with the REAL field set and the search terms the
        # team reported ("K" broad match, "KCNK3" gene-symbol match).
        maps_path = (
            settings.BASE_DIR
            / "react"
            / "src"
            / "assets"
            / "nlm-ckn-collection-maps.json"
        )
        with open(maps_path) as fh:
            collection_maps = dict(json.load(fh)["maps"])

        # Mirror frontend getAllSearchableFields(): union of field_to_display.
        search_fields = sorted(
            {
                field["field_to_display"]
                for config in collection_maps.values()
                for field in config.get("individual_fields", [])
            }
        )
        self.assertIn("_from", search_fields)  # the field that caused the regression

        # Reported search terms; add more here to expand coverage.
        search_terms = ["K", "KCNK3"]
        for term in search_terms:
            serializer = SearchRequestSerializer(
                data={"search_term": term, "search_fields": search_fields}
            )
            self.assertTrue(
                serializer.is_valid(),
                f"term {term!r} rejected: {serializer.errors}",
            )


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
