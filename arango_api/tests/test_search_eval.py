"""Unit tests for the search relevance evaluation library (no database)."""

import json
import tempfile
from pathlib import Path

from django.test import SimpleTestCase

from arango_api import search_eval as ev


class RankOfTestCase(SimpleTestCase):
    def test_found_returns_one_based_rank(self):
        self.assertEqual(ev.rank_of(["a", "b", "c"], ["c"]), 3)

    def test_first_of_several_expected_wins(self):
        self.assertEqual(ev.rank_of(["a", "b", "c"], ["c", "b"]), 2)

    def test_absent_returns_none(self):
        self.assertIsNone(ev.rank_of(["a", "b"], ["z"]))

    def test_empty_expected_returns_none(self):
        self.assertIsNone(ev.rank_of(["a", "b"], []))


class MetricsTestCase(SimpleTestCase):
    RANKS = [1, 3, None, 6]

    def test_success_at_counts_ranks_within_k(self):
        self.assertEqual(ev.success_at(self.RANKS, 1), 0.25)
        self.assertEqual(ev.success_at(self.RANKS, 5), 0.5)

    def test_mrr_treats_none_as_zero(self):
        self.assertAlmostEqual(ev.mrr(self.RANKS), (1 + 1 / 3 + 0 + 1 / 6) / 4)

    def test_empty_ranks_score_zero(self):
        self.assertEqual(ev.success_at([], 5), 0.0)
        self.assertEqual(ev.mrr([]), 0.0)


def _golden_file(entries):
    handle = tempfile.NamedTemporaryFile("w", suffix=".json", delete=False)
    json.dump(entries, handle)
    handle.close()
    return Path(handle.name)


def _entry(query="t cell", expected=("CL/1",), group="ranking"):
    return {"query": query, "expected_ids": list(expected), "group": group}


class LoadGoldenTestCase(SimpleTestCase):
    def _load(self, entries):
        path = _golden_file(entries)
        self.addCleanup(path.unlink)
        return ev.load_golden(path)

    def test_valid_file_loads(self):
        entries = [_entry("a"), _entry("b", group="known_gap")]
        self.assertEqual(self._load(entries), entries)

    def test_rejects_bad_entries_naming_them(self):
        bad = {
            "missing query": {"expected_ids": ["CL/1"], "group": "ranking"},
            "empty query": _entry(query=""),
            "unknown group": _entry("q-group", group="other"),
            "empty expected_ids": _entry("q-empty", expected=()),
            "non-string id": _entry("q-type", expected=(1,)),
        }
        for label, entry in bad.items():
            with self.subTest(label), self.assertRaises(ValueError) as ctx:
                self._load([_entry("ok"), entry])
            self.assertIn("entry 1", str(ctx.exception))

    def test_rejects_non_list_top_level(self):
        with self.assertRaisesRegex(ValueError, "list of entries"):
            self._load({"query": "x"})

    def test_rejects_non_dict_entry_naming_it(self):
        with self.assertRaisesRegex(ValueError, "entry 0"):
            self._load(["x"])

    def test_rejects_duplicate_query(self):
        with self.assertRaisesRegex(ValueError, "duplicate.*t cell"):
            self._load([_entry("t cell"), _entry("t cell", group="known_gap")])


GOLDEN = [
    _entry("r1"),
    _entry("r2"),
    _entry("i1", group="identifier"),
    _entry("p1", group="known_gap"),
]


class ScoreGroupsTestCase(SimpleTestCase):
    def test_groups_are_scored_separately(self):
        ranks = {"r1": 1, "r2": None, "i1": 2, "p1": 1}
        scores = ev.score_groups(ranks, GOLDEN)
        self.assertEqual(
            scores["ranking"],
            {"n": 2, "success_at_1": 0.5, "success_at_5": 0.5, "mrr": 0.5},
        )
        self.assertEqual(
            scores["identifier"],
            {"n": 1, "success_at_1": 0.0, "success_at_5": 1.0, "mrr": 0.5},
        )
        self.assertEqual(
            scores["known_gap"],
            {"n": 1, "success_at_1": 1.0, "success_at_5": 1.0, "mrr": 1.0},
        )
