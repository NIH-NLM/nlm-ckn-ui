"""
Integration tests for the API views.

These tests use Django's test client to make HTTP requests to the API endpoints.
They require a running ArangoDB instance with test data.

Run integration tests only:
    ARANGO_TEST_MODE=true python manage.py test --tag=integration

Test Configuration:
    Tests use a separate ArangoDB instance on port 8530 with "-Test" suffix
    databases to avoid conflicts with the development instance.

    To start a test ArangoDB instance:
        docker run -d --name arangodb-test -p 8530:8529 -e ARANGO_ROOT_PASSWORD=test arangodb
"""

import tempfile
from pathlib import Path

from django.test import SimpleTestCase, TestCase, override_settings, tag
from django.urls import reverse

from arango_api.tests.seed_test_db import seed_test_databases


@tag("integration")
class ArangoDBViewTestCase(TestCase):
    """Base test case for view tests requiring ArangoDB."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        seed_test_databases(verbose=False)


class CollectionViewsTestCase(ArangoDBViewTestCase):
    """Tests for collection-related API endpoints."""

    def test_list_collection_names(self):
        response = self.client.post(
            reverse("list_collection_names"),
            data={},
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIn("CL", data)
        self.assertIn("GO", data)

    def test_list_by_collection(self):
        response = self.client.post(
            reverse("list_by_collection", kwargs={"coll": "publication_ind"}),
            data={},
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(len(data), 2)

    def test_collection_count(self):
        response = self.client.post(
            reverse("collection_count", kwargs={"coll": "publication_ind"}),
            data={},
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"count": 2})

    def test_get_object(self):
        response = self.client.get(
            reverse(
                "get_object",
                kwargs={"coll": "publication_ind", "pk": "Sikkema-et-al-2023-Nat-Med"},
            )
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["label"], "HLCA")

    def test_get_object_not_found(self):
        response = self.client.get(
            reverse(
                "get_object",
                kwargs={"coll": "publication_ind", "pk": "nonexistent"},
            )
        )
        self.assertEqual(response.status_code, 404)

    def test_get_related_edges(self):
        response = self.client.get(
            reverse(
                "get_related_edges",
                kwargs={
                    "edge_coll": "CL-CL",
                    "dr": "_from",
                    "item_coll": "CL",
                    "pk": "0000061",
                },
            )
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.json()), 3)

    def test_invalid_graph_rejected(self):
        response = self.client.post(
            reverse("list_collection_names"),
            data={"graph": "invalid_graph"},
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 400)


class GraphViewsTestCase(ArangoDBViewTestCase):
    """Tests for graph traversal API endpoints."""

    def test_graph_traversal(self):
        response = self.client.post(
            reverse("get_graph"),
            data={
                "node_ids": ["CL/0000061"],
                "depth": 1,
                "edge_direction": "OUTBOUND",
                "allowed_collections": ["CL"],
            },
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIn("CL/0000061", data)
        self.assertIn("nodes", data["CL/0000061"])
        self.assertIn("links", data["CL/0000061"])

    def test_graph_traversal_invalid_request(self):
        response = self.client.post(
            reverse("get_graph"),
            data={"depth": 1},  # missing required fields
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 400)

    def test_shortest_paths(self):
        response = self.client.post(
            reverse("get_shortest_paths"),
            data={"node_ids": ["CL/0000061", "CL/0000062"]},
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIn("nodes", data)
        self.assertIn("links", data)

    def test_advanced_graph_traversal(self):
        response = self.client.post(
            reverse("get_graph"),
            data={
                "node_ids": ["CL/0000061"],
                "advanced_settings": {
                    "CL/0000061": {
                        "depth": 1,
                        "edgeDirection": "OUTBOUND",
                        "allowedCollections": ["CL"],
                    },
                },
            },
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertIn("CL/0000061", response.json())

    def test_graph_traversal_honors_exclude_closing_edges(self):
        node_ids = ["MONDO/nac_d1", "MONDO/nac_d2", "MONDO/nac_d3"]
        settings = {
            "depth": 3,
            "edgeDirection": "ANY",
            "allowedCollections": ["GS", "PR", "CHEMBL"],
            "edgeFilters": {
                "Label": [
                    "IS_GENETIC_BASIS_FOR_CONDITION",
                    "PRODUCES",
                    "MOLECULARLY_INTERACTS_WITH",
                ]
            },
            "excludeClosingEdges": {"Label": ["IS_SUBSTANCE_THAT_TREATS"]},
        }
        response = self.client.post(
            reverse("get_graph"),
            data={
                "node_ids": node_ids,
                "advanced_settings": {nid: settings for nid in node_ids},
                "graph": "phenotypes",
                "include_inter_node_edges": False,
            },
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        body = response.json()
        gene_ids = set()
        for data in body.values():
            for node in data.get("nodes", []):
                if node["_id"].startswith("GS/"):
                    gene_ids.add(node["_id"])
        self.assertIn("GS/nac_g1", gene_ids)
        self.assertNotIn("GS/nac_g2", gene_ids)

    def test_phenotypes_graph(self):
        response = self.client.post(
            reverse("get_graph"),
            data={
                "node_ids": ["NCBITaxon/9606"],
                "depth": 1,
                "edge_direction": "ANY",
                "allowed_collections": ["NCBITaxon", "UBERON"],
                "graph": "phenotypes",
            },
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertIn("NCBITaxon/9606", response.json())

    def test_neighbor_collections_valid_request(self):
        response = self.client.post(
            reverse("get_neighbor_collections"),
            data={"node_id": "CL/0000061", "edge_direction": "OUTBOUND"},
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIn("collections", data)
        self.assertIsInstance(data["collections"], list)
        self.assertIn("CL", data["collections"])
        self.assertIn("GO", data["collections"])
        self.assertIn("UBERON", data["collections"])

    def test_neighbor_collections_missing_node_id(self):
        response = self.client.post(
            reverse("get_neighbor_collections"),
            data={"edge_direction": "ANY"},
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 400)


class EdgesBetweenViewTestCase(ArangoDBViewTestCase):
    """Tests for the /graph/edges-between/ endpoint."""

    NODES = ["CL/0000061", "CL/0000151", "GO/0008150", "UBERON/0000061"]

    def test_baseline_no_filters(self):
        response = self.client.post(
            reverse("get_edges_between"),
            data={"node_ids": self.NODES, "graph": "ontologies"},
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        # Three edges between these nodes: CL-CL, CL-GO, CL-UBERON
        self.assertEqual(len(response.json()), 3)

    def test_categorical_filter(self):
        response = self.client.post(
            reverse("get_edges_between"),
            data={
                "node_ids": self.NODES,
                "graph": "ontologies",
                "edge_filters": {"label": ["subClassOf"]},
            },
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        edges = response.json()
        self.assertEqual(len(edges), 1)
        self.assertEqual(edges[0]["label"], "subClassOf")

    def test_numeric_filter(self):
        # No edges have a `score` attribute, so the range filter excludes all.
        response = self.client.post(
            reverse("get_edges_between"),
            data={
                "node_ids": self.NODES,
                "graph": "ontologies",
                "edge_filters": {"score": {"min": 0.5, "max": 1.0}},
            },
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), [])


class SearchViewsTestCase(ArangoDBViewTestCase):
    """Tests for search API endpoints."""

    def test_get_all(self):
        response = self.client.get(reverse("get_all"))
        self.assertEqual(response.status_code, 200)
        self.assertGreater(len(response.json()), 0)

    def test_aql_query(self):
        response = self.client.post(
            reverse("run_aql_query"),
            data={"query": "RETURN 1 + 1"},
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), 2)

    def test_aql_write_operations_blocked(self):
        """Verify the API blocks write operations (serializer validation works end-to-end)."""
        response = self.client.post(
            reverse("run_aql_query"),
            data={"query": "INSERT {name: 'test'} INTO users"},
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 400)


class SunburstViewsTestCase(ArangoDBViewTestCase):
    """Tests for sunburst visualization API endpoints."""

    def test_sunburst_ontologies(self):
        response = self.client.post(
            reverse("get_sunburst"),
            data={},
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["_id"], "root_nlm")
        self.assertIn("children", data)

    def test_sunburst_with_parent(self):
        response = self.client.post(
            reverse("get_sunburst"),
            data={"parent_id": "CL/0000000"},
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertIsInstance(response.json(), list)

    def test_sunburst_phenotypes(self):
        response = self.client.post(
            reverse("get_sunburst"),
            data={"graph": "phenotypes"},
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["_id"], "NCBITaxon/9606")

    def test_sunburst_phenotypes_drilldown_uberon(self):
        # Expanding a seeded organ exercises the heavy aggregation path end to
        # end through the view: UBERON/0002048 -> CL/0000066 (with GS chain).
        response = self.client.post(
            reverse("get_sunburst"),
            data={"graph": "phenotypes", "parent_id": "UBERON/0002048"},
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIsInstance(data, list)
        self.assertIn("CL/0000066", [node["_id"] for node in data])

    def test_sunburst_phenotypes_drilldown_cl(self):
        response = self.client.post(
            reverse("get_sunburst"),
            data={"graph": "phenotypes", "parent_id": "CL/0000066"},
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIsInstance(data, list)
        self.assertIn("GS/test_gs_1", [node["_id"] for node in data])

    def test_sunburst_phenotypes_drilldown_gs(self):
        response = self.client.post(
            reverse("get_sunburst"),
            data={"graph": "phenotypes", "parent_id": "GS/test_gs_1"},
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIsInstance(data, list)
        self.assertIn("MONDO/0000001", [node["_id"] for node in data])


class DocumentViewsTestCase(ArangoDBViewTestCase):
    """Tests for document-related API endpoints."""

    def test_get_documents(self):
        response = self.client.post(
            reverse("document-details"),
            data={"document_ids": ["CL/0000061", "CL/0000062"]},
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.json()), 2)

    def test_get_documents_invalid_request(self):
        response = self.client.post(
            reverse("document-details"),
            data={"document_ids": []},
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 400)

    def test_edge_filter_options(self):
        response = self.client.post(
            reverse("get_edge_filter_options"),
            data={"fields": ["label"]},
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIn("label", data)
        self.assertEqual(data["label"]["type"], "categorical")
        self.assertEqual(
            sorted(data["label"]["values"]),
            sorted(["subClassOf", "participates_in", "part_of"]),
        )


class VersionViewTestCase(SimpleTestCase):
    """Tests for the version endpoint. Reads a file and a setting; no ArangoDB."""

    def test_returns_both_version_keys(self):
        response = self.client.get(reverse("get_version"))
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIn("ui_version", data)
        self.assertIn("etl_version", data)

    def test_etl_version_reflects_stripped_file_contents(self):
        with tempfile.TemporaryDirectory() as tmp:
            (Path(tmp) / "ETL_VERSION").write_text("v9.9.9-test\n")
            with override_settings(BASE_DIR=Path(tmp)):
                response = self.client.get(reverse("get_version"))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["etl_version"], "v9.9.9-test")

    def test_missing_etl_version_file_returns_unknown(self):
        with tempfile.TemporaryDirectory() as tmp:
            with override_settings(BASE_DIR=Path(tmp)):
                response = self.client.get(reverse("get_version"))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["etl_version"], "unknown")

    def test_blank_etl_version_file_returns_unknown(self):
        with tempfile.TemporaryDirectory() as tmp:
            (Path(tmp) / "ETL_VERSION").write_text("   \n")
            with override_settings(BASE_DIR=Path(tmp)):
                response = self.client.get(reverse("get_version"))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["etl_version"], "unknown")

    def test_ui_version_reflects_setting(self):
        with override_settings(UI_VERSION="v9.9.9"):
            response = self.client.get(reverse("get_version"))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["ui_version"], "v9.9.9")


class CircuitBreakerOpenResponseTestCase(SimpleTestCase):
    """Documents how an open ArangoDB circuit breaker surfaces to API clients.

    The breaker (see arango_api.circuit_breaker) raises ``CircuitBreakerOpen``
    from the HTTP-client layer when the DB is down. No live DB is needed here:
    we patch the service the view calls to raise it exactly as the hardened
    client would, then pin the resulting response so the behavior can't change
    silently.
    """

    def test_aql_view_open_breaker_surfaces_as_500(self):
        from unittest import mock

        from arango_api.circuit_breaker import CircuitBreakerOpen

        with mock.patch(
            "arango_api.services.search_service.run_aql_query",
            side_effect=CircuitBreakerOpen("arango circuit open; failing fast"),
        ):
            response = self.client.post(
                reverse("run_aql_query"),
                data={"query": "RETURN 1"},
                content_type="application/json",
            )

        # The view's `except Exception` maps it to a 500 with an error body.
        self.assertEqual(response.status_code, 500)
        self.assertIn("error", response.json())
