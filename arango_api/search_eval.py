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
A change is rejected only when a ranking or identifier query ranks lower.
"""

import json

REQUIRED_GROUPS = ("ranking", "identifier")
GROUPS = REQUIRED_GROUPS + ("known_gap",)


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
