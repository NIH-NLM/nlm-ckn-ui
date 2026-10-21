"""Tests for the eval_search management command, with search stubbed out."""

import json
import tempfile
from io import StringIO
from pathlib import Path
from unittest import TestCase, mock

from django.core.management import call_command
from django.core.management.base import CommandError

from arango_api import search_eval
from arango_api.management.commands import eval_search
from arango_api.services.search_service import SearchServiceError

MODULE = "arango_api.management.commands.eval_search"
STAMP = {"etl_version": "v1.8.0-rc.1", "restored_at": "2026-10-01T12:00:00Z"}
GOLDEN = [
    {"query": "T cell", "expected_ids": ["CL/0000084"], "group": "ranking"},
    {"query": "CL:0000236", "expected_ids": ["CL/0000236"], "group": "identifier"},
]
MAPS = {"maps": [["CL", {"individual_fields": [{"field_to_display": "label"}]}]]}


class EvalSearchTests(TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.dir = Path(tmp.name)
        self.golden, self.maps = self.dir / "golden.json", self.dir / "maps.json"
        self.golden.write_text(json.dumps(GOLDEN))
        self.maps.write_text(json.dumps(MAPS))
        self.baseline = self.dir / "search_baselines.json"
        for target, value in (
            (f"{MODULE}.BASELINE_PATH", self.baseline),
            (f"{MODULE}.GOLDEN_PATH", self.golden),
            (f"{MODULE}.sweep_presets._dataset_stamp", lambda: dict(STAMP)),
        ):
            patcher = mock.patch(target, value)
            patcher.start()
            self.addCleanup(patcher.stop)
        self.results = {g["query"]: [{"_id": g["expected_ids"][0]}] for g in GOLDEN}

    def _run(self, **kwargs):
        self.out, self.err = StringIO(), StringIO()

        def search(query, fields, graph):
            self.assertEqual((fields, graph), (["label"], "phenotypes"))
            if isinstance(self.results[query], Exception):
                raise self.results[query]
            return self.results[query]

        kwargs.setdefault("maps", str(self.maps))
        with mock.patch(f"{MODULE}.search_by_term", side_effect=search):
            call_command("eval_search", stdout=self.out, stderr=self.err, **kwargs)

    def _write_baseline(self, etl_version=STAMP["etl_version"]):
        ranks = dict.fromkeys(self.results, 1)
        doc = {"_provenance": {**STAMP, "etl_version": etl_version}, "ranks": ranks}
        self.baseline.write_text(json.dumps(doc))

    def test_errored_queries_are_reported_and_block_the_baseline(self):
        self.results = {"T cell": None, "CL:0000236": SearchServiceError("db down")}
        with self.assertRaises(SystemExit):
            self._run()
        self.assertIn("'T cell': search failed (None)", self.err.getvalue())
        self.assertIn("'CL:0000236': search failed (db down)", self.err.getvalue())
        with self.assertRaises(CommandError):
            self._run(update_baseline=True)
        self.assertFalse(self.baseline.exists())

    def test_missing_golden_or_maps_is_a_command_error(self):
        with self.assertRaisesRegex(CommandError, "golden"):
            self._run(golden=str(self.dir / "absent.json"))
        self.maps = self.dir / "absent.json"
        with self.assertRaisesRegex(CommandError, "collection maps"):
            self._run()

    def test_regression_exits_non_zero(self):
        self._write_baseline()
        self.results["T cell"][:0] = [{"_id": f"CL/{i}"} for i in range(9)]
        with self.assertRaises(SystemExit):
            self._run()
        self.assertIn("REGRESSION 'T cell': 1 -> 10", self.out.getvalue())

    def test_equal_ranks_pass_and_a_dataset_change_warns(self):
        self._write_baseline()
        self._run()
        self.assertNotIn("REGRESSION", self.out.getvalue())
        self.assertEqual(self.err.getvalue(), "")
        self._write_baseline(etl_version="v1.7.1")
        self._run()
        self.assertIn("baseline is from v1.7.1", self.err.getvalue())

    def test_no_baseline_reports_then_update_writes_ranks_and_provenance(self):
        self.results["CL:0000236"].insert(0, {"_id": "CL/x"})
        self._run()
        self.assertIn("ranking", self.out.getvalue())
        self.assertIn("No baseline exists", self.out.getvalue())
        self._run(update_baseline=True)
        recorded = json.loads(self.baseline.read_text())
        self.assertEqual(recorded["ranks"], {"T cell": 1, "CL:0000236": 2})
        self.assertEqual(recorded["_provenance"]["etl_version"], STAMP["etl_version"])
        self.assertIn("generated_at", recorded["_provenance"])


class CommittedGoldenSetTests(TestCase):
    """The golden list and baseline shipped in the repo, not test fixtures."""

    def test_golden_list_is_valid_and_every_query_has_a_baseline_rank(self):
        golden = search_eval.load_golden(eval_search.GOLDEN_PATH)
        baseline = json.loads(eval_search.BASELINE_PATH.read_text())

        self.assertEqual(
            {g["query"] for g in golden}, set(baseline["ranks"]), "re-record the baseline"
        )
        self.assertIn("etl_version", baseline["_provenance"])
