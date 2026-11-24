"""Tests for the preset schema-drift guard.

get_dataset_labels must never raise: the preset gallery has to render even when
ArangoDB is unreachable, so every failure collapses to None ("cannot determine"),
which callers treat as "do not flag anything".
"""

from unittest import mock

from django.test import SimpleTestCase

from arango_api.services import schema_guard


class GetDatasetLabelsTestCase(SimpleTestCase):
    def setUp(self):
        schema_guard.reset_cache()

    def _patch(self, collections=("CS-GS",), aql_result=(["EXPRESSES", "PART_OF"],)):
        """Patch the collection listing and the AQL execution."""
        fake_db = mock.MagicMock()
        fake_db.aql.execute = mock.Mock(return_value=iter(aql_result))
        return (
            mock.patch.object(
                schema_guard, "get_db_and_graph", return_value=(fake_db, "KN-Test")
            ),
            mock.patch.object(
                schema_guard, "get_collections", return_value=list(collections)
            ),
            fake_db,
        )

    def test_returns_labels_present_in_the_graph(self):
        patch_db, patch_colls, _ = self._patch()
        with patch_db, patch_colls:
            self.assertEqual(
                schema_guard.get_dataset_labels("phenotypes"),
                frozenset({"EXPRESSES", "PART_OF"}),
            )

    def test_drops_null_labels(self):
        patch_db, patch_colls, _ = self._patch(aql_result=([None, "PART_OF", ""],))
        with patch_db, patch_colls:
            self.assertEqual(
                schema_guard.get_dataset_labels("phenotypes"), frozenset({"PART_OF"})
            )

    def test_no_edge_collections_returns_none(self):
        patch_db, patch_colls, _ = self._patch(collections=())
        with patch_db, patch_colls:
            self.assertIsNone(schema_guard.get_dataset_labels("phenotypes"))

    def test_database_error_returns_none(self):
        patch_db, patch_colls, fake_db = self._patch()
        fake_db.aql.execute.side_effect = RuntimeError("connection refused")
        with patch_db, patch_colls:
            self.assertIsNone(schema_guard.get_dataset_labels("phenotypes"))

    def test_empty_aql_result_returns_none(self):
        patch_db, patch_colls, _ = self._patch(aql_result=([],))
        with patch_db, patch_colls:
            self.assertIsNone(schema_guard.get_dataset_labels("phenotypes"))

    def test_empty_result_is_not_cached(self):
        patch_db, patch_colls, fake_db = self._patch()
        fake_db.aql.execute.side_effect = [iter([[]]), iter([["EXPRESSES"]])]
        with patch_db, patch_colls:
            self.assertIsNone(schema_guard.get_dataset_labels("phenotypes"))
            self.assertEqual(
                schema_guard.get_dataset_labels("phenotypes"), frozenset({"EXPRESSES"})
            )

    def test_queries_the_requested_graph(self):
        patch_db, patch_colls, _ = self._patch()
        with patch_db as mocked_get_db, patch_colls:
            schema_guard.get_dataset_labels("phenotypes")
            mocked_get_db.assert_called_once_with("phenotypes")

    def test_result_is_cached_within_ttl(self):
        patch_db, patch_colls, fake_db = self._patch()
        with patch_db, patch_colls:
            schema_guard.get_dataset_labels("phenotypes")
            schema_guard.get_dataset_labels("phenotypes")
            self.assertEqual(fake_db.aql.execute.call_count, 1)

    def test_cache_is_per_graph(self):
        patch_db, patch_colls, fake_db = self._patch()
        fake_db.aql.execute.side_effect = [iter([["EXPRESSES"]]), iter([["PART_OF"]])]
        with patch_db, patch_colls:
            schema_guard.get_dataset_labels("phenotypes")
            schema_guard.get_dataset_labels("ontologies")
            self.assertEqual(fake_db.aql.execute.call_count, 2)

    def test_failures_are_not_cached(self):
        patch_db, patch_colls, fake_db = self._patch()
        fake_db.aql.execute.side_effect = [
            RuntimeError("down"),
            iter([["EXPRESSES"]]),
        ]
        with patch_db, patch_colls:
            self.assertIsNone(schema_guard.get_dataset_labels("phenotypes"))
            self.assertEqual(
                schema_guard.get_dataset_labels("phenotypes"), frozenset({"EXPRESSES"})
            )

    def test_cache_expires_after_ttl(self):
        patch_db, patch_colls, fake_db = self._patch()
        fake_db.aql.execute.side_effect = [iter([["EXPRESSES"]]), iter([["PART_OF"]])]
        with patch_db, patch_colls:
            with mock.patch.object(schema_guard.time, "monotonic", return_value=0.0):
                schema_guard.get_dataset_labels("phenotypes")
            later = schema_guard.CACHE_TTL_SECONDS + 1
            with mock.patch.object(schema_guard.time, "monotonic", return_value=later):
                schema_guard.get_dataset_labels("phenotypes")
            self.assertEqual(fake_db.aql.execute.call_count, 2)


def _preset(*phase_settings):
    """Build a preset dict from a list of phase `settings` dicts."""
    return {
        "id": "test-preset",
        "phases": [
            {"id": f"phase-{i}", "settings": settings}
            for i, settings in enumerate(phase_settings)
        ],
    }


class FindUnknownLabelsTestCase(SimpleTestCase):
    KNOWN = {"phenotypes": frozenset({"IS_ABOUT", "PART_OF"})}

    def test_flags_a_label_absent_from_the_dataset(self):
        preset = _preset(
            {"graphType": "phenotypes", "edgeFilters": {"Label": ["MEMBER_OF"]}}
        )
        self.assertEqual(
            schema_guard.find_unknown_labels(preset, self.KNOWN), ["MEMBER_OF"]
        )

    def test_flags_a_label_pinned_by_a_linked_column(self):
        preset = _preset({"graphType": "phenotypes"})
        preset["solution"] = {
            "phaseId": "phase-0",
            "linkedColumns": [
                {
                    "path": [
                        {"label": "IS_ABOUT", "collection": "CS"},
                        {"label": "MEMBER_OF", "collection": "CSD"},
                    ]
                }
            ],
        }
        self.assertEqual(
            schema_guard.find_unknown_labels(preset, self.KNOWN), ["MEMBER_OF"]
        )

    def test_valid_preset_flags_nothing(self):
        preset = _preset(
            {"graphType": "phenotypes", "edgeFilters": {"Label": ["IS_ABOUT"]}}
        )
        self.assertEqual(schema_guard.find_unknown_labels(preset, self.KNOWN), [])

    def test_inspects_closing_edge_filters(self):
        preset = _preset(
            {
                "graphType": "phenotypes",
                "excludeClosingEdges": {"Label": ["GONE_A"]},
                "requireClosingEdges": {"Label": ["GONE_B"]},
            }
        )
        self.assertEqual(
            schema_guard.find_unknown_labels(preset, self.KNOWN), ["GONE_A", "GONE_B"]
        )

    def test_result_is_sorted_and_deduplicated(self):
        preset = _preset(
            {"graphType": "phenotypes", "edgeFilters": {"Label": ["ZED", "ALPHA"]}},
            {"graphType": "phenotypes", "edgeFilters": {"Label": ["ALPHA"]}},
        )
        self.assertEqual(
            schema_guard.find_unknown_labels(preset, self.KNOWN), ["ALPHA", "ZED"]
        )

    def test_phase_without_graph_type_inherits_the_first_declared_one(self):
        preset = _preset(
            {"graphType": "phenotypes", "edgeFilters": {"Label": ["IS_ABOUT"]}},
            {"edgeFilters": {"Label": ["MEMBER_OF"]}},
        )
        self.assertEqual(
            schema_guard.find_unknown_labels(preset, self.KNOWN), ["MEMBER_OF"]
        )

    def test_falls_back_to_ontologies_when_no_phase_declares_a_graph(self):
        preset = _preset({"edgeFilters": {"Label": ["MEMBER_OF"]}})
        labels = {"ontologies": frozenset({"PART_OF"})}
        self.assertEqual(
            schema_guard.find_unknown_labels(preset, labels), ["MEMBER_OF"]
        )

    def test_unreadable_graph_flags_nothing(self):
        preset = _preset(
            {"graphType": "phenotypes", "edgeFilters": {"Label": ["MEMBER_OF"]}}
        )
        self.assertEqual(
            schema_guard.find_unknown_labels(preset, {"phenotypes": None}), []
        )

    def test_missing_graph_entry_flags_nothing(self):
        preset = _preset(
            {"graphType": "phenotypes", "edgeFilters": {"Label": ["MEMBER_OF"]}}
        )
        self.assertEqual(schema_guard.find_unknown_labels(preset, {}), [])

    def test_preset_without_phases_flags_nothing(self):
        self.assertEqual(schema_guard.find_unknown_labels({"id": "x"}, self.KNOWN), [])

    def test_empty_label_list_flags_nothing(self):
        preset = _preset({"graphType": "phenotypes", "edgeFilters": {"Label": []}})
        self.assertEqual(schema_guard.find_unknown_labels(preset, self.KNOWN), [])
