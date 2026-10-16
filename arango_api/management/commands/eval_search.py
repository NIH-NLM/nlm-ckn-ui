"""
Run the golden query list against the loaded dataset and check search ranking.

The golden query list pairs realistic searches with the node a user should find
first; the baseline is each query's rank on the last accepted run. Both, and the
groups and regression rules, are defined in `arango_api/search_eval.py`. CI has
no real dump, so this is a command you run after loading one.

    ./venv/bin/python manage.py eval_search
    ./venv/bin/python manage.py eval_search --update-baseline

Exits non-zero when a query errors, or when a ranking or identifier query or a
group score falls below the baseline. With no baseline it only prints the report.
"""

import json
from datetime import datetime, timezone
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError

from arango_api import search_eval
from arango_api.management.commands import sweep_presets
from arango_api.search_tiers import all_map_fields, maps_path
from arango_api.services.search_service import SearchServiceError, search_by_term

GOLDEN_PATH = Path(__file__).resolve().parents[2] / "search_golden_queries.json"
BASELINE_PATH = Path(__file__).resolve().parents[2] / "search_baselines.json"


class Command(BaseCommand):
    help = "Score search ranking on the golden query list against the baseline."

    def add_arguments(self, parser):
        parser.add_argument("--update-baseline", action="store_true")
        parser.add_argument("--golden", help="Golden query list to use instead.")
        parser.add_argument("--maps", help="Collection maps file to use instead.")

    def handle(self, *args, **options):
        golden_path = Path(options["golden"] or GOLDEN_PATH)
        if not golden_path.exists():
            raise CommandError(f"No golden query list at {golden_path}")
        map_file = Path(options["maps"] or maps_path())
        if not map_file.exists():
            raise CommandError(f"No collection maps at {map_file}; pass --maps")
        golden = search_eval.load_golden(golden_path)
        fields = sorted(all_map_fields(map_file))

        ranks, errors = {entry["query"]: None for entry in golden}, []
        for entry in golden:
            query = entry["query"]
            try:
                results = search_by_term(query, fields, "phenotypes")
            except SearchServiceError as exc:
                results = exc
            if not isinstance(results, list):
                errors.append(f"ERROR {query!r}: search failed ({results})")
            else:
                ids = [doc.get("_id") for doc in results]
                ranks[query] = search_eval.rank_of(ids, entry["expected_ids"])

        stamp = sweep_presets._dataset_stamp()
        baseline, compared = None, {}
        if BASELINE_PATH.exists() and not options["update_baseline"]:
            baseline = json.loads(BASELINE_PATH.read_text())
            compared = search_eval.compare_to_baseline(ranks, baseline["ranks"], golden)
        scores = search_eval.score_groups(ranks, golden)
        self.stdout.write(search_eval.format_report(scores, compared))
        for error in errors:
            self.stderr.write(error)

        if options["update_baseline"]:
            # An errored query has no real rank; recording one would let the
            # next run's failure to find it pass as no change.
            if errors:
                raise CommandError(f"Not updating the baseline: {len(errors)} errored")
            now = datetime.now(timezone.utc)
            stamp["generated_at"] = now.strftime("%Y-%m-%dT%H:%M:%SZ")
            baseline = {"ranks": ranks, sweep_presets.PROVENANCE_KEY: stamp}
            sweep_presets._write_baseline(baseline, BASELINE_PATH)
            self.stdout.write(f"Recorded {len(ranks)} rank(s) in {BASELINE_PATH.name}")
            return

        # One version can name two restores; an "unknown" value identifies none.
        recorded = (baseline or {}).get(sweep_presets.PROVENANCE_KEY, {})
        if baseline is None:
            self.stdout.write("No baseline exists; --update-baseline records one.")
        elif not all(recorded.get(k) == v != "unknown" for k, v in stamp.items()):
            self.stderr.write(
                f"WARNING: baseline is from {recorded.get('etl_version')}, loaded "
                f"dataset is {stamp['etl_version']}; changes may reflect the dataset."
            )
        failed = errors + compared.get("regressions", [])
        failed += compared.get("aggregate_drops", [])
        if failed:
            raise SystemExit(f"{len(failed)} search problem(s) need attention")
