"""
Tests for the sweep_presets management command.

The preset execution itself needs a loaded dataset, so these stub it out and
cover the surrounding behaviour: what gets written to the baseline, and when
the command refuses to write at all.
"""

import json
import tempfile
from io import StringIO
from pathlib import Path
from unittest import TestCase, mock

from django.core.management import call_command
from django.core.management.base import CommandError

MODULE = "arango_api.management.commands.sweep_presets"


def _outcome(count, errors=None, nodes=None):
    """Shape a fake execute_preset() return with a single phase."""
    phase_nodes = (
        nodes if nodes is not None else [{"_id": f"CL/{i}"} for i in range(count)]
    )
    return {
        "phases": {"phase-1": {"nodes": phase_nodes, "links": []}},
        "errors": errors or {},
    }


STAMP = {"etl_version": "v1.8.0-rc.1", "restored_at": "2026-10-01T12:00:00Z"}
PROVENANCE = {"_provenance": dict(STAMP)}


class SweepPresetsBaselineTests(TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.baseline_path = Path(self._tmp.name) / "preset_baselines.json"
        patcher = mock.patch(f"{MODULE}.BASELINE_PATH", self.baseline_path)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.addCleanup(self._tmp.cleanup)
        stamp = mock.patch(f"{MODULE}._dataset_stamp", return_value=dict(STAMP))
        stamp.start()
        self.addCleanup(stamp.stop)

    def _run(self, presets, outcomes, **kwargs):
        preset_defs = [{"id": pid, "phases": []} for pid in presets]
        with (
            mock.patch(f"{MODULE}.WORKFLOW_PRESETS", preset_defs),
            mock.patch(f"{MODULE}.workflow_service") as service,
        ):
            service.execute_preset.side_effect = lambda pid: outcomes[pid]
            call_command("sweep_presets", **kwargs)

    def test_targeted_update_preserves_other_baselines(self):
        """--preset with --update-baseline must not drop the other entries.

        Writing only the swept preset would silently discard every other
        baseline, disabling the regression check it exists to provide.
        """
        self.baseline_path.write_text(
            json.dumps({**PROVENANCE, "alpha": 100, "beta": 200})
        )

        self._run(
            ["alpha", "beta"],
            {"alpha": _outcome(90), "beta": _outcome(200)},
            preset="alpha",
            update_baseline=True,
        )

        recorded = json.loads(self.baseline_path.read_text())
        recorded.pop("_provenance")
        self.assertEqual(recorded, {"alpha": 90, "beta": 200})

    def test_update_records_the_dataset_the_counts_came_from(self):
        self._run(["alpha"], {"alpha": _outcome(90)}, update_baseline=True)

        provenance = json.loads(self.baseline_path.read_text())["_provenance"]
        self.assertEqual(provenance["etl_version"], "v1.8.0-rc.1")
        self.assertEqual(provenance["restored_at"], "2026-10-01T12:00:00Z")
        self.assertRegex(provenance["generated_at"], r"^\d{4}-\d{2}-\d{2}T")

    def test_targeted_update_refuses_across_datasets(self):
        """Merging one preset's new count into an older dataset's baseline
        would record two releases under one provenance."""
        original = {"_provenance": {"etl_version": "v1.7.1-rc.1"}, "alpha": 100}
        self.baseline_path.write_text(json.dumps(original))

        with self.assertRaises(CommandError):
            self._run(
                ["alpha"],
                {"alpha": _outcome(90)},
                preset="alpha",
                update_baseline=True,
            )

        self.assertEqual(json.loads(self.baseline_path.read_text()), original)

    def test_targeted_update_refuses_a_re_restore_of_the_same_version(self):
        """One version string can name different data; restored_at tells."""
        original = {
            "_provenance": {**STAMP, "restored_at": "2026-09-01T00:00:00Z"},
            "alpha": 100,
        }
        self.baseline_path.write_text(json.dumps(original))

        with self.assertRaises(CommandError):
            self._run(
                ["alpha"],
                {"alpha": _outcome(90)},
                preset="alpha",
                update_baseline=True,
            )

        self.assertEqual(json.loads(self.baseline_path.read_text()), original)

    def test_full_update_drops_presets_that_no_longer_exist(self):
        """A removed preset's old count must not be restamped as current."""
        self.baseline_path.write_text(json.dumps({**PROVENANCE, "gone": 7, "alpha": 1}))

        self._run(["alpha"], {"alpha": _outcome(90)}, update_baseline=True)

        recorded = json.loads(self.baseline_path.read_text())
        recorded.pop("_provenance")
        self.assertEqual(recorded, {"alpha": 90})

    def test_targeted_update_refuses_when_the_restore_is_unrecorded(self):
        """Two unstamped restores both read "unknown"; that matches nothing."""
        unknown = {"etl_version": "unknown", "restored_at": "unknown"}
        original = {"_provenance": unknown, "alpha": 100}
        self.baseline_path.write_text(json.dumps(original))

        with (
            mock.patch(f"{MODULE}._dataset_stamp", return_value=dict(unknown)),
            self.assertRaises(CommandError),
        ):
            self._run(
                ["alpha"],
                {"alpha": _outcome(90)},
                preset="alpha",
                update_baseline=True,
            )

        self.assertEqual(json.loads(self.baseline_path.read_text()), original)

    def test_allow_mixed_merges_and_marks_the_provenance(self):
        """The bootstrap path for a baseline with no provenance."""
        self.baseline_path.write_text(json.dumps({"alpha": 100, "beta": 200}))

        self._run(
            ["alpha", "beta"],
            {"alpha": _outcome(90)},
            preset="alpha",
            update_baseline=True,
            allow_mixed=True,
        )

        recorded = json.loads(self.baseline_path.read_text())
        self.assertTrue(recorded.pop("_provenance")["mixed"])
        self.assertEqual(recorded, {"alpha": 90, "beta": 200})

    def test_full_update_clears_mixed(self):
        mixed = {**PROVENANCE["_provenance"], "mixed": True}
        self.baseline_path.write_text(json.dumps({"_provenance": mixed, "alpha": 1}))

        self._run(["alpha"], {"alpha": _outcome(90)}, update_baseline=True)

        provenance = json.loads(self.baseline_path.read_text())["_provenance"]
        self.assertNotIn("mixed", provenance)

    def test_sweep_warns_when_the_baseline_is_from_another_dataset(self):
        self.baseline_path.write_text(
            json.dumps({"_provenance": {"etl_version": "v1.7.1-rc.1"}, "alpha": 100})
        )
        stdout, stderr = StringIO(), StringIO()

        self._run(["alpha"], {"alpha": _outcome(100)}, stdout=stdout, stderr=stderr)

        self.assertIn("baseline from v1.7.1-rc.1", stdout.getvalue())
        self.assertIn("differ", stderr.getvalue())
        self.assertNotIn("_provenance", stdout.getvalue())

    def test_update_refuses_when_a_preset_is_empty(self):
        """An empty result must not become the new baseline."""
        self.baseline_path.write_text(json.dumps({"alpha": 100}))

        with self.assertRaises(CommandError):
            self._run(
                ["alpha"],
                {"alpha": _outcome(0)},
                update_baseline=True,
            )

        self.assertEqual(json.loads(self.baseline_path.read_text()), {"alpha": 100})

    def test_update_refuses_when_a_preset_errors(self):
        self.baseline_path.write_text(json.dumps({"alpha": 100}))

        with self.assertRaises(CommandError):
            self._run(
                ["alpha"],
                {"alpha": _outcome(5, errors={"phase-1": "boom"})},
                update_baseline=True,
            )

        self.assertEqual(json.loads(self.baseline_path.read_text()), {"alpha": 100})

    def test_null_nodes_are_reported_as_a_failure(self):
        """A null node means an origin no longer resolves."""
        with self.assertRaises(SystemExit):
            self._run(
                ["alpha"],
                {"alpha": _outcome(0, nodes=[None, {"_id": "CL/1"}])},
            )

    def test_drop_below_tolerance_fails(self):
        self.baseline_path.write_text(json.dumps({"alpha": 100}))

        with self.assertRaises(SystemExit):
            self._run(["alpha"], {"alpha": _outcome(50)})

    def test_small_drop_within_tolerance_passes(self):
        self.baseline_path.write_text(json.dumps({"alpha": 100}))

        self._run(["alpha"], {"alpha": _outcome(90)})


class SweepPresetsArgumentTests(TestCase):
    def test_unknown_preset_id_fails(self):
        """A typo'd id must not exit successfully having swept nothing."""
        with mock.patch(f"{MODULE}.WORKFLOW_PRESETS", [{"id": "alpha", "phases": []}]):
            with self.assertRaises(CommandError):
                call_command("sweep_presets", preset="nope")

    def test_tolerance_outside_range_is_rejected(self):
        for bad in (-0.1, 1.0, 1.5):
            with self.subTest(tolerance=bad):
                with self.assertRaises(CommandError):
                    call_command("sweep_presets", tolerance=bad)
