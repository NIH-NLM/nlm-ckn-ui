"""
Execute every workflow preset against the loaded dataset and report on it.

The DB-free guards in `arango_api/tests/test_workflow_presets.py` catch pinned
identifiers that the ETL has renamed, but they cannot tell whether a preset
still returns anything. Only running the presets against a real dump can, and
CI has no real dump — so this is a command you run after loading one.

    ./venv/bin/python manage.py sweep_presets
    ./venv/bin/python manage.py sweep_presets --update-baseline

Exits non-zero when a preset errors, returns nothing, or falls materially below
its recorded baseline. That last case is the one worth having: an ETL predicate
rename dropped one preset from 104 nodes to 9 while still "passing".
"""

import json
import os
import tempfile
from datetime import datetime, timezone
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError

from arango_api.db import db_ontologies
from arango_api.services import version_service, workflow_service
from arango_api.workflow_presets import WORKFLOW_PRESETS

BASELINE_PATH = Path(__file__).resolve().parents[2] / "preset_baselines.json"

# Baseline entry naming the dataset the counts came from, so drift can be told
# apart from comparing against a different release (#193).
PROVENANCE_KEY = "_provenance"

# Fraction a preset's terminal node count may fall below baseline before it is
# reported. Node counts move a little between dataset releases; a quarter of the
# result set disappearing is not drift, it is a break.
DEFAULT_TOLERANCE = 0.25


def _write_baseline(counts, path=None):
    """Write the baseline atomically so an interrupted run cannot truncate it.

    The destination is resolved at call time rather than bound as a default, so
    that it honours the module attribute.
    """
    path = Path(path) if path is not None else BASELINE_PATH
    payload = json.dumps(counts, indent=2, sort_keys=True) + "\n"
    handle, tmp_name = tempfile.mkstemp(dir=str(path.parent), suffix=".tmp")
    try:
        with os.fdopen(handle, "w") as tmp:
            tmp.write(payload)
        os.replace(tmp_name, path)
    except BaseException:
        Path(tmp_name).unlink(missing_ok=True)
        raise


def _dataset_stamp():
    """Return the loaded dataset's etl_version and restored_at from ckn_meta.

    Either is "unknown" when the restore did not stamp it or ArangoDB cannot be
    read; the sweep reports that rather than failing on it.
    """
    try:
        document = db_ontologies.collection(version_service.META_COLLECTION).get(
            version_service.META_KEY
        )
    except Exception:  # noqa: BLE001 - provenance is informational
        document = None
    document = document or {}
    return {
        key: document.get(key) or version_service.UNKNOWN
        for key in ("etl_version", "restored_at")
    }


class Command(BaseCommand):
    help = "Run every workflow preset against the loaded dataset and check for regressions."

    def add_arguments(self, parser):
        parser.add_argument(
            "--update-baseline",
            action="store_true",
            help="Record the current counts as the baseline instead of checking against it.",
        )
        parser.add_argument(
            "--tolerance",
            type=float,
            default=DEFAULT_TOLERANCE,
            help=f"Allowed fractional drop below baseline (default {DEFAULT_TOLERANCE}).",
        )
        parser.add_argument(
            "--preset",
            help="Sweep only this preset id.",
        )
        parser.add_argument(
            "--allow-mixed",
            action="store_true",
            help=(
                "With --preset --update-baseline, merge into a baseline from another "
                "or unrecorded restore. The provenance is marked mixed until a full "
                "--update-baseline replaces it."
            ),
        )

    def handle(self, *args, **options):
        tolerance = options["tolerance"]
        if not 0 <= tolerance < 1:
            raise CommandError(
                f"--tolerance must be at least 0 and below 1, got {tolerance}"
            )

        presets = WORKFLOW_PRESETS
        if options["preset"]:
            presets = [p for p in presets if p["id"] == options["preset"]]
            if not presets:
                raise CommandError(f"No preset with id {options['preset']!r}")

        baseline = {}
        if BASELINE_PATH.exists():
            baseline = json.loads(BASELINE_PATH.read_text())
        recorded = baseline.pop(PROVENANCE_KEY, None) or {}
        stamp = _dataset_stamp()
        recorded_version = recorded.get("etl_version", version_service.UNKNOWN)
        generated = recorded.get("generated_at")
        self.stdout.write(
            f"Loaded dataset {stamp['etl_version']}; baseline from {recorded_version}"
            + (f" (generated {generated})" if generated else "")
            + (" (mixed restores)" if recorded.get("mixed") else "")
        )
        # One version string can name two different restores, so a dataset is
        # the same only when the restore time matches too. An unrecorded value
        # identifies nothing, and a mixed baseline matches no single restore.
        known = version_service.UNKNOWN not in stamp.values()
        same_dataset = (
            known
            and not recorded.get("mixed")
            and recorded_version == stamp["etl_version"]
            and recorded.get("restored_at") == stamp["restored_at"]
        )
        if not same_dataset:
            # Warn, not fail: a developer on an older dump should be told the
            # comparison crosses datasets, not blocked from sweeping.
            self.stderr.write(
                self.style.WARNING(
                    "Baseline and loaded dataset differ; drops may reflect the "
                    "dataset change rather than a regression."
                )
            )

        results = {}
        failures = []

        for preset in presets:
            preset_id = preset["id"]
            try:
                outcome = workflow_service.execute_preset(preset_id)
            except Exception as exc:  # noqa: BLE001 - report, do not abort the sweep
                failures.append(f"{preset_id}: raised {type(exc).__name__}: {exc}")
                self.stdout.write(f"EXC   {preset_id}")
                continue

            errors = outcome.get("errors") or {}
            phases = outcome.get("phases") or {}
            counts = [
                (pid, len(data.get("nodes") or [])) for pid, data in phases.items()
            ]
            terminal = counts[-1][1] if counts else 0
            results[preset_id] = terminal

            # A null node means an origin no longer resolves; it used to reach the
            # client and break rendering outright.
            nulls = sum(
                1
                for data in phases.values()
                for node in (data.get("nodes") or [])
                if node is None
            )

            trail = " -> ".join(str(n) for _, n in counts)
            if errors:
                failures.append(f"{preset_id}: {errors}")
                self.stdout.write(f"ERR   {preset_id}  [{trail}]")
            elif nulls:
                failures.append(f"{preset_id}: {nulls} null node(s) in results")
                self.stdout.write(f"NULL  {preset_id}  [{trail}]")
            elif terminal == 0:
                failures.append(f"{preset_id}: returned no nodes")
                self.stdout.write(f"EMPTY {preset_id}  [{trail}]")
            else:
                expected = baseline.get(preset_id)
                floor = expected * (1 - tolerance) if expected else None
                if floor is not None and terminal < floor:
                    failures.append(
                        f"{preset_id}: {terminal} nodes, baseline {expected} "
                        f"(below the {tolerance:.0%} tolerance)"
                    )
                    self.stdout.write(
                        f"DROP  {preset_id}  [{trail}]  baseline {expected}"
                    )
                else:
                    self.stdout.write(f"ok    {preset_id}  [{trail}]")

        if options["update_baseline"]:
            # Recording a broken sweep would bake the breakage in as the number
            # to beat, so the next run would report success.
            if failures:
                for failure in failures:
                    self.stderr.write(f"  {failure}")
                raise CommandError(
                    "Refusing to update the baseline while "
                    f"{len(failures)} preset(s) need attention"
                )
            # A targeted update merges: --preset sweeps one id, and writing only
            # that entry would drop every other preset's baseline. The merge is
            # only sound within one restore, or the file would record counts
            # from two datasets under one provenance, unless --allow-mixed says
            # so and the provenance records it. A full update writes only what
            # it swept, so a removed preset's old count is not restamped.
            mixed = bool(options["preset"]) and not same_dataset
            if mixed and not options["allow_mixed"]:
                raise CommandError(
                    "Baseline is not from the loaded restore; run --update-baseline "
                    "without --preset, or pass --allow-mixed"
                )
            merged = {**baseline, **results} if options["preset"] else results
            now = datetime.now(timezone.utc)
            provenance = {**stamp, "generated_at": now.strftime("%Y-%m-%dT%H:%M:%SZ")}
            if mixed:
                provenance["mixed"] = True
            _write_baseline({PROVENANCE_KEY: provenance, **merged})
            self.stdout.write(
                self.style.SUCCESS(
                    f"\nRecorded {len(results)} preset(s) in {BASELINE_PATH.name} "
                    f"({len(merged)} total)"
                )
            )
            return

        self.stdout.write("")
        if failures:
            for failure in failures:
                self.stderr.write(f"  {failure}")
            raise SystemExit(
                f"{len(failures)} of {len(presets)} presets need attention"
            )
        self.stdout.write(
            self.style.SUCCESS(f"All {len(presets)} presets returned data")
        )
