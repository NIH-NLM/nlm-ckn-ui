"""Unit tests for hierarchy_service. No database required."""

from unittest import mock

from django.test import SimpleTestCase

from arango_api.services import hierarchy_service


class BuildDescendantCountsTestCase(SimpleTestCase):
    """Tests for build_descendant_counts."""

    def test_counts_distinct_descendants_in_a_chain(self):
        # a <- b <- c  (edges point child -> parent)
        edges = [("CL/b", "CL/a"), ("CL/c", "CL/b")]

        counts = hierarchy_service.build_descendant_counts(edges)

        self.assertEqual(counts["CL/a"], 2)
        self.assertEqual(counts["CL/b"], 1)
        self.assertEqual(counts["CL/c"], 0)

    def test_counts_a_shared_descendant_once_per_ancestor(self):
        # d has two parents, b and c, both under a
        edges = [
            ("CL/b", "CL/a"),
            ("CL/c", "CL/a"),
            ("CL/d", "CL/b"),
            ("CL/d", "CL/c"),
        ]

        counts = hierarchy_service.build_descendant_counts(edges)

        # a reaches b, c and d — d once, not twice
        self.assertEqual(counts["CL/a"], 3)
        self.assertEqual(counts["CL/b"], 1)
        self.assertEqual(counts["CL/c"], 1)


class WeightForTestCase(SimpleTestCase):
    """Tests for weight_for."""

    def test_weight_is_the_square_root_of_the_count(self):
        self.assertAlmostEqual(hierarchy_service.weight_for(3155), 56.169, places=2)

    def test_weight_of_a_leaf_is_one(self):
        self.assertEqual(hierarchy_service.weight_for(0), 1)


class LabelConfigTestCase(SimpleTestCase):
    """Tests for the curated label config."""

    def test_sub_class_of_is_configured_from_the_cl_root(self):
        config = hierarchy_service.CL_HIERARCHY_LABELS["SUB_CLASS_OF"]

        self.assertEqual(config["collection"], "CL")
        self.assertEqual(config["edges"], "CL-CL")
        self.assertEqual(config["root"], "CL/0000000")

    def test_unknown_label_is_rejected(self):
        with self.assertRaises(hierarchy_service.UnknownLabelError):
            hierarchy_service.config_for("NOT_A_PREDICATE")


class _FakeCursor:
    """Iterates once over a fixed count, like an AQL COLLECT WITH COUNT cursor."""

    def __init__(self, count):
        self._count = count

    def __iter__(self):
        return iter([self._count])


class _FakeAQL:
    def __init__(self, counts_by_label):
        self._counts_by_label = counts_by_label

    def execute(self, query, bind_vars):
        return _FakeCursor(self._counts_by_label[bind_vars["label"]])


class _FakeDB:
    def __init__(self, counts_by_label):
        self.aql = _FakeAQL(counts_by_label)


class _RecordingAQL:
    """Records every execute() call's query and bind_vars, and yields `rows`."""

    def __init__(self, rows):
        self._rows = list(rows)
        self.calls = []

    def execute(self, query, bind_vars):
        self.calls.append({"query": query, "bind_vars": bind_vars})
        return iter(self._rows)


class _RecordingCursorDB:
    """A fake db whose aql.execute records every call, for asserting query shape."""

    def __init__(self, rows=()):
        self.aql = _RecordingAQL(rows)


class QueryShapeTestCase(SimpleTestCase):
    """The AQL run for edges and children binds collection names from the
    curated config, never from caller-supplied request data -- the label
    selects a config entry, and only the entry's own values reach AQL as
    `@@edges`/`@@collection`.
    """

    def test_edges_for_binds_the_edge_collection_from_config_not_the_label(self):
        db = _RecordingCursorDB(rows=[])

        hierarchy_service._edges_for(db, "SUB_CLASS_OF")

        call = db.aql.calls[0]
        self.assertEqual(call["bind_vars"]["@edges"], "CL-CL")
        self.assertEqual(call["bind_vars"]["label"], "SUB_CLASS_OF")
        # The bound collection name is a config value, never the raw label
        # string standing in for it.
        self.assertNotEqual(call["bind_vars"]["@edges"], call["bind_vars"]["label"])

    def test_child_docs_binds_edges_and_collection_from_config(self):
        db = _RecordingCursorDB(rows=[])

        hierarchy_service._child_docs(db, "SUB_CLASS_OF", "CL/0000000")

        call = db.aql.calls[0]
        self.assertEqual(call["bind_vars"]["@edges"], "CL-CL")
        self.assertEqual(call["bind_vars"]["@collection"], "CL")
        self.assertEqual(call["bind_vars"]["parent"], "CL/0000000")
        # parent_id itself is bound as a plain value, never interpolated into
        # the query text.
        self.assertNotIn("CL/0000000", call["query"])


class DescendantCountsCacheTestCase(SimpleTestCase):
    """The descendant-count memo is keyed by (graph_name, label) and rebuilds
    when the graph name changes -- a re-ingest under a new graph name must not
    keep serving stale counts computed under the old one.
    """

    def setUp(self):
        hierarchy_service._DESCENDANT_COUNT_CACHE.clear()
        self.addCleanup(hierarchy_service._DESCENDANT_COUNT_CACHE.clear)

    def test_second_call_for_the_same_graph_and_label_does_not_requery(self):
        db = _RecordingCursorDB(rows=[["CL/0000001", "CL/0000000"]])

        first = hierarchy_service.descendant_counts(db, "graph-v1", "SUB_CLASS_OF")
        second = hierarchy_service.descendant_counts(db, "graph-v1", "SUB_CLASS_OF")

        self.assertEqual(len(db.aql.calls), 1)
        self.assertEqual(first, second)

    def test_a_new_graph_name_rebuilds_instead_of_reusing_the_old_graph_s_counts(self):
        db = _RecordingCursorDB(rows=[["CL/0000001", "CL/0000000"]])

        hierarchy_service.descendant_counts(db, "graph-v1", "SUB_CLASS_OF")
        hierarchy_service.descendant_counts(db, "graph-v2", "SUB_CLASS_OF")

        # One query per distinct graph name, not a cache hit reused across them.
        self.assertEqual(len(db.aql.calls), 2)

    def test_a_different_label_on_the_same_graph_also_rebuilds(self):
        db = _RecordingCursorDB(rows=[["CL/0000001", "CL/0000000"]])
        fake_config = dict(
            hierarchy_service.CL_HIERARCHY_LABELS,
            DEVELOPS_FROM={"collection": "CL", "edges": "CL-CL", "root": "CL/0000000"},
        )

        with mock.patch.object(hierarchy_service, "CL_HIERARCHY_LABELS", fake_config):
            hierarchy_service.descendant_counts(db, "graph-v1", "SUB_CLASS_OF")
            hierarchy_service.descendant_counts(db, "graph-v1", "DEVELOPS_FROM")

        self.assertEqual(len(db.aql.calls), 2)


class DescendantCountsVersionKeyingTestCase(SimpleTestCase):
    """The descendant-count cache must key on the loaded dataset version, not
    just the graph name -- a blue-green swap can replace data under an
    unchanged graph name, and a long-running worker must not keep serving
    counts computed under the previous dataset.
    """

    def setUp(self):
        hierarchy_service._DESCENDANT_COUNT_CACHE.clear()
        self.addCleanup(hierarchy_service._DESCENDANT_COUNT_CACHE.clear)

    def test_a_dataset_version_change_rebuilds_the_cache(self):
        db = _RecordingCursorDB(rows=[["CL/0000001", "CL/0000000"]])

        with mock.patch.object(
            hierarchy_service.version_service,
            "get_loaded_etl_version",
            return_value="v1.7.0",
        ):
            hierarchy_service.descendant_counts(db, "graph-v1", "SUB_CLASS_OF")

        with mock.patch.object(
            hierarchy_service.version_service,
            "get_loaded_etl_version",
            return_value="v1.8.0",
        ):
            hierarchy_service.descendant_counts(db, "graph-v1", "SUB_CLASS_OF")

        # Same graph name, different dataset version -- two queries, not a
        # cache hit reused across the swap.
        self.assertEqual(len(db.aql.calls), 2)

    def test_an_unknown_version_still_serves_from_cache(self):
        db = _RecordingCursorDB(rows=[["CL/0000001", "CL/0000000"]])

        with mock.patch.object(
            hierarchy_service.version_service,
            "get_loaded_etl_version",
            return_value="unknown",
        ):
            first = hierarchy_service.descendant_counts(db, "graph-v1", "SUB_CLASS_OF")
            second = hierarchy_service.descendant_counts(db, "graph-v1", "SUB_CLASS_OF")

        self.assertEqual(len(db.aql.calls), 1)
        self.assertEqual(first, second)


class AvailableLabelsTestCase(SimpleTestCase):
    """Tests for available_labels's filtering of labels absent from the data.

    This filtering is what turns a renamed predicate into a visible error
    instead of an empty chart, so it is covered directly against a fake db
    rather than relying on the fixtures happening to include every label.
    """

    def test_omits_a_configured_label_with_no_edges_in_the_data(self):
        fake_config = {
            "SUB_CLASS_OF": {
                "collection": "CL",
                "edges": "CL-CL",
                "root": "CL/0000000",
            },
            "RENAMED_PREDICATE": {
                "collection": "CL",
                "edges": "CL-CL",
                "root": "CL/0000000",
            },
        }
        fake_db = _FakeDB({"SUB_CLASS_OF": 6, "RENAMED_PREDICATE": 0})

        with mock.patch.object(
            hierarchy_service, "CL_HIERARCHY_LABELS", fake_config
        ), mock.patch.object(hierarchy_service, "db_ontologies", fake_db):
            labels = hierarchy_service.available_labels()

        self.assertEqual([entry["label"] for entry in labels], ["SUB_CLASS_OF"])
