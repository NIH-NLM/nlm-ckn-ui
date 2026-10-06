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


class CompareToBaselineTestCase(SimpleTestCase):
    BASELINE = {"r1": 1, "r2": 4, "i1": 7, "p1": 1}

    def _compare(self, baseline=None, **changes):
        baseline = self.BASELINE if baseline is None else baseline
        current = {**self.BASELINE, **changes}
        return ev.compare_to_baseline(current, baseline, GOLDEN)

    def test_unchanged_is_clean(self):
        result = self._compare()
        self.assertEqual(result["regressions"], [])
        self.assertEqual(result["improvements"], [])
        self.assertEqual(result["new"], [])

    def test_worsening_inside_top_five_regresses(self):
        result = self._compare(r1=2)
        self.assertEqual(
            result["regressions"], [{"query": "r1", "baseline": 1, "current": 2}]
        )

    def test_falling_out_of_top_five_regresses(self):
        for current in (None, 9):
            with self.subTest(current):
                result = self._compare(r2=current)
                self.assertEqual(
                    result["regressions"],
                    [{"query": "r2", "baseline": 4, "current": current}],
                )

    def test_already_outside_top_five_cannot_regress(self):
        for current in (None, 12):
            with self.subTest(current):
                self.assertEqual(self._compare(i1=current)["regressions"], [])

    def test_known_gap_never_regresses(self):
        self.assertEqual(self._compare(p1=None)["regressions"], [])

    def test_better_rank_is_an_improvement(self):
        result = self._compare(r2=2, i1=3)
        self.assertEqual(
            result["improvements"],
            [
                {"query": "r2", "baseline": 4, "current": 2},
                {"query": "i1", "baseline": 7, "current": 3},
            ],
        )
        self.assertEqual(result["regressions"], [])

    def test_query_missing_from_baseline_is_new_not_an_improvement(self):
        baseline = {k: v for k, v in self.BASELINE.items() if k != "p1"}
        result = self._compare(baseline=baseline)
        self.assertEqual(result["new"], [{"query": "p1", "current": 1}])
        self.assertEqual(result["improvements"], [])
        self.assertEqual(result["regressions"], [])


class AggregateToleranceTestCase(SimpleTestCase):
    def _drops(self, golden, baseline, current):
        result = ev.compare_to_baseline(current, baseline, golden)
        return result["aggregate_drops"]

    def _hundred(self, current_hits):
        # 100 ranking queries; the first 50 rank 1 in the baseline, the rest
        # are absent. The first `current_hits` rank 1 in the current run.
        golden = [_entry(f"q{i}") for i in range(100)]
        baseline = {f"q{i}": 1 if i < 50 else None for i in range(100)}
        current = {f"q{i}": 1 if i < current_hits else None for i in range(100)}
        return self._drops(golden, baseline, current)

    def test_drop_of_exactly_tolerance_is_allowed(self):
        self.assertEqual(self._hundred(47), [])

    def test_drop_beyond_tolerance_is_reported_with_values(self):
        drops = self._hundred(46)
        self.assertEqual(
            drops,
            [
                {"group": "ranking", "metric": metric, "baseline": 0.5, "current": 0.46}
                for metric in ("success_at_1", "success_at_5", "mrr")
            ],
        )

    def _thirty_one(self, before, now):
        # 31 ranking queries, all first except q0, which moves from `before`
        # to `now`.
        golden = [_entry(f"q{i}") for i in range(31)]
        baseline = {f"q{i}": 1 for i in range(31)}
        baseline["q0"] = before
        return self._drops(golden, baseline, {**baseline, "q0": now})

    def test_losing_one_query_of_31_from_first_place_is_flagged(self):
        drops = self._thirty_one(1, 2)
        self.assertEqual(
            [(d["metric"], d["baseline"]) for d in drops], [("success_at_1", 1.0)]
        )
        self.assertAlmostEqual(drops[0]["current"], 30 / 31)

    def test_small_mrr_only_move_is_not_flagged(self):
        self.assertEqual(self._thirty_one(3, 4), [])

    def test_new_queries_cannot_hide_a_drop(self):
        golden = [_entry("a"), _entry("b"), _entry("new")]
        baseline = {"a": 1, "b": 1}
        current = {"a": 1, "b": None, "new": 1}
        drops = self._drops(golden, baseline, current)
        self.assertIn(
            {
                "group": "ranking",
                "metric": "success_at_1",
                "baseline": 1.0,
                "current": 0.5,
            },
            drops,
        )
