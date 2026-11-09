"""Tests for the preset-sweep PR comment renderer (no database, no Django)."""

import io
import json
import tempfile
from contextlib import redirect_stdout
from pathlib import Path
from unittest import TestCase

from arango_api import preset_sweep_report
from arango_api.preset_sweep_report import MARKER, parse, render

SWEEP = """\
Loaded dataset v1.8.0-rc.9; baseline from v1.8.0-rc.9 (generated 2026-11-03T16:19:17Z)
ok    datasets-provenance-uc1  [158]
DROP  complete-dipper-genes-uc9  [81 -> 404 -> 1800 -> 81]  baseline 167
EMPTY epithelial-cells-respiratory-system  [0]
ERR   epithelial-marker-gene-panel  [0]
SKIP  cell-types-in-respiratory-system
ok    hlca-dendritic-markers-uc4  [4 -> 19]
2 of 6 presets need attention
"""
BASELINES = {
    "datasets-provenance-uc1": 159,
    "complete-dipper-genes-uc9": 167,
    "hlca-dendritic-markers-uc4": 19,
}


class ParseTests(TestCase):
    def test_reads_status_preset_and_terminal_count(self):
        self.assertEqual(
            parse(SWEEP),
            [
                ("ok", "datasets-provenance-uc1", 158),
                ("DROP", "complete-dipper-genes-uc9", 81),
                ("EMPTY", "epithelial-cells-respiratory-system", 0),
                ("ERR", "epithelial-marker-gene-panel", 0),
                ("SKIP", "cell-types-in-respiratory-system", None),
                ("ok", "hlca-dendritic-markers-uc4", 19),
            ],
        )

    def test_reads_a_row_with_no_phase_counts(self):
        # A preset whose first phase fails returns no phases, printed as [].
        self.assertEqual(
            parse("ERR   broken-one  []\nEMPTY quiet-one  []"),
            [("ERR", "broken-one", None), ("EMPTY", "quiet-one", None)],
        )

    def test_ignores_a_row_without_the_trail_its_status_carries(self):
        rows = "ok    a\nDROP  b\nNULL  c\nEXC   d  [1]\nSKIP  e  []\nEXC   f"
        self.assertEqual(parse(rows), [("EXC", "f", None)])

    def test_ignores_a_passing_row_with_no_counts(self):
        self.assertEqual(parse("ok    fine-id  []\nDROP  other  []"), [])

    def test_ignores_a_row_whose_counts_are_malformed(self):
        self.assertEqual(parse("ERR   fine-id  [1 > 2]"), [])

    def test_ignores_a_row_with_text_after_its_counts(self):
        self.assertEqual(parse("ok    fine-id  [2] | injected"), [])

    def test_ignores_a_preset_id_that_could_break_the_table(self):
        self.assertEqual(
            parse("ok    evil|`x`  [1]\nok    fine-id  [2]"), [("ok", "fine-id", 2)]
        )


class RenderTests(TestCase):
    def setUp(self):
        self.body = render(SWEEP, BASELINES, "v1.8.0-rc.9", "v1.8.0-rc.8")
        self.rows = [line for line in self.body.splitlines() if line.startswith("| ")][
            1:
        ]

    def test_starts_with_the_marker_and_names_both_versions(self):
        self.assertTrue(self.body.startswith(MARKER))
        self.assertIn("ETL `v1.8.0-rc.9`** (pin was `v1.8.0-rc.8`)", self.body)

    def test_orders_failures_first_then_drops_skips_and_passes(self):
        order = [row.split("`")[1] for row in self.rows]
        self.assertEqual(
            order,
            [
                "epithelial-marker-gene-panel",
                "epithelial-cells-respiratory-system",
                "complete-dipper-genes-uc9",
                "cell-types-in-respiratory-system",
                "datasets-provenance-uc1",
                "hlca-dendritic-markers-uc4",
            ],
        )

    def test_shows_the_change_against_the_baseline(self):
        self.assertIn(
            "| ⚠️ | `complete-dipper-genes-uc9` | 167 | 81 | -51% |", self.rows
        )
        self.assertIn("| ✅ | `datasets-provenance-uc1` | 159 | 158 | -1% |", self.rows)
        self.assertIn(
            "| ✅ | `hlca-dendritic-markers-uc4` | 19 | 19 | +0% |", self.rows
        )

    def test_names_empty_errored_and_skipped_presets(self):
        self.assertIn(
            "| ⚠️ | `epithelial-cells-respiratory-system` |  | 0 | empty |", self.rows
        )
        self.assertIn("| ⚠️ | `epithelial-marker-gene-panel` |  | 0 | err |", self.rows)
        self.assertIn(
            "| ⏭️ | `cell-types-in-respiratory-system` |  |  | skipped (known gap) |",
            self.rows,
        )

    def test_counts_presets_needing_attention(self):
        self.assertIn("6 presets · 3 ok or skipped · 3 need attention", self.body)

    def test_marks_a_passing_preset_with_no_baseline_as_new(self):
        body = render("ok    brand-new  [5]", {}, "v1", "v1")
        self.assertIn("| ✅ | `brand-new` |  | 5 | new |", body)

    def test_says_so_when_the_sweep_reported_no_presets(self):
        body = render("Traceback (most recent call last):\n", {}, "v1", "v1")
        self.assertIn("reported no presets", body)
        self.assertNotIn("need attention", body)

    def test_omits_the_pin_when_it_matches(self):
        body = render(SWEEP, BASELINES, "v1.8.0-rc.9", "v1.8.0-rc.9")
        self.assertNotIn("pin was", body)

    def test_stops_adding_rows_before_the_comment_size_limit(self):
        sweep = "\n".join(f"ok    preset-{i:05d}  [{i}]" for i in range(5000))
        body = render(sweep, {}, "v1", "v1")
        self.assertLessEqual(len(body), preset_sweep_report.MAX_BODY_CHARS + 200)
        self.assertRegex(body, r"5000 presets .* · \d+ rows not shown")


class MainTests(TestCase):
    def test_leaves_out_baseline_values_that_are_not_counts(self):
        with tempfile.TemporaryDirectory() as tmp:
            sweep, baselines = Path(tmp, "sweep.txt"), Path(tmp, "baselines.json")
            sweep.write_text("ok    a  [5]\nok    b  [5]\nok    c  [5]\n")
            baselines.write_text(
                json.dumps(
                    {"_provenance": {}, "a": 4, "b": "[x](https://e.test)", "c": -1}
                )
            )
            out = io.StringIO()
            with redirect_stdout(out):
                preset_sweep_report.main([str(sweep), str(baselines), "v1", "v1"])
        body = out.getvalue()
        self.assertIn("| ✅ | `a` | 4 | 5 |", body)
        self.assertIn("| ✅ | `b` |  | 5 | new |", body)
        self.assertIn("| ✅ | `c` |  | 5 | new |", body)
        self.assertNotIn("e.test", body)
