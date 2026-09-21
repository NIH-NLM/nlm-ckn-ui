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
from unittest import mock

from django.test import SimpleTestCase, TestCase, override_settings, tag
from django.urls import reverse

from arango_api.serializers import GraphTraversalSerializer
from arango_api.services import document_service, version_service
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
                "edge_filters": {"Label": ["SUB_CLASS_OF"]},
            },
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        edges = response.json()
        self.assertEqual(len(edges), 1)
        self.assertEqual(edges[0]["Label"], "SUB_CLASS_OF")

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

    # Disabled: these exercise the /get_all/ and /aql/ endpoints, whose routes
    # are commented out in arango_api/urls.py (unused by the app). Restore these
    # tests alongside the routes.
    # def test_get_all(self):
    #     response = self.client.get(reverse("get_all"))
    #     self.assertEqual(response.status_code, 200)
    #     self.assertGreater(len(response.json()), 0)
    #
    # def test_aql_query(self):
    #     response = self.client.post(
    #         reverse("run_aql_query"),
    #         data={"query": "RETURN 1 + 1"},
    #         content_type="application/json",
    #     )
    #     self.assertEqual(response.status_code, 200)
    #     self.assertEqual(response.json(), 2)
    #
    # def test_aql_write_operations_blocked(self):
    #     """Verify the API blocks write operations (serializer validation works end-to-end)."""
    #     response = self.client.post(
    #         reverse("run_aql_query"),
    #         data={"query": "INSERT {name: 'test'} INTO users"},
    #         content_type="application/json",
    #     )
    #     self.assertEqual(response.status_code, 400)


@tag("integration")
class HierarchyViewsTestCase(ArangoDBViewTestCase):
    """Tests for the CL hierarchy API endpoints.

    Exercises the existing CL-CL SUB_CLASS_OF fixture (seed_test_db.py):
    child -> parent edges 61->151, 61->62, 61->7002, 62->0, 151->0, 7002->0.
    CL/0000061 has three parents, so it is the DAG case: reachable from the
    root by three distinct paths, counted once.
    """

    def test_hierarchy_root_returns_two_levels(self):
        response = self.client.post(
            reverse("get_hierarchy"),
            data={"label": "SUB_CLASS_OF"},
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        root = response.json()
        self.assertEqual(root["_id"], "CL/0000000")
        child_ids = sorted(child["_id"] for child in root["children"])
        self.assertEqual(child_ids, ["CL/0000062", "CL/0000151", "CL/0007002"])
        # Grandchildren arrive with the root, for the Browse page's prefetch
        for child in root["children"]:
            self.assertEqual(child["descendant_count"], 1)
            self.assertEqual([g["_id"] for g in child["children"]], ["CL/0000061"])

    def test_hierarchy_counts_a_node_reachable_by_three_paths_once(self):
        response = self.client.post(
            reverse("get_hierarchy"),
            data={"label": "SUB_CLASS_OF"},
            content_type="application/json",
        )
        root = response.json()
        # root reaches 0000062, 0000151, 0007002 and 0000061 — 0000061 has
        # three parents but must be counted once, not three times.
        self.assertEqual(root["descendant_count"], 4)

    def test_hierarchy_expansion_returns_a_leaf_with_no_children(self):
        response = self.client.post(
            reverse("get_hierarchy"),
            data={"label": "SUB_CLASS_OF", "parent_id": "CL/0000062"},
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        children = response.json()
        self.assertEqual([c["_id"] for c in children], ["CL/0000061"])
        self.assertFalse(children[0]["_hasChildren"])
        self.assertEqual(children[0]["children"], [])

    def test_hierarchy_rejects_an_unknown_label(self):
        response = self.client.post(
            reverse("get_hierarchy"),
            data={"label": "NOT_A_PREDICATE"},
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("SUB_CLASS_OF", response.json()["error"])

    def test_hierarchy_rejects_a_parent_from_another_collection(self):
        response = self.client.post(
            reverse("get_hierarchy"),
            data={"label": "SUB_CLASS_OF", "parent_id": "UBERON/0002048"},
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 400)

    def test_labels_lists_sub_class_of_with_its_edge_count(self):
        response = self.client.get(reverse("get_hierarchy_labels"))
        self.assertEqual(response.status_code, 200)
        labels = response.json()
        self.assertEqual([entry["label"] for entry in labels], ["SUB_CLASS_OF"])
        self.assertEqual(labels[0]["root"], "CL/0000000")
        self.assertEqual(labels[0]["edge_count"], 6)


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
            data={"fields": ["Label"]},
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIn("Label", data)
        self.assertEqual(data["Label"]["type"], "categorical")
        self.assertEqual(
            sorted(data["Label"]["values"]),
            sorted(["SUB_CLASS_OF", "PARTICIPATES_IN", "PART_OF"]),
        )


class EdgeFilterOptionsGraphTestCase(SimpleTestCase):
    """The view must pass the requested graph through to the service, not
    silently drop it (the service is not called for the correct graph
    otherwise)."""

    def test_passes_requested_graph_to_service(self):
        with mock.patch.object(
            document_service, "get_edge_filter_options", return_value={}
        ) as mock_get_edge_filter_options:
            response = self.client.post(
                reverse("get_edge_filter_options"),
                data={"fields": ["Label"], "graph": "phenotypes"},
                content_type="application/json",
            )
        self.assertEqual(response.status_code, 200)
        mock_get_edge_filter_options.assert_called_once_with(
            ["Label"], graph="phenotypes"
        )


class VersionViewTestCase(SimpleTestCase):
    """Tests for the version endpoint.

    The endpoint must answer even when ArangoDB is unreachable, so the loaded
    ETL version is patched at the service seam rather than requiring a live DB.
    """

    def setUp(self):
        version_service.reset_cache()

    def _patch_loaded(self, value):
        return mock.patch.object(
            version_service, "get_loaded_etl_version", return_value=value
        )

    def test_returns_all_version_keys(self):
        with self._patch_loaded("v1.5.0-rc.1"):
            response = self.client.get(reverse("get_version"))
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIn("backend_version", data)
        self.assertIn("etl_version", data)
        self.assertIn("pinned_etl_version", data)

    def test_etl_version_reports_the_loaded_dataset(self):
        with self._patch_loaded("v1.4.6-rc.6"):
            response = self.client.get(reverse("get_version"))
        self.assertEqual(response.json()["etl_version"], "v1.4.6-rc.6")

    def test_unreadable_marker_yields_unknown_without_failing_the_request(self):
        with self._patch_loaded("unknown"):
            response = self.client.get(reverse("get_version"))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["etl_version"], "unknown")

    def test_pinned_version_reflects_stripped_file_contents(self):
        with tempfile.TemporaryDirectory() as tmp:
            (Path(tmp) / "ETL_VERSION").write_text("v9.9.9-test\n")
            with override_settings(BASE_DIR=Path(tmp)), self._patch_loaded(
                "v1.5.0-rc.1"
            ):
                response = self.client.get(reverse("get_version"))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["pinned_etl_version"], "v9.9.9-test")

    def test_missing_pin_file_returns_unknown(self):
        with tempfile.TemporaryDirectory() as tmp:
            with override_settings(BASE_DIR=Path(tmp)), self._patch_loaded(
                "v1.5.0-rc.1"
            ):
                response = self.client.get(reverse("get_version"))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["pinned_etl_version"], "unknown")

    def test_blank_pin_file_returns_unknown(self):
        with tempfile.TemporaryDirectory() as tmp:
            (Path(tmp) / "ETL_VERSION").write_text("   \n")
            with override_settings(BASE_DIR=Path(tmp)), self._patch_loaded(
                "v1.5.0-rc.1"
            ):
                response = self.client.get(reverse("get_version"))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["pinned_etl_version"], "unknown")

    def test_backend_version_reflects_setting(self):
        with override_settings(UI_VERSION="v9.9.9"), self._patch_loaded("v1.5.0-rc.1"):
            response = self.client.get(reverse("get_version"))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["backend_version"], "v9.9.9")


class CircuitBreakerOpenResponseTestCase(SimpleTestCase):
    """Documents how an open ArangoDB circuit breaker surfaces to API clients.

    The breaker (see arango_api.circuit_breaker) raises ``CircuitBreakerOpen``
    from the HTTP-client layer when the DB is down. No live DB is needed here:
    we patch the service the view calls to raise it exactly as the hardened
    client would, then pin the resulting response so the behavior can't change
    silently.
    """

    # Disabled: exercises the /aql/ endpoint, whose route is commented out in
    # arango_api/urls.py (unused by the app). Restore alongside the route.
    # def test_aql_view_open_breaker_surfaces_as_500(self):
    #     from unittest import mock
    #
    #     from arango_api.circuit_breaker import CircuitBreakerOpen
    #
    #     with mock.patch(
    #         "arango_api.services.search_service.run_aql_query",
    #         side_effect=CircuitBreakerOpen("arango circuit open; failing fast"),
    #     ):
    #         response = self.client.post(
    #             reverse("run_aql_query"),
    #             data={"query": "RETURN 1"},
    #             content_type="application/json",
    #         )
    #
    #     # The view's `except Exception` maps it to a 500 with an error body.
    #     self.assertEqual(response.status_code, 500)
    #     self.assertIn("error", response.json())


class TerminalCollectionsSerializerTestCase(TestCase):
    """Serializer acceptance for terminal_collections (no DB required)."""

    def _payload(self, **overrides):
        payload = {
            "node_ids": ["GS/GUCY1A2"],
            "depth": 3,
            "edge_direction": "ANY",
            "allowed_collections": ["BGS", "CS", "UBERON", "CSD"],
            "graph": "phenotypes",
        }
        payload.update(overrides)
        return payload

    def test_accepts_list_of_collection_names(self):
        serializer = GraphTraversalSerializer(
            data=self._payload(terminal_collections=["UBERON", "CSD"])
        )
        self.assertTrue(serializer.is_valid(), serializer.errors)
        self.assertEqual(
            serializer.validated_data["terminal_collections"], ["UBERON", "CSD"]
        )

    def test_defaults_to_empty_list_when_absent(self):
        serializer = GraphTraversalSerializer(data=self._payload())
        self.assertTrue(serializer.is_valid(), serializer.errors)
        self.assertEqual(serializer.validated_data["terminal_collections"], [])

    def test_rejects_non_string_entries(self):
        serializer = GraphTraversalSerializer(
            data=self._payload(terminal_collections=[{"nope": 1}])
        )
        self.assertFalse(serializer.is_valid())
        self.assertIn("terminal_collections", serializer.errors)


class WorkflowPresetsAnnotationTestCase(SimpleTestCase):
    """The presets endpoint flags filters the loaded dataset cannot satisfy."""

    def _get(self):
        return self.client.get(reverse("workflow_presets"))

    def test_annotates_every_preset(self):
        with mock.patch(
            "arango_api.services.schema_guard.get_dataset_labels",
            return_value=frozenset({"PART_OF"}),
        ):
            response = self._get()
        self.assertEqual(response.status_code, 200)
        presets = response.json()["presets"]
        self.assertTrue(presets)
        for preset in presets:
            self.assertIn("unknown_labels", preset)

    def test_flags_a_label_the_dataset_lacks(self):
        with mock.patch(
            "arango_api.services.schema_guard.get_dataset_labels",
            return_value=frozenset({"PART_OF"}),
        ):
            presets = self._get().json()["presets"]
        flagged = [p for p in presets if p["unknown_labels"]]
        self.assertTrue(
            flagged, "expected presets to be flagged against a bare dataset"
        )

    def test_fails_open_when_labels_cannot_be_read(self):
        with mock.patch(
            "arango_api.services.schema_guard.get_dataset_labels", return_value=None
        ):
            presets = self._get().json()["presets"]
        self.assertTrue(presets)
        for preset in presets:
            self.assertEqual(preset["unknown_labels"], [])

    def test_does_not_mutate_the_module_level_presets(self):
        from arango_api.workflow_presets import WORKFLOW_PRESETS

        with mock.patch(
            "arango_api.services.schema_guard.get_dataset_labels",
            return_value=frozenset({"PART_OF"}),
        ):
            self._get()
        for preset in WORKFLOW_PRESETS:
            self.assertNotIn("unknown_labels", preset)
