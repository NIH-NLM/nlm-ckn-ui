"""Search relevance metrics, scored against a golden query list.

A golden query list is a small set of realistic searches, each paired with the
node a user should find first ("T cell" -> CL/0000084). Running it before and
after a ranking change shows, query by query, whether the change helped.
One node is right for each query, so its position is what matters. Per run:
- success@1: share of queries with the expected node first.
- success@5: share with it in the top five, visible without scrolling.
- MRR (mean reciprocal rank, the mean of 1/rank): unlike the two cutoffs, it
  moves when a node climbs from rank 29 to 6, or slips from 2 to 4.

Each query belongs to one group, and the numbers are reported per group:
- ranking: everyday searches by name ("T cell", "kidney").
- identifier: searches by ID ("CL:0000084").
- known_gap: searches not expected to work yet, kept so progress is visible.
Only ranking and identifier queries can cause a change to be rejected (see
baselines below).

A baseline is the rank each query got on the last accepted run. A new run is
compared with it, and the change is rejected if a ranking or identifier query
that was in the top five now ranks lower, or if a group's success@1, success@5
or MRR falls by more than AGGREGATE_TOLERANCE. Group scores are compared only
on queries present in both runs, so adding queries cannot hide a drop. A query
missing from the baseline is reported as new. format_report renders the group
scores and the comparison as a readable text report.
"""

import json

REQUIRED_GROUPS = ("ranking", "identifier")
GROUPS = REQUIRED_GROUPS + ("known_gap",)

# Largest fall allowed in a group's success@1, success@5 or MRR. With about 31
# ranking queries one query is worth about 0.032, so losing even one query from
# first place or the top five is flagged; smaller MRR moves are not.
AGGREGATE_TOLERANCE = 0.03

METRIC_LABELS = {"success_at_1": "success@1", "success_at_5": "success@5", "mrr": "MRR"}


def rank_of(result_ids, expected_ids):
    """1-based rank of the first expected id in the results, else None."""
    expected = set(expected_ids)
    for position, result_id in enumerate(result_ids, start=1):
        if result_id in expected:
            return position
    return None


def success_at(ranks, k):
    """Fraction of queries whose expected id ranked within the top k (0 if none)."""
    if not ranks:
        return 0.0
    return sum(1 for r in ranks if r is not None and r <= k) / len(ranks)


def mrr(ranks):
    """Mean reciprocal rank; a missing rank contributes zero (0 if empty)."""
    if not ranks:
        return 0.0
    return sum(1 / r for r in ranks if r is not None) / len(ranks)


def score_groups(ranks_by_query, golden):
    """Per-group n, success@1, success@5 and MRR (empty groups are omitted)."""
    scores = {}
    for name in GROUPS:
        ranks = [ranks_by_query[g["query"]] for g in golden if g["group"] == name]
        if ranks:
            scores[name] = {
                "n": len(ranks),
                "success_at_1": success_at(ranks, 1),
                "success_at_5": success_at(ranks, 5),
                "mrr": mrr(ranks),
            }
    return scores


def _worse(rank, than):
    """True when `rank` is a worse rank than `than`: a larger number, or not found."""
    if rank == than:
        return False
    return rank is None or (than is not None and rank > than)


def compare_to_baseline(current_ranks, baseline_ranks, golden):
    """Compare this run's ranks with the baseline's, query by query and per group.

    Returns a dict of four lists:
    - regressions: ranking or identifier queries that were in the top five in
      the baseline and now rank lower (or are no longer found).
    - aggregate_drops: group metrics (success@1, success@5, MRR) that fell by
      more than AGGREGATE_TOLERANCE.
    - improvements: queries of any group that now rank higher.
    - new: queries missing from the baseline, which have no earlier rank to
      compare with.
    Group scores use only the queries present in both runs, so adding queries
    cannot hide a drop.
    """
    regressions, improvements, new = [], [], []
    shared = []
    for g in golden:
        query = g["query"]
        now = current_ranks[query]
        if query not in baseline_ranks:
            new.append({"query": query, "current": now})
            continue
        shared.append(g)
        before = baseline_ranks[query]
        change = {"query": query, "baseline": before, "current": now}
        if _worse(before, now):
            improvements.append(change)
        elif _worse(now, before) and g["group"] in REQUIRED_GROUPS:
            if before is not None and before <= 5:
                regressions.append(change)
    now_scores = score_groups(current_ranks, shared)
    before_scores = score_groups(baseline_ranks, shared)
    aggregate_drops = []
    for name in REQUIRED_GROUPS:
        if name not in now_scores:
            continue
        for metric in METRIC_LABELS:
            before, now = before_scores[name][metric], now_scores[name][metric]
            # Rounding keeps a drop of exactly the tolerance from being flagged
            # by floating-point noise.
            if round(before - now, 9) > AGGREGATE_TOLERANCE:
                aggregate_drops.append(
                    {
                        "group": name,
                        "metric": metric,
                        "baseline": before,
                        "current": now,
                    }
                )
    return {
        "regressions": regressions,
        "aggregate_drops": aggregate_drops,
        "improvements": improvements,
        "new": new,
    }


def _rank_text(rank):
    """A rank as report text: the number, or "not found"."""
    return "not found" if rank is None else str(rank)


def format_report(scores, comparison=None):
    """Text table of the per-group scores, for people to read.

    When a comparison is given, its regressions, aggregate drops, improvements
    (including known_gap progress) and new queries are listed below the table.
    """
    comparison = comparison or {}
    labels = list(METRIC_LABELS.values())
    lines = [f"{'group':<12}{'n':>4}" + "".join(f"{label:>11}" for label in labels)]
    for name, s in scores.items():
        values = (s[metric] for metric in METRIC_LABELS)
        lines.append(f"{name:<12}{s['n']:>4}" + "".join(f"{v:>11.2f}" for v in values))
    for r in comparison.get("regressions", []):
        lines.append(
            f"REGRESSION {r['query']!r}: "
            f"{_rank_text(r['baseline'])} -> {_rank_text(r['current'])}"
        )
    for d in comparison.get("aggregate_drops", []):
        lines.append(
            f"REGRESSION {d['group']} {METRIC_LABELS[d['metric']]}: "
            f"{d['baseline']:.2f} -> {d['current']:.2f}"
        )
    for i in comparison.get("improvements", []):
        lines.append(
            f"IMPROVED {i['query']!r}: "
            f"{_rank_text(i['baseline'])} -> {_rank_text(i['current'])}"
        )
    for n in comparison.get("new", []):
        lines.append(f"NEW {n['query']!r}: {_rank_text(n['current'])}")
    return "\n".join(lines)


def load_golden(path):
    """Load and validate the golden query list; ValueError names a bad entry."""
    with open(path, encoding="utf-8") as fh:
        entries = json.load(fh)
    if not isinstance(entries, list):
        raise ValueError("golden file must be a list of entries")
    seen = set()
    for index, entry in enumerate(entries):
        if not isinstance(entry, dict):
            raise ValueError(f"golden entry {index}: must be an object: {entry!r}")
        query = entry.get("query")
        expected = entry.get("expected_ids")
        problem = None
        if not isinstance(query, str) or not query:
            problem = "query must be a non-empty string"
        elif not isinstance(expected, list) or not expected:
            problem = "expected_ids must be a non-empty list"
        elif not all(isinstance(i, str) for i in expected):
            problem = "expected_ids must all be strings"
        elif entry.get("group") not in GROUPS:
            problem = f"group must be one of {GROUPS}"
        elif query in seen:
            problem = "duplicate query"
        if problem:
            raise ValueError(f"golden entry {index}: {problem}: {query!r}")
        seen.add(query)
    return entries
