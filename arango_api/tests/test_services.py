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

    def test_traverse_graph_exclude_categorical(self):
        # OUTBOUND from CL/0000061 with subClassOf excluded: the CL-CL subClassOf
        # edge is dropped, the GO/UBERON edges remain.
        result = graph_service.traverse_graph(
            node_ids=["CL/0000061"],
            depth=1,
            edge_direction="OUTBOUND",
            allowed_collections=["CL", "GO", "UBERON"],
            graph="ontologies",
            edge_filters=None,
            exclude_edge_filters={"label": ["subClassOf"]},
            include_inter_node_edges=False,
        )
        labels = sorted(link["label"] for link in result["CL/0000061"]["links"])
        self.assertNotIn("subClassOf", labels)
        self.assertIn("participates_in", labels)

    def test_exclude_categorical_adds_prune_condition(self):
        bind_vars = {}
        pos, neg = graph_service._build_edge_filter_clause(
            None, bind_vars, exclude_filters={"label": ["subClassOf"]}
        )
        # FILTER keeps non-excluded edges. The excluded value is passed via a
        # bind var (not interpolated into the clause text), so assert on the
        # bind var content rather than searching the generated AQL.
        self.assertTrue(pos)
        self.assertEqual(bind_vars.get("exclude_value_label"), ["subClassOf"])
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

    def test_find_inter_node_edges_exclude_categorical(self):
        # Exclude the subClassOf edge; the other two (participates_in, part_of)
        # must remain.
        result = graph_service.find_inter_node_edges(
            node_ids=["CL/0000061", "CL/0000151", "GO/0008150", "UBERON/0000061"],
            graph="ontologies",
            exclude_edge_filters={"label": ["subClassOf"]},
        )
        labels = sorted(e["label"] for e in result)
        self.assertEqual(labels, ["part_of", "participates_in"])

    def test_find_inter_node_edges_exclude_empty_is_noop(self):
        result = graph_service.find_inter_node_edges(
            node_ids=["CL/0000061", "CL/0000151", "GO/0008150", "UBERON/0000061"],
            graph="ontologies",
            exclude_edge_filters={"label": []},
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
                    "IS_GENETIC_BASIS_FOR_CONDITION",
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
                    "IS_GENETIC_BASIS_FOR_CONDITION",
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
                    "IS_GENETIC_BASIS_FOR_CONDITION",
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
                edge_filters={"Label": ["IS_GENETIC_BASIS_FOR_CONDITION"]},
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
                    "IS_GENETIC_BASIS_FOR_CONDITION",
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
        # IS_GENETIC_BASIS_FOR_CONDITION is the disease->gene edge on EVERY gene
        # path (nac_b1, nac_c1, nac_x1), so excluding it means every path has an
        # excluded edge and no gene survives. Before the closing-edge branch
        # applied exclude filters this returned {g1, g3} (exclude ignored); now
        # it is empty.
        genes = self._genes_from_diseases_exclude(
            exclude_edge_filters={"Label": ["IS_GENETIC_BASIS_FOR_CONDITION"]}
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

    def test_phenotypes_drilldown_uberon_aggregates_cl(self):
        # Drilldown into a seeded organ runs the heavy _aggregate_cl_for_organ
        # path: depth-5 INBOUND UBERON subtree -> CL, each CL with its GS chain.
        # Seed: CL/0000066 part_of UBERON/0002048, CL/0000066 -> GS/test_gs_1.
        result = sunburst_service.get_phenotypes_sunburst(parent_id="UBERON/0002048")
        self.assertIsInstance(result, list)
        cl_ids = [node["_id"] for node in result]
        self.assertIn("CL/0000066", cl_ids)
        cl_node = next(node for node in result if node["_id"] == "CL/0000066")
        # The CL carries its GS children inline and is flagged expandable.
        self.assertTrue(cl_node["_hasChildren"])
        gs_ids = [child["_id"] for child in cl_node["children"]]
        self.assertIn("GS/test_gs_1", gs_ids)

    def test_phenotypes_drilldown_cl_returns_gs_with_leaves(self):
        # CL -> GS, each GS carrying its MONDO/CHEMBL/BMC/PR children.
        # Seed: CL/0000066 -> GS/test_gs_1 -> MONDO/0000001.
        result = sunburst_service.get_phenotypes_sunburst(parent_id="CL/0000066")
        self.assertIsInstance(result, list)
        gs_ids = [node["_id"] for node in result]
        self.assertIn("GS/test_gs_1", gs_ids)
        gs_node = next(node for node in result if node["_id"] == "GS/test_gs_1")
        self.assertTrue(gs_node["_hasChildren"])
        leaf_ids = [child["_id"] for child in gs_node["children"]]
        self.assertIn("MONDO/0000001", leaf_ids)

    def test_phenotypes_drilldown_gs_returns_leaves(self):
        # GS -> MONDO/CHEMBL/BMC/PR leaf nodes. Seed: GS/test_gs_1 -> MONDO/0000001.
        result = sunburst_service.get_phenotypes_sunburst(parent_id="GS/test_gs_1")
        self.assertIsInstance(result, list)
        leaf_ids = [node["_id"] for node in result]
        self.assertIn("MONDO/0000001", leaf_ids)


class UberonClCountQueryTestCase(TestCase):
    """Unit tests for _get_uberon_cl_counts query construction (no DB required).

    Regression guard for the rewrite that traverses only PHENOTYPES_TOP_ORGANS
    instead of scanning the entire UBERON collection. The whole-collection scan
    pinned the ArangoDB host's CPU and tripped gunicorn's worker timeout, while
    only the top-organ counts are ever read by callers.
    """

    def setUp(self):
        # The counts are memoized in a module-level dict for the life of the
        # process; clear it so each test starts cold and does not pollute others.
        sunburst_service._UBERON_CL_COUNT_CACHE.clear()
        self.addCleanup(sunburst_service._UBERON_CL_COUNT_CACHE.clear)

    def _mock_db(self, rows):
        """A db whose aql.execute yields `rows` (iterated like a cursor)."""
        db = mock.Mock()
        db.aql.execute.return_value = iter(rows)
        return db

    def test_query_traverses_only_top_organs(self):
        rows = [[organ, 3] for organ in sunburst_service.PHENOTYPES_TOP_ORGANS]
        db = self._mock_db(rows)

        result = sunburst_service._get_uberon_cl_counts(db, "KN-Phenotypes-v2.0")

        query, kwargs = db.aql.execute.call_args[0][0], db.aql.execute.call_args[1]
        # Must iterate the bound organ list, NOT scan the whole UBERON collection.
        self.assertIn("FOR organ IN @organs", query)
        self.assertNotIn("FOR u IN UBERON", query)
        self.assertEqual(
            kwargs["bind_vars"]["organs"], sunburst_service.PHENOTYPES_TOP_ORGANS
        )
        self.assertEqual(kwargs["bind_vars"]["g"], "KN-Phenotypes-v2.0")
        # The returned mapping still keys organ_id -> distinct CL count, exactly
        # what counts.get(organ_id) consumers depend on.
        self.assertEqual(
            result,
            {organ: 3 for organ in sunburst_service.PHENOTYPES_TOP_ORGANS},
        )

    def test_result_is_memoized_per_graph(self):
        rows = [[sunburst_service.PHENOTYPES_TOP_ORGANS[0], 1]]
        db = self._mock_db(rows)
        # Re-arm the cursor for each potential execute call.
        db.aql.execute.side_effect = lambda *a, **k: iter(list(rows))

        first = sunburst_service._get_uberon_cl_counts(db, "KN-Phenotypes-v2.0")
        second = sunburst_service._get_uberon_cl_counts(db, "KN-Phenotypes-v2.0")

        self.assertEqual(first, second)
        # Second call is served from the memo; the DB is hit only once.
        self.assertEqual(db.aql.execute.call_count, 1)

    def test_empty_result_is_not_cached(self):
        db = self._mock_db([])
        db.aql.execute.side_effect = lambda *a, **k: iter([])

        result = sunburst_service._get_uberon_cl_counts(db, "KN-Phenotypes-v2.0")

        self.assertEqual(result, {})
        # An empty result (e.g. DB mid-restore) must not poison the cache, so a
        # later call retries rather than serving an empty map forever.
        self.assertNotIn(
            "KN-Phenotypes-v2.0", sunburst_service._UBERON_CL_COUNT_CACHE
        )
        sunburst_service._get_uberon_cl_counts(db, "KN-Phenotypes-v2.0")
        self.assertEqual(db.aql.execute.call_count, 2)
