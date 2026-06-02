"""
Integration tests for the services layer.

These tests require a running ArangoDB instance with test data.

Run integration tests only:
    ARANGO_TEST_MODE=true python manage.py test --tag=integration

Test Configuration:
    Tests use a separate ArangoDB instance on port 8530 with "-Test" suffix
    databases to avoid conflicts with the development instance.

    To start a test ArangoDB instance:
        docker run -d --name arangodb-test -p 8530:8529 -e ARANGO_ROOT_PASSWORD=test arangodb
"""

from unittest import mock

from django.test import TestCase, tag

from arango_api.services import (
    collection_service,
    document_service,
    graph_service,
    search_service,
    sunburst_service,
    workflow_service,
)
from arango_api.services.workflow_service import _find_post_merge_inter_node_edges
from arango_api.tests.seed_test_db import seed_test_databases


@tag("integration")
class ArangoDBTestCase(TestCase):
    """Base test case that seeds the ArangoDB test databases."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        seed_test_databases(verbose=False)


class CollectionServiceTestCase(ArangoDBTestCase):
    """Tests for collection_service functions."""

    def test_get_collections_document(self):
        result = collection_service.get_collections("document")
        self.assertIn("CL", result)
        self.assertIn("GO", result)

    def test_get_collections_edge(self):
        result = collection_service.get_collections("edge")
        self.assertIn("CL-CL", result)

    def test_get_all_by_collection(self):
        result = list(collection_service.get_all_by_collection("CL", "ontologies"))
        self.assertEqual(len(result), 6)

    def test_get_by_id(self):
        result = collection_service.get_by_id("CL", "CL/0002145")
        self.assertEqual(
            result["label"], "ciliated columnar cell of tracheobronchial tree"
        )

    def test_get_by_id_not_found(self):
        result = collection_service.get_by_id("CL", "CL/nonexistent")
        self.assertIsNone(result)

    def test_get_edges_by_id(self):
        result = list(
            collection_service.get_edges_by_id("CL-CL", "_from", "CL", "0000061")
        )
        self.assertEqual(len(result), 3)


class DocumentServiceTestCase(ArangoDBTestCase):
    """Tests for document_service functions."""

    def test_get_documents(self):
        result = document_service.get_documents(
            document_ids=["CL/0000061", "CL/0000062"],
            graph_name="ontologies",
        )
        self.assertEqual(len(result), 2)

    def test_get_documents_empty_list(self):
        result = document_service.get_documents(
            document_ids=[], graph_name="ontologies"
        )
        self.assertEqual(result, [])

    def test_get_documents_nonexistent(self):
        result = document_service.get_documents(
            document_ids=["CL/nonexistent"],
            graph_name="ontologies",
        )
        self.assertEqual(len(result), 0)

    def test_get_edge_filter_options(self):
        result = document_service.get_edge_filter_options(fields_to_query=["label"])
        self.assertEqual(result["label"]["type"], "categorical")
        self.assertEqual(
            sorted(result["label"]["values"]),
            sorted(["subClassOf", "participates_in", "part_of"]),
        )


class GraphServiceTestCase(ArangoDBTestCase):
    """Tests for graph_service functions."""

    def test_traverse_graph(self):
        result = graph_service.traverse_graph(
            node_ids=["CL/0000061"],
            depth=1,
            edge_direction="OUTBOUND",
            allowed_collections=["CL"],
            graph="ontologies",
            edge_filters=None,
            include_inter_node_edges=False,
        )
        self.assertIn("CL/0000061", result)
        self.assertIn("nodes", result["CL/0000061"])
        self.assertIn("links", result["CL/0000061"])

    def test_traverse_graph_invalid_direction(self):
        with self.assertRaises(ValueError):
            graph_service.traverse_graph(
                node_ids=["CL/0000061"],
                depth=1,
                edge_direction="INVALID",
                allowed_collections=["CL"],
                graph="ontologies",
                edge_filters=None,
            )

    def test_find_shortest_paths(self):
        result = graph_service.find_shortest_paths(
            node_ids=["CL/0000061", "CL/0000062"],
            edge_direction="ANY",
        )
        self.assertIn("nodes", result)
        self.assertIn("links", result)

    def test_find_shortest_paths_single_node(self):
        result = graph_service.find_shortest_paths(
            node_ids=["CL/0000061"],
            edge_direction="ANY",
        )
        self.assertEqual(result, {"nodes": [], "links": []})

    def test_traverse_graph_advanced(self):
        result = graph_service.traverse_graph_advanced(
            node_ids=["CL/0000061"],
            advanced_settings={
                "CL/0000061": {
                    "depth": 1,
                    "edgeDirection": "OUTBOUND",
                    "allowedCollections": ["CL"],
                },
            },
            graph="ontologies",
        )
        self.assertIn("CL/0000061", result)

    def test_traverse_graph_with_categorical_filter(self):
        # Regression guard: filter clause path is exercised. From CL/0000061
        # OUTBOUND, filter to label="subClassOf" — only CL-CL subClassOf edges
        # should appear in the links. CL-GO (participates_in) and CL-UBERON
        # (part_of) edges must be excluded.
        result = graph_service.traverse_graph(
            node_ids=["CL/0000061"],
            depth=1,
            edge_direction="OUTBOUND",
            allowed_collections=["CL", "GO", "UBERON"],
            graph="ontologies",
            edge_filters={"label": ["subClassOf"]},
            include_inter_node_edges=False,
        )
        links = result["CL/0000061"]["links"]
        self.assertGreater(len(links), 0)
        for link in links:
            self.assertEqual(link["label"], "subClassOf")

    def test_traverse_graph_with_numeric_filter(self):
        # Regression guard: numeric range filter path. No seed edges have a
        # numeric `score` attribute, so the e.field != null guard excludes all.
        result = graph_service.traverse_graph(
            node_ids=["CL/0000061"],
            depth=1,
            edge_direction="OUTBOUND",
            allowed_collections=["CL", "GO", "UBERON"],
            graph="ontologies",
            edge_filters={"score": {"min": 0.5, "max": 1.0}},
            include_inter_node_edges=False,
        )
        self.assertEqual(result["CL/0000061"]["links"], [])

    def test_find_inter_node_edges_no_filters(self):
        # Without filters, all edges between the given nodes are returned.
        # CL/0000061 connects to CL/0000151 (subClassOf), GO/0008150
        # (participates_in), UBERON/0000061 (part_of).
        result = graph_service.find_inter_node_edges(
            node_ids=["CL/0000061", "CL/0000151", "GO/0008150", "UBERON/0000061"],
            graph="ontologies",
        )
        self.assertEqual(len(result), 3)

    def test_find_inter_node_edges_categorical_filter(self):
        result = graph_service.find_inter_node_edges(
            node_ids=["CL/0000061", "CL/0000151", "GO/0008150", "UBERON/0000061"],
            graph="ontologies",
            edge_filters={"label": ["subClassOf"]},
        )
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["label"], "subClassOf")

    def test_find_inter_node_edges_numeric_filter(self):
        # No edges have a `score` attribute, so range filter excludes all.
        result = graph_service.find_inter_node_edges(
            node_ids=["CL/0000061", "CL/0000151", "GO/0008150", "UBERON/0000061"],
            graph="ontologies",
            edge_filters={"score": {"min": 0.5, "max": 1.0}},
        )
        self.assertEqual(result, [])

    def test_traverse_graph_inter_node_edges_respect_filters(self):
        # When traverse_graph's self-call to find_inter_node_edges runs,
        # the filter must propagate. With label=subClassOf, the post-traversal
        # inter-node scan should respect the filter.
        result = graph_service.traverse_graph(
            node_ids=["CL/0000061"],
            depth=1,
            edge_direction="OUTBOUND",
            allowed_collections=["CL", "GO", "UBERON"],
            graph="ontologies",
            edge_filters={"label": ["subClassOf"]},
            include_inter_node_edges=True,
        )
        links = result["CL/0000061"]["links"]
        for link in links:
            self.assertEqual(link["label"], "subClassOf")

    def test_get_neighbor_collections_returns_distinct_collections(self):
        # CL/0000061 has OUTBOUND edges to CL, GO, and UBERON in the seed data.
        result = graph_service.get_neighbor_collections(
            node_id="CL/0000061",
            graph="ontologies",
            edge_direction="OUTBOUND",
        )
        self.assertIsInstance(result, list)
        self.assertEqual(result, sorted(result), "Result must be sorted")
        self.assertIn("CL", result)
        self.assertIn("GO", result)
        self.assertIn("UBERON", result)
        self.assertEqual(len(result), len(set(result)), "Result must be distinct")

    def test_get_neighbor_collections_nonexistent_node_returns_empty(self):
        # A non-existent node id should return no neighbors regardless of direction.
        result = graph_service.get_neighbor_collections(
            node_id="CL/nonexistent",
            graph="ontologies",
            edge_direction="INBOUND",
        )
        self.assertEqual(result, [])

    def test_get_neighbor_collections_invalid_direction_raises(self):
        with self.assertRaises(ValueError):
            graph_service.get_neighbor_collections(
                node_id="CL/0000061",
                graph="ontologies",
                edge_direction="bad",
            )


class WorkflowServiceTestCase(ArangoDBTestCase):
    """Tests for workflow_service functions, focused on edge_filters propagation."""

    def _nodes_with_links(self):
        return [
            {"_id": "CL/0000061"},
            {"_id": "CL/0000151"},
            {"_id": "GO/0008150"},
            {"_id": "UBERON/0000061"},
        ]

    def test_post_merge_inter_node_edges_no_filters(self):
        # Baseline: all 3 edges between the merged nodes are added.
        merged = {"nodes": self._nodes_with_links(), "links": []}
        result = _find_post_merge_inter_node_edges(merged, "ontologies")
        self.assertEqual(len(result["links"]), 3)

    def test_post_merge_inter_node_edges_respect_filters(self):
        # With label=subClassOf filter, only the CL-CL subClassOf edge survives.
        merged = {"nodes": self._nodes_with_links(), "links": []}
        result = _find_post_merge_inter_node_edges(
            merged, "ontologies", edge_filters={"label": ["subClassOf"]}
        )
        self.assertEqual(len(result["links"]), 1)
        self.assertEqual(result["links"][0]["label"], "subClassOf")

    def test_combine_phase_inter_node_edges_respect_filters(self):
        # Two phases that each return one node, and the combine phase scans
        # for inter-node edges between them. With label=subClassOf, only
        # CL-CL/subClassOf edges should appear, not the CL-GO participates_in.
        phases = [
            {
                "id": "phase1",
                "originSource": "manual",
                "originNodeIds": ["CL/0000061"],
                "settings": {
                    "depth": 1,
                    "edgeDirection": "OUTBOUND",
                    "allowedCollections": ["CL"],
                    "graphType": "ontologies",
                    "includeInterNodeEdges": False,
                    "setOperation": "Union",
                },
            },
            {
                "id": "phase2",
                "originSource": "manual",
                "originNodeIds": ["GO/0008150"],
                "settings": {
                    "depth": 1,
                    "edgeDirection": "ANY",
                    "allowedCollections": ["GO"],
                    "graphType": "ontologies",
                    "includeInterNodeEdges": False,
                    "setOperation": "Union",
                },
            },
            {
                "id": "combine",
                "originSource": "multiplePhases",
                "previousPhaseIds": ["phase1", "phase2"],
                "phaseCombineOperation": "Union",
                "originFilter": "all",
                "settings": {
                    "graphType": "ontologies",
                    "includeInterNodeEdges": True,
                    "edgeFilters": {"label": ["subClassOf"]},
                },
            },
        ]
        result = workflow_service.execute_workflow(phases, graph="ontologies")
        combine_links = result["phases"]["combine"]["links"]
        # The CL/0000061 -> GO/0008150 participates_in edge would normally be
        # included by the combine post-merge scan, but the filter excludes it.
        for link in combine_links:
            self.assertEqual(link["label"], "subClassOf")


class SearchServiceTestCase(ArangoDBTestCase):
    """Tests for search_service functions."""

    def test_get_all_documents(self):
        result = search_service.get_all_documents()
        self.assertGreater(len(result), 0)

    def test_run_aql_query(self):
        result = search_service.run_aql_query("RETURN 1 + 1")
        self.assertEqual(result, 2)


class SearchByTermQueryTestCase(TestCase):
    """Unit tests for search_by_term query construction (no DB required)."""

    def _run(self, search_fields):
        """Invoke search_by_term with the DB layer mocked out.

        Returns the (query, bind_vars) passed to aql.execute.
        """
        cursor = mock.Mock()
        cursor.next.return_value = []
        db_connection = mock.Mock()
        db_connection.aql.execute.return_value = cursor

        with mock.patch.object(
            search_service, "get_db_and_graph", return_value=(db_connection, None)
        ):
            search_service.search_by_term("cell", search_fields, "ontologies")

        _, kwargs = db_connection.aql.execute.call_args
        return db_connection.aql.execute.call_args[0][0], kwargs["bind_vars"]

    def test_query_applies_limit_as_bind_var(self):
        query, bind_vars = self._run(["label"])
        # LIMIT must come after the SORT and use a bind var, not an interpolated
        # number, so the relevance ranking is preserved while capping output.
        self.assertIn("LIMIT @limit", query)
        self.assertEqual(bind_vars["limit"], search_service.SEARCH_RESULT_LIMIT)
        sort_idx = query.index("SORT is_exact_match DESC")
        self.assertLess(sort_idx, query.index("LIMIT @limit"))

    def test_query_projects_minimal_fields(self):
        query, bind_vars = self._run(["label", "definition"])
        # The full document is no longer returned; only _id plus a projected
        # field set is serialized back to the dropdown.
        self.assertNotIn("RETURN doc\n", query)
        self.assertIn("KEEP(doc, @projection_fields)", query)
        self.assertIn('"_id": doc._id', query)

        projection = bind_vars["projection_fields"]
        # Searched fields and getLabel() label fields are present.
        self.assertIn("label", projection)
        self.assertIn("definition", projection)
        self.assertIn("gene_symbol", projection)
        # _id is merged explicitly, so it need not appear in the KEEP list.
        for field in search_service.LABEL_FIELDS:
            self.assertIn(field, projection)

    def test_ranking_clauses_unchanged(self):
        query, _ = self._run(["label"])
        # Exact-match boost, BM25, Levenshtein and n-gram branches still present.
        self.assertIn("is_exact_match", query)
        self.assertIn("BM25(doc)", query)
        self.assertIn("LEVENSHTEIN_MATCH", query)
        self.assertIn('"n-gram"', query)


class SunburstServiceTestCase(ArangoDBTestCase):
    """Tests for sunburst_service functions."""

    def test_get_ontologies_sunburst(self):
        result = sunburst_service.get_ontologies_sunburst()
        self.assertEqual(result["_id"], "root_nlm")
        self.assertIn("children", result)
        child_ids = [c["_id"] for c in result["children"]]
        self.assertIn("CL/0000000", child_ids)

    def test_get_ontologies_sunburst_with_parent(self):
        result = sunburst_service.get_ontologies_sunburst(parent_id="CL/0000000")
        self.assertEqual(len(result), 3)

    def test_get_phenotypes_sunburst(self):
        result = sunburst_service.get_phenotypes_sunburst()
        self.assertEqual(result["_id"], "NCBITaxon/9606")
