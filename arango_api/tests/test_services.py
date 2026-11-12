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

import re
from unittest import mock

from django.test import SimpleTestCase, TestCase, tag

from arango_api.services import (
    collection_service,
    document_service,
    graph_service,
    label_service,
    search_service,
    workflow_service,
)
from arango_api.services.workflow_service import (
    _drop_null_nodes,
    _find_post_merge_inter_node_edges,
)
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
        # Ordered by key, so callers taking the first N get the same N.
        keys = [doc["_key"] for doc in result]
        self.assertEqual(keys, sorted(keys))

    def test_get_collection_count(self):
        self.assertEqual(collection_service.get_collection_count("CL", "ontologies"), 6)

    def test_get_collection_count_nonexistent(self):
        self.assertEqual(
            collection_service.get_collection_count("DoesNotExist", "ontologies"), 0
        )

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
        result = document_service.get_edge_filter_options(fields_to_query=["Label"])
        self.assertEqual(result["Label"]["type"], "categorical")
        self.assertEqual(
            sorted(result["Label"]["values"]),
            sorted(["SUB_CLASS_OF", "PARTICIPATES_IN", "PART_OF"]),
        )


class LabelServiceTestCase(ArangoDBTestCase):
    """Tests for label_service functions."""

    maxDiff = None

    def test_get_cell_set_label_lookups(self):
        self.assertEqual(
            label_service.get_cell_set_label_lookups(),
            {
                "publications": {
                    "10.1038/s41591-023-02327-2": "Sikkema (2023) Nat Med",
                    "10.0/none": None,
                },
                "anatomical_structures": {"UBERON:0002048": "lung"},
                "cell_sets": {
                    key: {
                        "author_cell_term": "Test cell term",
                        "publication": doi,
                        "dataset_name": "Test dataset",
                        "anatomical_structure": "UBERON:0002048",
                    }
                    for key, doi in (
                        ("test_cs_1", "10.1038/s41591-023-02327-2"),
                        ("test_cs_2", "10.0/none"),
                    )
                },
            },
        )


class GetEdgeFilterOptionsGraphTestCase(SimpleTestCase):
    """edge_filter_options must query the requested graph, not always ontologies."""

    def _run(self, graph=None):
        fake_db = mock.MagicMock()
        fake_db.aql.execute.return_value = iter(
            [{"Label": {"type": "categorical", "values": ["FOO"]}}]
        )
        with mock.patch.object(
            document_service,
            "get_db_and_graph",
            return_value=(fake_db, "some-graph-name"),
        ) as mock_get_db_and_graph, mock.patch.object(
            document_service, "get_collections", return_value=["A-B"]
        ) as mock_get_collections:
            if graph is None:
                document_service.get_edge_filter_options(["Label"])
            else:
                document_service.get_edge_filter_options(["Label"], graph=graph)
        return mock_get_db_and_graph, mock_get_collections

    def test_uses_requested_graph_connection(self):
        mock_get_db_and_graph, _ = self._run(graph="phenotypes")
        mock_get_db_and_graph.assert_called_once_with("phenotypes")

    def test_defaults_to_ontologies_connection(self):
        mock_get_db_and_graph, _ = self._run()
        mock_get_db_and_graph.assert_called_once_with("ontologies")

    def test_edge_collections_looked_up_for_requested_graph(self):
        _, mock_get_collections = self._run(graph="phenotypes")
        mock_get_collections.assert_called_once_with("edge", "phenotypes")


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

    def test_traverse_graph_missing_start_node_returns_no_null_nodes(self):
        """A start node that no longer exists must not surface as a null node.

        DOCUMENT() returns null for an unknown id. Unioning that null into the
        node list hands the client a `[null]` array, which blows up any
        consumer that reads a property off each node. Datasets get re-keyed
        between ETL releases (CSD keys gained an `__<anatomy>` suffix), so a
        preset anchored on a retired id hits this path routinely.
        """
        result = graph_service.traverse_graph(
            node_ids=["CL/does-not-exist"],
            depth=1,
            edge_direction="OUTBOUND",
            allowed_collections=["CL"],
            graph="ontologies",
            edge_filters=None,
            include_inter_node_edges=False,
        )
        nodes = result["CL/does-not-exist"]["nodes"]
        self.assertNotIn(None, nodes)
        self.assertEqual(nodes, [])

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
        # OUTBOUND, filter to label="SUB_CLASS_OF" — only CL-CL SUB_CLASS_OF edges
        # should appear in the links. CL-GO (PARTICIPATES_IN) and CL-UBERON
        # (PART_OF) edges must be excluded.
        result = graph_service.traverse_graph(
            node_ids=["CL/0000061"],
            depth=1,
            edge_direction="OUTBOUND",
            allowed_collections=["CL", "GO", "UBERON"],
            graph="ontologies",
            edge_filters={"Label": ["SUB_CLASS_OF"]},
            include_inter_node_edges=False,
        )
        links = result["CL/0000061"]["links"]
        self.assertGreater(len(links), 0)
        for link in links:
            self.assertEqual(link["Label"], "SUB_CLASS_OF")

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

    def test_traverse_graph_exclude_categorical(self):
        # OUTBOUND from CL/0000061 with SUB_CLASS_OF excluded: the CL-CL SUB_CLASS_OF
        # edge is dropped, the GO/UBERON edges remain.
        result = graph_service.traverse_graph(
            node_ids=["CL/0000061"],
            depth=1,
            edge_direction="OUTBOUND",
            allowed_collections=["CL", "GO", "UBERON"],
            graph="ontologies",
            edge_filters=None,
            exclude_edge_filters={"Label": ["SUB_CLASS_OF"]},
            include_inter_node_edges=False,
        )
        labels = sorted(link["Label"] for link in result["CL/0000061"]["links"])
        self.assertNotIn("SUB_CLASS_OF", labels)
        self.assertIn("PARTICIPATES_IN", labels)

    def test_exclude_categorical_adds_prune_condition(self):
        bind_vars = {}
        pos, neg = graph_service._build_edge_filter_clause(
            None, bind_vars, exclude_filters={"Label": ["SUB_CLASS_OF"]}
        )
        # FILTER keeps non-excluded edges. The excluded value is passed via a
        # bind var (not interpolated into the clause text), so assert on the
        # bind var content rather than searching the generated AQL.
        self.assertTrue(pos)
        self.assertEqual(bind_vars.get("exclude_value_Label"), ["SUB_CLASS_OF"])
        # ...and PRUNE now stops traversal through excluded edges.
        self.assertTrue(neg, "exclude must contribute a PRUNE (negative) condition")

    def test_exclude_numeric_adds_prune_condition(self):
        bind_vars = {}
        pos, neg = graph_service._build_edge_filter_clause(
            None, bind_vars, exclude_filters={"score": {"min": 0.5, "max": 1.0}}
        )
        self.assertTrue(pos)
        self.assertTrue(neg, "numeric exclude must contribute a PRUNE condition")

    def test_build_edge_filter_clause_rejects_unsafe_field_name(self):
        bind_vars = {}
        # A key with a backtick must NOT be interpolated into AQL.
        pos, neg = graph_service._build_edge_filter_clause(
            {"bad`key": ["x"]}, bind_vars
        )
        self.assertEqual(pos, [])
        self.assertEqual(neg, [])
        self.assertEqual(bind_vars, {})

    def test_build_edge_filter_clause_rejects_unsafe_exclude_field_name(self):
        bind_vars = {}
        pos, neg = graph_service._build_edge_filter_clause(
            None, bind_vars, exclude_filters={"bad`key": ["x"]}
        )
        self.assertEqual(pos, [])
        self.assertEqual(neg, [])
        self.assertEqual(bind_vars, {})

    def test_build_edge_filter_clause_rejects_trailing_newline_field_name(self):
        # `$` matches before a trailing newline; the guard must use `\Z` so a
        # key like "Label\n" is not interpolated into AQL.
        bind_vars = {}
        pos, neg = graph_service._build_edge_filter_clause(
            {"Label\n": ["IS_A"]}, bind_vars
        )
        self.assertEqual(pos, [])
        self.assertEqual(neg, [])
        self.assertEqual(bind_vars, {})

    def test_include_categorical_prunes_missing_attribute_edges(self):
        # An include filter must PRUNE every real edge that does not satisfy it,
        # including edges missing the attribute — otherwise traversal walks
        # through a hidden (filtered-out) edge and returns its descendants as
        # orphans. The prune condition negates the include condition (so it is
        # true for a null/absent attribute) but guards on `e != null` so the
        # start vertex at depth 0 (edge is null) is not pruned.
        bind_vars = {}
        pos, neg = graph_service._build_edge_filter_clause(
            {"Label": ["IS_A"]}, bind_vars
        )
        self.assertEqual(len(pos), 1)
        self.assertEqual(len(neg), 1)
        self.assertEqual(neg[0], f"(e != null AND NOT {pos[0]})")

    def test_include_numeric_prunes_missing_attribute_edges(self):
        bind_vars = {}
        pos, neg = graph_service._build_edge_filter_clause(
            {"score": {"min": 0.5, "max": 1.0}}, bind_vars
        )
        self.assertEqual(len(pos), 1)
        self.assertEqual(len(neg), 1)
        self.assertEqual(neg[0], f"(e != null AND NOT {pos[0]})")

    def test_find_inter_node_edges_no_filters(self):
        # Without filters, all edges between the given nodes are returned.
        # CL/0000061 connects to CL/0000151 (SUB_CLASS_OF), GO/0008150
        # (PARTICIPATES_IN), UBERON/0000061 (PART_OF).
        result = graph_service.find_inter_node_edges(
            node_ids=["CL/0000061", "CL/0000151", "GO/0008150", "UBERON/0000061"],
            graph="ontologies",
        )
        self.assertEqual(len(result), 3)

    def test_find_inter_node_edges_categorical_filter(self):
        result = graph_service.find_inter_node_edges(
            node_ids=["CL/0000061", "CL/0000151", "GO/0008150", "UBERON/0000061"],
            graph="ontologies",
            edge_filters={"Label": ["SUB_CLASS_OF"]},
        )
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["Label"], "SUB_CLASS_OF")

    def test_find_inter_node_edges_numeric_filter(self):
        # No edges have a `score` attribute, so range filter excludes all.
        result = graph_service.find_inter_node_edges(
            node_ids=["CL/0000061", "CL/0000151", "GO/0008150", "UBERON/0000061"],
            graph="ontologies",
            edge_filters={"score": {"min": 0.5, "max": 1.0}},
        )
        self.assertEqual(result, [])

    def test_find_inter_node_edges_exclude_categorical(self):
        # Exclude the SUB_CLASS_OF edge; the other two (PARTICIPATES_IN, PART_OF)
        # must remain.
        result = graph_service.find_inter_node_edges(
            node_ids=["CL/0000061", "CL/0000151", "GO/0008150", "UBERON/0000061"],
            graph="ontologies",
            exclude_edge_filters={"Label": ["SUB_CLASS_OF"]},
        )
        labels = sorted(e["Label"] for e in result)
        self.assertEqual(labels, ["PARTICIPATES_IN", "PART_OF"])

    def test_find_inter_node_edges_exclude_empty_is_noop(self):
        result = graph_service.find_inter_node_edges(
            node_ids=["CL/0000061", "CL/0000151", "GO/0008150", "UBERON/0000061"],
            graph="ontologies",
            exclude_edge_filters={"Label": []},
        )
        self.assertEqual(len(result), 3)

    def test_find_inter_node_edges_exclude_numeric(self):
        # No seed edges carry a numeric `score`, so excluding a score range
        # keeps all 3 edges (null-score edges are kept) and must not crash.
        result = graph_service.find_inter_node_edges(
            node_ids=["CL/0000061", "CL/0000151", "GO/0008150", "UBERON/0000061"],
            graph="ontologies",
            exclude_edge_filters={"score": {"min": 0.0, "max": 1.0}},
        )
        self.assertEqual(len(result), 3)

    def test_build_edge_filter_clause_numeric_exclude_generates_condition(self):
        bind_vars = {}
        pos, _ = graph_service._build_edge_filter_clause(
            None, bind_vars, exclude_filters={"score": {"min": 0.5, "max": 1.0}}
        )
        self.assertTrue(any("score" in c for c in pos))
        self.assertIn("exclude_min_score", bind_vars)
        self.assertIn("exclude_max_score", bind_vars)

    def test_traverse_graph_inter_node_edges_respect_filters(self):
        # When traverse_graph's self-call to find_inter_node_edges runs,
        # the filter must propagate. With Label=SUB_CLASS_OF, the post-traversal
        # inter-node scan should respect the filter.
        result = graph_service.traverse_graph(
            node_ids=["CL/0000061"],
            depth=1,
            edge_direction="OUTBOUND",
            allowed_collections=["CL", "GO", "UBERON"],
            graph="ontologies",
            edge_filters={"Label": ["SUB_CLASS_OF"]},
            include_inter_node_edges=True,
        )
        links = result["CL/0000061"]["links"]
        for link in links:
            self.assertEqual(link["Label"], "SUB_CLASS_OF")

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


class SanitizeAllowedCollectionsTestCase(ArangoDBTestCase):
    """allowed_collections must be intersected with the target graph's real
    vertex collections before either injection site in traverse_graph runs.

    ArangoDB's ERR 1926 (ERROR_GRAPH_VERTEX_COL_DOES_NOT_EXIST) aborts the
    whole traversal, with no partial data, the moment `vertexCollections`
    names a collection that is not a member of the graph. The ontologies test
    graph's members are exactly CL, GO, UBERON (seed_test_db.py); CHEBI is a
    real collection in the same database but is not part of the graph, so it
    reproduces ERR 1926 exactly like a stale/renamed collection would.
    """

    def test_mixed_members_and_non_member_returns_member_subgraph(self):
        # CHEBI is dropped; CL/GO/UBERON survive, so the result matches a call
        # made with only the real members -- not a 500, not an unrestricted
        # traversal either.
        with_noise = graph_service.traverse_graph(
            node_ids=["CL/0000061"],
            depth=1,
            edge_direction="OUTBOUND",
            allowed_collections=["CL", "GO", "UBERON", "CHEBI"],
            graph="ontologies",
            edge_filters=None,
            include_inter_node_edges=False,
        )
        clean = graph_service.traverse_graph(
            node_ids=["CL/0000061"],
            depth=1,
            edge_direction="OUTBOUND",
            allowed_collections=["CL", "GO", "UBERON"],
            graph="ontologies",
            edge_filters=None,
            include_inter_node_edges=False,
        )
        with_noise_ids = sorted(n["_id"] for n in with_noise["CL/0000061"]["nodes"])
        clean_ids = sorted(n["_id"] for n in clean["CL/0000061"]["nodes"])
        self.assertEqual(with_noise_ids, clean_ids)
        self.assertGreater(len(with_noise_ids), 0)

    def test_all_non_member_returns_empty_not_everything(self):
        # A request naming only invalid collections must not silently become
        # unrestricted (invariant 2a): [] on the wire already means "no
        # restriction" to ArangoDB, so passing the sanitized-empty list
        # straight through would turn "show me only CHEBI" into "show me
        # everything" -- a worse failure than the 500 it replaces.
        result = graph_service.traverse_graph(
            node_ids=["CL/0000061"],
            depth=1,
            edge_direction="OUTBOUND",
            allowed_collections=["CHEBI"],
            graph="ontologies",
            edge_filters=None,
            include_inter_node_edges=False,
        )
        self.assertEqual(result["CL/0000061"]["nodes"], [])
        self.assertEqual(result["CL/0000061"]["links"], [])

        unrestricted = graph_service.traverse_graph(
            node_ids=["CL/0000061"],
            depth=1,
            edge_direction="OUTBOUND",
            allowed_collections=[],
            graph="ontologies",
            edge_filters=None,
            include_inter_node_edges=False,
        )
        self.assertGreater(len(unrestricted["CL/0000061"]["nodes"]), 0)

    def test_genuinely_empty_input_still_means_unrestricted(self):
        # Empty means "no restriction" already, at the AQL level -- must stay
        # that way; A1 must not touch this case.
        result = graph_service.traverse_graph(
            node_ids=["CL/0000061"],
            depth=1,
            edge_direction="OUTBOUND",
            allowed_collections=[],
            graph="ontologies",
            edge_filters=None,
            include_inter_node_edges=False,
        )
        all_members = graph_service.traverse_graph(
            node_ids=["CL/0000061"],
            depth=1,
            edge_direction="OUTBOUND",
            allowed_collections=["CL", "GO", "UBERON"],
            graph="ontologies",
            edge_filters=None,
            include_inter_node_edges=False,
        )
        result_ids = sorted(n["_id"] for n in result["CL/0000061"]["nodes"])
        all_ids = sorted(n["_id"] for n in all_members["CL/0000061"]["nodes"])
        self.assertEqual(result_ids, all_ids)

    def test_members_pass_through_untouched(self):
        result = graph_service.traverse_graph(
            node_ids=["CL/0000061"],
            depth=1,
            edge_direction="OUTBOUND",
            allowed_collections=["CL", "GO", "UBERON"],
            graph="ontologies",
            edge_filters=None,
            include_inter_node_edges=False,
        )
        self.assertGreater(len(result["CL/0000061"]["nodes"]), 0)

    def test_closing_labels_branch_sanitizes_too(self):
        # The path-aware NAC branch (:321) is a separate, early-returning
        # code path from the default branch (:358); it must be sanitized too,
        # not just the more commonly executed default branch.
        results = graph_service.traverse_graph(
            node_ids=["MONDO/nac_d1", "MONDO/nac_d2", "MONDO/nac_d3"],
            depth=3,
            edge_direction="ANY",
            allowed_collections=["GS", "PR", "CHEMBL", "CHEBI"],
            graph="phenotypes",
            edge_filters={
                "Label": [
                    "DISEASE_HAS_FEATURE",
                    "PRODUCES",
                    "MOLECULARLY_INTERACTS_WITH",
                ]
            },
            include_inter_node_edges=False,
            exclude_closing_edges={"Label": ["IS_SUBSTANCE_THAT_TREATS"]},
        )
        genes = set()
        for data in results.values():
            for node in data["nodes"]:
                if node["_id"].startswith("GS/"):
                    genes.add(node["_id"])
        self.assertIn("GS/nac_g1", genes)

    def test_closing_labels_branch_all_non_member_returns_empty(self):
        results = graph_service.traverse_graph(
            node_ids=["MONDO/nac_d1"],
            depth=3,
            edge_direction="ANY",
            allowed_collections=["CHEBI"],
            graph="phenotypes",
            edge_filters={"Label": ["DISEASE_HAS_FEATURE"]},
            include_inter_node_edges=False,
            exclude_closing_edges={"Label": ["IS_SUBSTANCE_THAT_TREATS"]},
        )
        self.assertEqual(results["MONDO/nac_d1"]["nodes"], [])
        self.assertEqual(results["MONDO/nac_d1"]["links"], [])

    def test_argument_guards_raise_even_when_collections_are_impossible(self):
        """A caller bug must still raise, not be masked by the empty result.

        The impossible-collections path returns an empty traversal, so if it ran
        before the argument guards it would swallow the "cannot set both
        closing-edge filters" ValueError and hand the caller a silent empty
        result instead. The guards therefore run first.
        """
        with self.assertRaises(ValueError):
            graph_service.traverse_graph(
                node_ids=["MONDO/nac_d1"],
                depth=3,
                edge_direction="ANY",
                allowed_collections=["CHEBI"],
                graph="phenotypes",
                edge_filters=None,
                include_inter_node_edges=False,
                exclude_closing_edges={"Label": ["IS_SUBSTANCE_THAT_TREATS"]},
                require_closing_edges={"Label": ["DISEASE_HAS_FEATURE"]},
            )


class SanitizeAllowedCollectionsCacheTestCase(SimpleTestCase):
    """The Gharial membership lookup is cached per graph, like schema_guard's."""

    def setUp(self):
        graph_service.reset_vertex_collections_cache()
        # Also clear on the way out: the mocked membership set is module-level
        # state that would otherwise outlive this class and leak into whatever
        # test runs next.
        self.addCleanup(graph_service.reset_vertex_collections_cache)

    def _patch(self, members=("CL", "GO", "UBERON")):
        fake_graph = mock.MagicMock()
        fake_graph.vertex_collections = mock.Mock(return_value=list(members))
        fake_db = mock.MagicMock()
        fake_db.graph = mock.Mock(return_value=fake_graph)
        return (
            mock.patch.object(
                graph_service, "get_db_and_graph", return_value=(fake_db, "KN-Test")
            ),
            fake_db,
        )

    def test_gharial_hit_on_first_call_only(self):
        patch_db, fake_db = self._patch()
        with patch_db:
            graph_service._get_graph_vertex_collections("ontologies")
            graph_service._get_graph_vertex_collections("ontologies")
            self.assertEqual(fake_db.graph.call_count, 1)

    def test_reset_cache_clears_it(self):
        patch_db, fake_db = self._patch()
        with patch_db:
            graph_service._get_graph_vertex_collections("ontologies")
            graph_service.reset_vertex_collections_cache()
            graph_service._get_graph_vertex_collections("ontologies")
            self.assertEqual(fake_db.graph.call_count, 2)

    def test_fails_open_on_exception(self):
        patch_db, fake_db = self._patch()
        fake_db.graph.side_effect = RuntimeError("gharial unreachable")
        with patch_db:
            self.assertIsNone(graph_service._get_graph_vertex_collections("ontologies"))


class AntiEdgeTraversalTestCase(ArangoDBTestCase):
    """Path-aware anti-edge (NAC) filter on disease->gene->protein->drug paths."""

    def _genes_from_diseases(self, exclude):
        results = graph_service.traverse_graph(
            node_ids=["MONDO/nac_d1", "MONDO/nac_d2", "MONDO/nac_d3"],
            depth=3,
            edge_direction="ANY",
            allowed_collections=["GS", "PR", "CHEMBL"],
            graph="phenotypes",
            edge_filters={
                "Label": [
                    "DISEASE_HAS_FEATURE",
                    "PRODUCES",
                    "MOLECULARLY_INTERACTS_WITH",
                ]
            },
            include_inter_node_edges=False,
            exclude_closing_edges=exclude,
        )
        gene_ids = set()
        for data in results.values():
            for node in data["nodes"]:
                if node["_id"].startswith("GS/"):
                    gene_ids.add(node["_id"])
        return gene_ids

    def test_anti_edge_excludes_only_fully_closed_genes(self):
        genes = self._genes_from_diseases(
            exclude={"Label": ["IS_SUBSTANCE_THAT_TREATS"]}
        )
        self.assertIn("GS/nac_g1", genes)
        self.assertIn("GS/nac_g3", genes)
        self.assertNotIn("GS/nac_g2", genes)

    def test_without_anti_edge_all_genes_present(self):
        genes = self._genes_from_diseases(exclude=None)
        self.assertIn("GS/nac_g1", genes)
        self.assertIn("GS/nac_g2", genes)
        self.assertIn("GS/nac_g3", genes)

    def test_advanced_settings_passes_exclude_closing_edges(self):
        node_ids = ["MONDO/nac_d1", "MONDO/nac_d2", "MONDO/nac_d3"]
        common = {
            "depth": 3,
            "edgeDirection": "ANY",
            "allowedCollections": ["GS", "PR", "CHEMBL"],
            "edgeFilters": {
                "Label": [
                    "DISEASE_HAS_FEATURE",
                    "PRODUCES",
                    "MOLECULARLY_INTERACTS_WITH",
                ]
            },
            "excludeClosingEdges": {"Label": ["IS_SUBSTANCE_THAT_TREATS"]},
        }
        results = graph_service.traverse_graph_advanced(
            node_ids=node_ids,
            advanced_settings={nid: dict(common) for nid in node_ids},
            graph="phenotypes",
            include_inter_node_edges=False,
        )
        genes = set()
        for data in results.values():
            for node in data["nodes"]:
                if node["_id"].startswith("GS/"):
                    genes.add(node["_id"])
        self.assertIn("GS/nac_g1", genes)
        self.assertIn("GS/nac_g3", genes)
        self.assertNotIn("GS/nac_g2", genes)

    def _genes_from_diseases_require(self, require):
        results = graph_service.traverse_graph(
            node_ids=["MONDO/nac_d1", "MONDO/nac_d2", "MONDO/nac_d3"],
            depth=3,
            edge_direction="ANY",
            allowed_collections=["GS", "PR", "CHEMBL"],
            graph="phenotypes",
            edge_filters={
                "Label": [
                    "DISEASE_HAS_FEATURE",
                    "PRODUCES",
                    "MOLECULARLY_INTERACTS_WITH",
                ]
            },
            include_inter_node_edges=False,
            require_closing_edges=require,
        )
        gene_ids = set()
        for data in results.values():
            for node in data["nodes"]:
                if node["_id"].startswith("GS/"):
                    gene_ids.add(node["_id"])
        return gene_ids

    def test_require_closing_keeps_only_fully_closed_genes(self):
        # Positive complement of the anti-edge (the complete / clean dipper):
        # keep only genes whose drug treats the SAME origin disease. g2 closes
        # (dr2 treats d2); g1 has no treat edge; g3's drug treats a DIFFERENT
        # disease (d4, not its own d3), so its loop never closes.
        genes = self._genes_from_diseases_require(
            require={"Label": ["IS_SUBSTANCE_THAT_TREATS"]}
        )
        self.assertIn("GS/nac_g2", genes)
        self.assertNotIn("GS/nac_g1", genes)
        self.assertNotIn("GS/nac_g3", genes)

    def test_both_closing_filters_raises(self):
        # The two path-closing filters cannot compose, so supplying both is a
        # configuration error that fails loudly rather than dropping one.
        with self.assertRaises(ValueError):
            graph_service.traverse_graph(
                node_ids=["MONDO/nac_d1"],
                depth=3,
                edge_direction="ANY",
                allowed_collections=["GS", "PR", "CHEMBL"],
                graph="phenotypes",
                edge_filters={"Label": ["DISEASE_HAS_FEATURE"]},
                include_inter_node_edges=False,
                exclude_closing_edges={"Label": ["IS_SUBSTANCE_THAT_TREATS"]},
                require_closing_edges={"Label": ["IS_SUBSTANCE_THAT_TREATS"]},
            )

    def test_build_edge_filter_clause_custom_field_ref(self):
        bind_vars = {}
        pos, _ = graph_service._build_edge_filter_clause(
            {"Label": ["IS_A"]}, bind_vars, field_ref="CURRENT"
        )
        joined = " ".join(pos)
        self.assertIn("CURRENT.`Label`", joined)
        self.assertNotIn("e.`Label`", joined)
        self.assertIn("filter_value_Label", bind_vars)

    def _genes_from_diseases_exclude(self, exclude_edge_filters):
        # Mirror _genes_from_diseases, but exercise the exclude-mode edge filter
        # inside the closing-edge branch (exclude_closing_edges is set to trigger
        # the path-aware query). The include filter stays permissive (the same
        # three path labels) so the exclude is the only discriminating factor.
        results = graph_service.traverse_graph(
            node_ids=["MONDO/nac_d1", "MONDO/nac_d2", "MONDO/nac_d3"],
            depth=3,
            edge_direction="ANY",
            allowed_collections=["GS", "PR", "CHEMBL"],
            graph="phenotypes",
            edge_filters={
                "Label": [
                    "DISEASE_HAS_FEATURE",
                    "PRODUCES",
                    "MOLECULARLY_INTERACTS_WITH",
                ]
            },
            include_inter_node_edges=False,
            exclude_closing_edges={"Label": ["IS_SUBSTANCE_THAT_TREATS"]},
            exclude_edge_filters=exclude_edge_filters,
        )
        gene_ids = set()
        for data in results.values():
            for node in data["nodes"]:
                if node["_id"].startswith("GS/"):
                    gene_ids.add(node["_id"])
        return gene_ids

    def test_closing_branch_applies_exclude_edge_filter(self):
        # DISEASE_HAS_FEATURE is the disease->gene edge on EVERY gene
        # path (nac_b1, nac_c1, nac_x1), so excluding it means every path has an
        # excluded edge and no gene survives. Before the closing-edge branch
        # applied exclude filters this returned {g1, g3} (exclude ignored); now
        # it is empty.
        genes = self._genes_from_diseases_exclude(
            exclude_edge_filters={"Label": ["DISEASE_HAS_FEATURE"]}
        )
        self.assertEqual(genes, set())

    def test_closing_branch_exclude_unrelated_label_is_noop(self):
        # Excluding a label that appears on no path edge is a no-op, so the
        # result matches the baseline anti-edge set {g1, g3}: the exclude filter
        # neither drops extra paths nor errors on unused bind parameters.
        genes = self._genes_from_diseases_exclude(
            exclude_edge_filters={"Label": ["NONEXISTENT_LABEL"]}
        )
        self.assertIn("GS/nac_g1", genes)
        self.assertIn("GS/nac_g3", genes)
        self.assertNotIn("GS/nac_g2", genes)

    def test_closing_query_prunes_and_looks_up_closers_once_per_origin(self):
        # A scan over thousands of diseases spends most of its time expanding
        # paths through edges the filter rejects anyway, and re-querying the
        # endpoint's edges for every surviving path. The query must prune
        # off-filter edges during the walk and find each origin's closing
        # neighbours once, before the path loop.
        db, graph_name = graph_service.get_db_and_graph("phenotypes")
        queries = []

        def record(query, **kwargs):
            queries.append(query)
            return db.aql.execute(query, **kwargs)

        spy = mock.MagicMock()
        spy.aql.execute.side_effect = record
        with mock.patch.object(
            graph_service, "get_db_and_graph", return_value=(spy, graph_name)
        ):
            self._genes_from_diseases(exclude={"Label": ["IS_SUBSTANCE_THAT_TREATS"]})

        query = queries[0]
        self.assertIn("PRUNE", query)
        self.assertLess(query.index("@closing_labels"), query.index("@depth..@depth"))


class ConnectingPathsTestCase(ArangoDBTestCase):
    """Tests for find_connecting_paths edge filtering.

    Seed shape used here (all OUTBOUND from CL/0000061):
      CL/0000061 -SUB_CLASS_OF->   CL/0000151, CL/0000062, CL/0007002
      CL/0000061 -PARTICIPATES_IN-> GO/0008150

    So CL/0000151 <-> GO/0008150 is connected only by a mixed-label path,
    while CL/0000151 <-> CL/0000062 is connected by a pure SUB_CLASS_OF path.
    """

    MIXED_PAIR = ["CL/0000151", "GO/0008150"]
    SUB_CLASS_PAIR = ["CL/0000151", "CL/0000062"]

    def _labels(self, result):
        return sorted({link["Label"] for link in result["links"]})

    def test_no_filter_returns_mixed_label_path(self):
        # Baseline: without filters the mixed path is found.
        result = graph_service.find_connecting_paths(
            node_ids=self.MIXED_PAIR, graph="ontologies"
        )
        self.assertGreater(len(result["links"]), 0)
        self.assertIn("PARTICIPATES_IN", self._labels(result))

    def test_non_member_collection_does_not_abort_the_query(self):
        """CHEBI is a real collection but not a member of the ontologies graph.

        The max_depth branch feeds allowed_collections to `vertexCollections`,
        where a non-member aborts the whole query with ERR 1926. Sanitizing
        drops it so the member subgraph still comes back.
        """
        result = graph_service.find_connecting_paths(
            node_ids=self.SUB_CLASS_PAIR,
            graph="ontologies",
            allowed_collections=["CL", "CHEBI"],
            max_depth=3,
        )
        self.assertGreater(len(result["links"]), 0)

    def test_all_non_member_collections_return_empty_not_everything(self):
        """An impossible list must not widen into an unrestricted query.

        `vertexCollections: []` means "no restriction" to ArangoDB, so
        collapsing a fully-dropped list to `[]` would return every path
        instead of none.
        """
        result = graph_service.find_connecting_paths(
            node_ids=self.SUB_CLASS_PAIR,
            graph="ontologies",
            allowed_collections=["CHEBI"],
            max_depth=3,
        )
        self.assertEqual(result["nodes"], [])
        self.assertEqual(result["links"], [])

    def test_include_filter_drops_path_with_violating_edge(self):
        # Regression guard for the silently-ignored filter: a path is kept only
        # if EVERY edge satisfies the filter. The PARTICIPATES_IN edge violates
        # it, so the whole path is dropped rather than partially returned.
        result = graph_service.find_connecting_paths(
            node_ids=self.MIXED_PAIR,
            graph="ontologies",
            edge_filters={"Label": ["SUB_CLASS_OF"]},
        )
        self.assertEqual(result["links"], [])

    def test_include_filter_keeps_conforming_path(self):
        # The same filter must not drop a path whose edges all conform.
        result = graph_service.find_connecting_paths(
            node_ids=self.SUB_CLASS_PAIR,
            graph="ontologies",
            edge_filters={"Label": ["SUB_CLASS_OF"]},
        )
        self.assertGreater(len(result["links"]), 0)
        self.assertEqual(self._labels(result), ["SUB_CLASS_OF"])

    def test_exclude_filter_drops_path_containing_excluded_edge(self):
        result = graph_service.find_connecting_paths(
            node_ids=self.SUB_CLASS_PAIR,
            graph="ontologies",
            exclude_edge_filters={"Label": ["SUB_CLASS_OF"]},
        )
        self.assertEqual(result["links"], [])

    def test_filters_apply_on_the_max_depth_branch(self):
        # max_depth switches to the traversal query; the filter must apply there
        # too, not just on the K_SHORTEST_PATHS fallback.
        unfiltered = graph_service.find_connecting_paths(
            node_ids=self.MIXED_PAIR, graph="ontologies", max_depth=3
        )
        self.assertGreater(len(unfiltered["links"]), 0)

        filtered = graph_service.find_connecting_paths(
            node_ids=self.MIXED_PAIR,
            graph="ontologies",
            max_depth=3,
            edge_filters={"Label": ["SUB_CLASS_OF"]},
        )
        self.assertEqual(filtered["links"], [])

    def test_exclude_filter_applies_on_the_max_depth_branch(self):
        # Exclusion builds a different predicate shape than inclusion, so the
        # traversal branch needs its own guard: GO/0008150 is only reachable
        # across the PARTICIPATES_IN edge, so excluding it drops every path.
        result = graph_service.find_connecting_paths(
            node_ids=self.MIXED_PAIR,
            graph="ontologies",
            max_depth=3,
            exclude_edge_filters={"Label": ["PARTICIPATES_IN"]},
        )
        self.assertEqual(result["links"], [])


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
        # With Label=SUB_CLASS_OF filter, only the CL-CL SUB_CLASS_OF edge survives.
        merged = {"nodes": self._nodes_with_links(), "links": []}
        result = _find_post_merge_inter_node_edges(
            merged, "ontologies", edge_filters={"Label": ["SUB_CLASS_OF"]}
        )
        self.assertEqual(len(result["links"]), 1)
        self.assertEqual(result["links"][0]["Label"], "SUB_CLASS_OF")

    def test_combine_phase_inter_node_edges_respect_filters(self):
        # Two phases that each return one node, and the combine phase scans
        # for inter-node edges between them. With Label=SUB_CLASS_OF, only
        # CL-CL/SUB_CLASS_OF edges should appear, not the CL-GO PARTICIPATES_IN.
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
                    "edgeFilters": {"Label": ["SUB_CLASS_OF"]},
                },
            },
        ]
        result = workflow_service.execute_workflow(phases, graph="ontologies")
        combine_links = result["phases"]["combine"]["links"]
        # The CL/0000061 -> GO/0008150 PARTICIPATES_IN edge would normally be
        # included by the combine post-merge scan, but the filter excludes it.
        for link in combine_links:
            self.assertEqual(link["Label"], "SUB_CLASS_OF")


class DropNullNodesTestCase(TestCase):
    """Unit tests for _drop_null_nodes (no DB required).

    Dangling edges in the graph cause ArangoDB traversals to return ``None``
    vertices, which previously crashed downstream phase processing.
    """

    def test_removes_none_and_idless_entries(self):
        result = {
            "nodes": [None, {"_id": "CL/1"}, {"no_id": True}, {"_id": "CS/2"}],
            "links": [None, {"_id": "CL-CL/1", "_from": "CL/1", "_to": "CL/1"}],
        }
        cleaned = _drop_null_nodes(result)
        self.assertEqual(cleaned["nodes"], [{"_id": "CL/1"}, {"_id": "CS/2"}])
        self.assertEqual(
            cleaned["links"], [{"_id": "CL-CL/1", "_from": "CL/1", "_to": "CL/1"}]
        )

    def test_non_dict_passthrough(self):
        self.assertIsNone(_drop_null_nodes(None))


class SearchServiceTestCase(ArangoDBTestCase):
    """Tests for search_service functions."""

    def test_get_all_documents(self):
        result = search_service.get_all_documents()
        self.assertGreater(len(result), 0)

    def test_run_aql_query(self):
        result = search_service.run_aql_query("RETURN 1 + 1")
        self.assertEqual(result, 2)


class ConnectingPathsUnboundedCollectionsTestCase(SimpleTestCase):
    """The unbounded K_SHORTEST_PATHS branch of find_connecting_paths.

    That branch cannot bind `vertexCollections` -- IS_SAME_COLLECTION takes a
    string literal -- so it quotes each name instead. These tests pin the
    quoting and the sanitize behaviour there, since the integration tests above
    only exercise the max_depth branch.
    """

    def setUp(self):
        graph_service.reset_vertex_collections_cache()
        self.addCleanup(graph_service.reset_vertex_collections_cache)

    def _run(self, allowed_collections, members=("CL", "GO", "UBERON")):
        """Call find_connecting_paths with max_depth=None and the DB mocked.

        Returns the AQL query string, or None if no query was issued.
        """
        cursor = mock.Mock()
        cursor.next.return_value = {"nodes": [], "links": []}
        db_connection = mock.Mock()
        db_connection.aql.execute.return_value = cursor
        fake_graph = mock.MagicMock()
        fake_graph.vertex_collections = mock.Mock(return_value=list(members))
        db_connection.graph = mock.Mock(return_value=fake_graph)

        with mock.patch.object(
            graph_service,
            "get_db_and_graph",
            return_value=(db_connection, "ontologies"),
        ):
            graph_service.find_connecting_paths(
                node_ids=["CL/a", "CL/b"],
                graph="ontologies",
                allowed_collections=allowed_collections,
                max_depth=None,
            )

        if not db_connection.aql.execute.call_args:
            return None
        return db_connection.aql.execute.call_args[0][0]

    def test_member_names_are_quoted_literals(self):
        query = self._run(["CL"])
        self.assertIn('IS_SAME_COLLECTION("CL", CURRENT)', query)

    def test_non_member_is_dropped_but_members_still_filter(self):
        query = self._run(["CL", "CHEBI"])
        self.assertIn('IS_SAME_COLLECTION("CL", CURRENT)', query)
        self.assertNotIn("CHEBI", query)

    def test_all_non_member_issues_no_query_at_all(self):
        # Sanitizing to empty must not fall through to an unfiltered query --
        # that would widen "only CHEBI" into every path in the graph.
        self.assertIsNone(self._run(["CHEBI"]))

    def test_unusual_but_valid_name_is_quoted_not_dropped(self):
        """A member whose name is not a bare identifier must survive.

        Dropping it would remove the collection filter entirely when it is the
        only allowed collection, widening the query -- the failure this step
        exists to prevent. Quoting keeps it, escaped.
        """
        odd = 'we"ird'
        query = self._run([odd], members=(odd, "CL"))
        self.assertIn(r'IS_SAME_COLLECTION("we\"ird", CURRENT)', query)


class SearchByTermQueryTestCase(TestCase):
    """Unit tests for search_by_term query construction (no DB required)."""

    def _run(self, search_fields, term="cell"):
        """Invoke search_by_term with the DB layer mocked out.

        Returns the (query, bind_vars) passed to aql.execute.
        """
        db_connection = mock.Mock()
        db_connection.aql.execute.return_value = iter([])

        with mock.patch.object(
            search_service, "get_db_and_graph", return_value=(db_connection, None)
        ):
            search_service.search_by_term(term, search_fields, "ontologies")

        _, kwargs = db_connection.aql.execute.call_args
        return db_connection.aql.execute.call_args[0][0], kwargs["bind_vars"]

    def test_query_applies_limit_as_bind_var(self):
        query, bind_vars = self._run(["label"])
        # LIMIT must come after the SORT and use a bind var, not an interpolated
        # number, so the relevance ranking is preserved while capping output.
        self.assertIn("LIMIT @limit", query)
        self.assertEqual(bind_vars["limit"], search_service.SEARCH_RESULT_LIMIT)
        self.assertRegex(query, r"SORT BM25\(doc\) DESC\s+LIMIT @limit")

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

    def test_query_projects_badge_fields(self):
        # A search row shows the same badges as everywhere else, so the fields
        # getBadges() reads must survive the projection (nlm-ckn#301).
        _, bind_vars = self._run(["label"])
        self.assertIn("is_reference_dataset", search_service.BADGE_FIELDS)
        # The tooltip names the structure even when it is not a searched field.
        self.assertIn("anatomical_structure", search_service.BADGE_FIELDS)
        for field in search_service.BADGE_FIELDS:
            self.assertIn(field, bind_vars["projection_fields"])

    def test_ranking_is_bm25_alone(self):
        query, _ = self._run(["label"])
        # One sort, so the view can stop at the limit (constrained sort); the
        # boosts decide the order.
        self.assertEqual(query.count("SORT "), 1)
        self.assertNotIn("is_exact_match", query)
        self.assertNotIn("sortedDocs", query)
        self.assertIn("LEVENSHTEIN_MATCH", query)
        self.assertIn('"n-gram"', query)

    def test_projection_does_not_exclude_matches_on_non_label_fields(self):
        # Regression guard for the concern that the projection might drop docs
        # that matched on a field which is not one of the getLabel() label
        # fields. A doc matching on any searched field must still be returned.
        #
        # "title" / "journal" (PUB) are searchable but NOT in LABEL_FIELDS.
        non_label_fields = ["title", "journal"]
        for field in non_label_fields:
            self.assertNotIn(field, search_service.LABEL_FIELDS)

        query, bind_vars = self._run(non_label_fields)
        projection = bind_vars["projection_fields"]

        # 1. The matched field's VALUE is preserved: every searched field is in
        #    the KEEP projection (projection = search_fields | LABEL_FIELDS), so
        #    a doc matched via "title" comes back with its title populated.
        for field in non_label_fields:
            self.assertIn(field, projection)

        # 2. The ROW is never filtered out: the projection lives in the RETURN
        #    (after LIMIT) as MERGE(_id, KEEP(...)), and there is no FILTER that
        #    could drop a matched doc based on which fields it has. KEEP only
        #    reshapes each row, it cannot remove rows.
        self.assertNotIn("FILTER", query)
        return_idx = query.index("RETURN MERGE(")
        self.assertLess(query.index("LIMIT @limit"), return_idx)

        # 3. Even if a doc has ONLY the matched non-label field, _id is still
        #    returned because it is merged in independently of KEEP.
        self.assertIn('MERGE({"_id": doc._id}', query)


class SearchByTermIdentifierTestCase(TestCase):
    """The `_search` identifier clause (#195)."""

    _run = SearchByTermQueryTestCase._run

    def test_identifier_clause_matches_whole_value_with_norm_lower(self):
        query, _ = self._run(["label"])
        self.assertIn('FIRST(TOKENS(@search_term, "norm-lower"))', query)
        # Boosted above a whole-value field match, so the node outranks cell
        # sets that store the same CURIE in ontology_purl.
        boost = search_service.IDENTIFIER_BOOST
        self.assertGreater(boost, search_service.WHOLE_VALUE_BOOST)
        self.assertIn(
            f'BOOST(ANALYZER(doc.`_search` == norm_term, "norm-lower"), {boost})',
            query,
        )

    def test_identifier_only_request_builds_a_valid_search(self):
        query, bind_vars = self._run(["_search"])
        search = query[query.index("SEARCH") : query.index("SORT")]
        self.assertNotIn("LEVENSHTEIN_MATCH", search)
        self.assertNotIn("n-gram", search)
        self.assertNotRegex(search, r"\bOR\s*$")
        self.assertNotIn("_search", bind_vars["projection_fields"])

    def test_client_supplied_search_field_gets_no_per_field_clause(self):
        query, bind_vars = self._run(["label", "_search"])
        self.assertNotIn("LEVENSHTEIN_MATCH(doc.`_search`", query)
        self.assertNotIn("doc.`_search` LIKE", query)
        self.assertNotIn("LOWER(doc.`_search`)", query)
        self.assertNotIn("_search", bind_vars["projection_fields"])


class SearchByTermTierTestCase(TestCase):
    """Only tiered fields get per-field SEARCH clauses (#345, U8)."""

    _run = SearchByTermQueryTestCase._run

    def test_untiered_field_is_projected_but_not_searched(self):
        query, bind_vars = self._run(["label", "year"])
        self.assertIn("LEVENSHTEIN_MATCH(doc.`label`", query)
        self.assertNotIn("doc.`year`", query)
        self.assertIn("year", bind_vars["projection_fields"])

    def test_only_untiered_fields_search_identifiers_alone(self):
        query, bind_vars = self._run(["year"])
        search = query[query.index("SEARCH") : query.index("SORT")]
        self.assertNotIn("LEVENSHTEIN_MATCH", search)
        self.assertNotIn("n-gram", search)
        self.assertIn("doc.`_search` == norm_term", search)
        labels = set(search_service.LABEL_FIELDS) | set(search_service.BADGE_FIELDS)
        self.assertEqual(bind_vars["projection_fields"], sorted({"year"} | labels))


class SearchByTermRankingTestCase(TestCase):
    """The tiered ranking clauses (#345, U10)."""

    _run = SearchByTermQueryTestCase._run

    def _search(self, fields, term):
        query, bind_vars = self._run(fields, term)
        return query[query.index("SEARCH") : query.index("SORT")], bind_vars

    def test_term_reaches_the_query_only_as_bind_variables(self):
        query, bind_vars = self._run(["label"], r"zq% x_\ ")
        self.assertNotIn("zq", query)
        self.assertEqual(bind_vars["search_term"], r"zq% x_\ ".strip())
        self.assertEqual(bind_vars["raw_like_term"], r"zq\% x\_\\")

    def test_whitespace_is_collapsed_before_matching(self):
        _, bind_vars = self._run(["label"], "  T   cell ")
        self.assertEqual(bind_vars["search_term"], "T cell")

    def test_clauses_follow_the_term_length(self):
        """Prefix matching starts at 3 characters, fuzzy and substring at 4."""
        fields = ["label", "hasDbXref"]
        for term, prefix, fuzzy in (
            ("a", False, False),
            ("abc", True, False),
            ("abcd", True, True),
        ):
            with self.subTest(term):
                search, _ = self._search(fields, term)
                self.assertEqual("LIKE CONCAT(like_term" in search, prefix)
                self.assertEqual("lower_term, 1)" in search, fuzzy)
                self.assertEqual('LIKE CONCAT("%", like_term' in search, fuzzy)
                self.assertIn("lower_term, 0)", search)
                self.assertIn("doc.`label` == norm_term", search)

    def test_each_tier_gets_only_its_own_clauses(self):
        fields = ["label", "hasExactSynonym", "hasDbXref", "definition"]
        search, _ = self._search(fields, "cell type")
        self.assertIn("LEVENSHTEIN_MATCH(doc.`hasExactSynonym`", search)
        self.assertNotIn("LEVENSHTEIN_MATCH(doc.`hasDbXref`", search)
        self.assertNotIn("LEVENSHTEIN_MATCH(doc.`definition`", search)
        self.assertNotIn("doc.`hasExactSynonym` LIKE CONCAT(like_term", search)
        self.assertIn('doc.`definition` == lower_term, "text_en")', search)
        self.assertNotIn("doc.`definition` == norm_term", search)

    def test_a_tier_with_no_requested_fields_adds_no_empty_group(self):
        search, _ = self._search(["definition"], "marrow cell")
        self.assertNotIn("LEVENSHTEIN_MATCH", search)
        self.assertNotRegex(search, r"doc\.`(?!_search`)\w+` == norm_term")
        self.assertNotRegex(search, r"\(\s*OR|OR\s*\)|ANALYZER\(\s*,")

    def test_ngram_clause_covers_tiered_fields_only(self):
        search, _ = self._search(["label", "year"], "cell")
        self.assertIn('doc.`label` LIKE CONCAT("%", @raw_like_term, "%")', search)
        self.assertNotIn("doc.`year`", search)

    def test_normalized_clauses_do_not_use_lower(self):
        """norm-lower and wildcard-lower clauses use the analyzer-normalized term."""
        search, _ = self._search(["label", "hasDbXref"], "café")
        clauses = re.findall(
            r'ANALYZER\(((?:(?!ANALYZER\().)*?), "(?:norm|wildcard)-lower"\)', search
        )
        self.assertGreaterEqual(len(clauses), 3)
        for clause in clauses:
            self.assertNotIn("lower_term", clause)
            self.assertNotIn("LOWER(", clause)

    def test_no_boost_is_zero(self):
        """Every *_BOOST constant is positive."""
        # ArangoDB scores a zero boost as if unboosted (arangodb#23375).
        for name in dir(search_service):
            if name.endswith("_BOOST"):
                self.assertGreater(getattr(search_service, name), 0, name)


class MatchReasonTestCase(SimpleTestCase):
    """match_reason names the field and value a result matched on (#345, U9)."""

    def _reason(self, doc, term, searched=None):
        searched = searched or [f for f in doc if f != "_id"]
        return search_service.match_reason(doc, term, searched)

    def test_only_searched_fields_are_a_reason(self):
        # label is projected for display but was not searched here.
        doc = {"_id": "CL/0000084", "label": "T cell", "hasExactSynonym": "T-cell"}
        self.assertEqual(
            self._reason(doc, "t", ["hasExactSynonym"]),
            {"tier": "synonym", "field": "hasExactSynonym", "value": "T-cell"},
        )

    def test_label_equal_ignores_case_and_extra_whitespace(self):
        doc = {"_id": "CL/0000084", "label": "T cell"}
        self.assertEqual(
            self._reason(doc, "  t CELL "),
            {"tier": "label", "field": "label", "value": "T cell"},
        )

    def test_accents_are_ignored_like_the_norm_lower_analyzer(self):
        doc = {"_id": "CL/1", "label": "Café cell"}
        self.assertEqual(
            self._reason(doc, "cafe cell"),
            {"tier": "label", "field": "label", "value": "Café cell"},
        )

    def test_equal_synonym_beats_a_label_that_only_contains(self):
        doc = {
            "_id": "CL/0000084",
            "label": "T lymphocyte subset",
            "hasExactSynonym": "T lymphocyte",
        }
        self.assertEqual(
            self._reason(doc, "t lymphocyte"),
            {"tier": "synonym", "field": "hasExactSynonym", "value": "T lymphocyte"},
        )

    def test_synonym_list_returns_the_matching_element(self):
        doc = {
            "_id": "CL/0000084",
            "hasExactSynonym": ["T-cell", "T lymphocyte", "thymus-derived cell"],
        }
        self.assertEqual(
            self._reason(doc, "t LYMPHOCYTE"),
            {"tier": "synonym", "field": "hasExactSynonym", "value": "T lymphocyte"},
        )

    def test_identifier_field_that_contains_the_term(self):
        doc = {"_id": "CL/0000084", "hasDbXref": ["FMA:9825", "BTO:0000782"]}
        self.assertEqual(
            self._reason(doc, "fma:98"),
            {"tier": "identifier", "field": "hasDbXref", "value": "FMA:9825"},
        )

    def test_identifier_found_by_the_query_is_returned_in_stored_form(self):
        doc = {"_id": "CL/0000084", "_search_match": "CL:0000084"}
        self.assertEqual(
            self._reason(doc, "cl:0000084"),
            {"tier": "identifier", "field": "_search", "value": "CL:0000084"},
        )

    def test_text_tier_and_unmatched_documents_give_no_reason(self):
        doc = {
            "_id": "CL/0000084",
            "label": "T cell",
            "definition": "A bone marrow cell",
        }
        self.assertIsNone(self._reason(doc, "marrow"))
        self.assertIsNone(self._reason(doc, "neuron"))

    def test_tier_depends_on_the_collection(self):
        # dataset_name is a label on CSD but untiered on CS.
        fields = {"dataset_name": "Lung atlas"}
        self.assertIsNone(self._reason({"_id": "CS/1", **fields}, "lung atlas"))
        self.assertEqual(
            self._reason({"_id": "CSD/1", **fields}, "lung atlas"),
            {"tier": "label", "field": "dataset_name", "value": "Lung atlas"},
        )


class SearchByTermMatchTestCase(TestCase):
    """search_by_term attaches `_match` (#345, U9)."""

    _run = SearchByTermQueryTestCase._run

    def test_search_match_is_computed_after_the_limit(self):
        query, _ = self._run(["label"])
        self.assertIn("SORT BM25(doc) DESC\n", query)
        self.assertGreater(
            query.index('"_search_match": NTH(doc.`_search`'),
            query.index("LIMIT @limit"),
        )
        # Stored forms are normalized like the search clause, not by LOWER().
        self.assertIn(
            'doc.`_search`[* RETURN FIRST(TOKENS(CURRENT, "norm-lower"))], '
            "norm_term, true))",
            " ".join(query.split()),
        )

    def test_rows_carry_match_and_drop_search_match(self):
        """Each row gets `_match`; the internal `_search_match` is removed."""
        db_connection = mock.Mock()
        db_connection.aql.execute.return_value = iter(
            [
                {"_id": "CL/0000084", "label": "T cell", "_search_match": "CL:0000084"},
                {"_id": "CL/0000624", "label": "CD4-positive T cell"},
                {"_id": "CL/0000000", "definition": "unrelated"},
            ]
        )
        with mock.patch.object(
            search_service, "get_db_and_graph", return_value=(db_connection, None)
        ):
            rows = search_service.search_by_term("cl:0000084", ["label"], "ontologies")
        self.assertEqual(
            [r["_match"] for r in rows],
            [
                {"tier": "identifier", "field": "_search", "value": "CL:0000084"},
                None,
                None,
            ],
        )
        self.assertNotIn("_search_match", rows[0])


class SearchByTermErrorTestCase(SimpleTestCase):
    """search_by_term must tell a failed query apart from no matches."""

    def _search(self, side_effect):
        db_connection = mock.Mock()
        db_connection.aql.execute.side_effect = side_effect
        with mock.patch.object(
            search_service, "get_db_and_graph", return_value=(db_connection, None)
        ):
            return search_service.search_by_term("cell", ["label"], "ontologies")

    def _assert_raises(self, error, unavailable):
        with self.assertLogs(search_service.logger, "ERROR"):
            with self.assertRaises(search_service.SearchServiceError) as ctx:
                self._search(error)
        self.assertIs(ctx.exception.unavailable, unavailable)
        self.assertIs(ctx.exception.__cause__, error)

    def test_no_matches_returns_empty_list(self):
        self.assertEqual(self._search([iter([])]), [])

    def test_unreachable_database_is_unavailable(self):
        import requests

        from arango_api.circuit_breaker import CircuitBreakerOpen

        for error in (
            CircuitBreakerOpen("open"),
            requests.exceptions.ConnectionError("refused"),
            requests.exceptions.Timeout("slow"),
            ConnectionAbortedError("aborted"),
        ):
            with self.subTest(type(error).__name__):
                self._assert_raises(error, unavailable=True)

    def test_failed_query_is_not_unavailable(self):
        from arango.exceptions import AQLQueryExecuteError

        for error in (
            AQLQueryExecuteError(mock.Mock(), mock.Mock()),
            ValueError("bad"),
        ):
            with self.subTest(type(error).__name__):
                self._assert_raises(error, unavailable=False)


class TerminalCollectionsQueryTestCase(TestCase):
    """Unit tests for terminal-collection pruning (no DB required)."""

    def setUp(self):
        # traverse_graph sanitizes allowed_collections against a module-level
        # cache of real graph membership. An integration test earlier in the run
        # populates that cache, and a populated cache short-circuits the lookup
        # entirely -- so the DB mock below is bypassed and the real membership
        # set silently prunes these collections, failing the assertions here for
        # a reason that has nothing to do with terminal collections.
        #
        # That made the suite order-dependent: green when unit and integration
        # run separately (as CI does), red when run together (as a developer
        # does). Reset around each test so this class is isolated either way.
        graph_service.reset_vertex_collections_cache()
        self.addCleanup(graph_service.reset_vertex_collections_cache)

    def _run(self, **kwargs):
        """Invoke traverse_graph with the DB layer mocked out.

        Returns the (query, bind_vars) passed to aql.execute.
        """
        db_connection = mock.Mock()
        db_connection.aql.execute.return_value = iter([])

        params = {
            "node_ids": ["GS/GUCY1A2"],
            "depth": 3,
            "edge_direction": "ANY",
            "allowed_collections": ["BGS", "CS", "UBERON", "CSD"],
            "graph": "phenotypes",
            "edge_filters": None,
            "include_inter_node_edges": False,
        }
        params.update(kwargs)

        with mock.patch.object(
            graph_service,
            "get_db_and_graph",
            return_value=(db_connection, "KN-Phenotypes"),
        ):
            graph_service.traverse_graph(**params)

        args, kwargs_ = db_connection.aql.execute.call_args
        return args[0], kwargs_["bind_vars"]

    def test_terminal_collections_emit_prune_on_vertex_collection(self):
        query, bind_vars = self._run(terminal_collections=["UBERON", "CSD"])
        # PRUNE stops descent past the vertex but still returns it, which is the
        # whole point: the organ shows up, its 800 sibling cell sets do not.
        self.assertIn("PRUNE", query)
        self.assertIn("PARSE_COLLECTION(v._id) IN @terminal_collections", query)
        # Value travels as a bind var, never interpolated into query text.
        self.assertEqual(bind_vars.get("terminal_collections"), ["UBERON", "CSD"])
        self.assertNotIn("UBERON", query)

    def test_no_terminal_collections_emits_no_prune(self):
        query, bind_vars = self._run()
        self.assertNotIn("PRUNE", query)
        self.assertNotIn("terminal_collections", bind_vars)

    def test_empty_terminal_collections_emits_no_prune(self):
        query, bind_vars = self._run(terminal_collections=[])
        self.assertNotIn("PRUNE", query)
        self.assertNotIn("terminal_collections", bind_vars)

    def test_terminal_collections_or_compose_with_exclude_filters(self):
        # An exclude filter already contributes a PRUNE condition. Terminal
        # pruning must OR into it, not replace it -- otherwise turning on one
        # feature silently disables the other.
        query, bind_vars = self._run(
            exclude_edge_filters={"Label": ["DERIVES_FROM"]},
            terminal_collections=["UBERON"],
        )
        self.assertIn("PRUNE", query)
        self.assertIn("PARSE_COLLECTION(v._id) IN @terminal_collections", query)
        self.assertEqual(bind_vars.get("exclude_value_Label"), ["DERIVES_FROM"])
        prune_line = next(line for line in query.splitlines() if "PRUNE" in line)
        self.assertIn(" OR ", prune_line)

    def test_terminal_collection_not_in_allowed_is_accepted_unchanged(self):
        # A name outside allowed_collections is accepted rather than rejected or
        # filtered out: the collection is never visited, so the condition can
        # never match and the setting is inert at query time. What is asserted
        # here is that the value reaches AQL verbatim and the query is otherwise
        # identical to the same call with no terminal collections at all, apart
        # from the added PRUNE.
        query, bind_vars = self._run(terminal_collections=["MONDO"])
        self.assertIn("PRUNE", query)
        self.assertEqual(bind_vars.get("terminal_collections"), ["MONDO"])
        # allowed_collections is untouched -- the unmatched name is not injected
        # into the visited set, and nothing is dropped from it either.
        self.assertEqual(
            bind_vars["allowed_collections"], ["BGS", "CS", "UBERON", "CSD"]
        )
        baseline_query, baseline_binds = self._run()
        prune_line = next(line for line in query.splitlines() if "PRUNE" in line)
        self.assertEqual(
            query.replace(prune_line, "").split(),
            baseline_query.split(),
        )
        self.assertEqual(
            {k: v for k, v in bind_vars.items() if k != "terminal_collections"},
            baseline_binds,
        )

    def test_terminal_prune_is_guarded_against_the_start_vertex(self):
        # ArangoDB evaluates PRUNE at depth 0 too, where v is the start vertex
        # and e is null, even with a 1..@depth range. An unguarded condition
        # therefore prunes the origin itself and the traversal returns nothing:
        # measured, origin UBERON/0000004 with terminal ["UBERON"] at depth 1
        # returned 0 vertices unguarded and 69 with the guard. The `e != null`
        # conjunct is what exempts the origin, so pin it to the condition.
        query, _ = self._run(terminal_collections=["UBERON"])
        self.assertIn(
            "(e != null AND PARSE_COLLECTION(v._id) IN @terminal_collections)",
            query,
        )
        # And it must be part of the terminal disjunct itself, not a stray
        # condition elsewhere that an OR could bypass.
        prune_line = next(line for line in query.splitlines() if "PRUNE" in line)
        self.assertNotIn(
            "OR PARSE_COLLECTION(v._id) IN @terminal_collections", prune_line
        )
        self.assertTrue(prune_line.strip().startswith("PRUNE (e != null AND"))

    def test_empty_closing_edge_filter_does_not_block_terminal_collections(self):
        # The Workflow Builder and the presets always emit {"Label": []} for a
        # phase with no closing-edge filter. That is a truthy dict, so guarding
        # on the raw dict would raise here.
        query, bind_vars = self._run(
            terminal_collections=["UBERON"],
            exclude_closing_edges={"Label": []},
            require_closing_edges={"Label": []},
        )
        self.assertIn("PARSE_COLLECTION(v._id) IN @terminal_collections", query)
        self.assertEqual(bind_vars.get("terminal_collections"), ["UBERON"])

    def test_terminal_collections_rejected_with_closing_edge_filters(self):
        # The closing-edge branch needs complete fixed-depth paths for its
        # endpoint check, so it cannot stop at a terminal vertex.
        with self.assertRaises(ValueError):
            self._run(
                terminal_collections=["UBERON"],
                require_closing_edges={"Label": ["IS_SUBSTANCE_THAT_TREATS"]},
            )
        with self.assertRaises(ValueError):
            self._run(
                terminal_collections=["UBERON"],
                exclude_closing_edges={"Label": ["IS_SUBSTANCE_THAT_TREATS"]},
            )


class GetCollectionsExclusionTestCase(TestCase):
    """`get_collections` must not offer non-graph collections to the UI.

    The frontend seeds `allowedCollections` with whatever this returns, and
    that list is passed straight to AQL's `OPTIONS { vertexCollections: ... }`.
    A collection that is not a vertex collection of the named graph makes
    ArangoDB reject the whole traversal with ERR 1926, which surfaced as
    "Failed to fetch data." on every document page whose collection has no
    entry in collection-defaults.json (BGS, GO, PATO, CHEMBL, HP, ...).
    """

    def _collections(self, collection_type="document"):
        db = mock.Mock()
        db.collections.return_value = [
            {"name": "CL", "type": "document"},
            {"name": "ckn_meta", "type": "document"},
            {"name": "_system_thing", "type": "document"},
            {"name": "CL-CL", "type": "edge"},
        ]
        with mock.patch.object(
            collection_service, "get_db_and_graph", return_value=(db, "ontologies")
        ):
            return collection_service.get_collections(collection_type)

    def test_meta_collection_is_excluded(self):
        self.assertNotIn("ckn_meta", self._collections())

    def test_graph_collections_are_still_returned(self):
        self.assertIn("CL", self._collections())
        self.assertIn("CL-CL", self._collections("edge"))

    def test_system_collections_are_still_excluded(self):
        self.assertNotIn("_system_thing", self._collections())
