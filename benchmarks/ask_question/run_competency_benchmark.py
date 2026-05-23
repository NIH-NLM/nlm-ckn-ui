#!/usr/bin/env python
"""Run Ask a Question competency questions against the local Django service layer."""

import argparse
import json
import os
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
QUESTIONS_PATH = ROOT / "benchmarks" / "ask_question" / "competency_questions.json"
OUTPUT_PATH = ROOT / "benchmarks" / "ask_question" / "competency_results.json"

if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "core.settings")

import django  # noqa: E402

django.setup()

from django.conf import settings  # noqa: E402

from arango_api.services.question_service import QuestionServiceError, answer_question  # noqa: E402


def collections_in(nodes):
    collections = set()
    for node in nodes or []:
        node_id = node.get("_id") or node.get("id") or ""
        collection = node.get("collection") or node_id.split("/", 1)[0]
        if collection:
            collections.add(collection)
    return collections


def run_question(item):
    try:
        result = answer_question(item["question"], graph="auto", mode="new", history=[])
    except QuestionServiceError as exc:
        return {
            **item,
            "ok": False,
            "error": str(exc),
            "row_count": 0,
            "node_count": 0,
            "link_count": 0,
            "found_targets": [],
            "missing_targets": item.get("expected_targets", []),
        }

    found = collections_in(result.get("nodes") or [])
    expected = set(item.get("expected_targets") or [])
    missing = sorted(expected - found)
    row_count = len(result.get("rows") or [])
    node_count = len(result.get("nodes") or [])
    link_count = len(result.get("links") or [])
    return {
        **item,
        "ok": row_count > 0 and not missing,
        "row_count": row_count,
        "node_count": node_count,
        "link_count": link_count,
        "found_targets": sorted(found & expected),
        "missing_targets": missing,
        "used_openai": result.get("used_openai"),
        "queried_graphs": result.get("queried_graphs") or [result.get("graph")],
        "answer": result.get("answer", ""),
    }


def parse_args():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "limit",
        nargs="?",
        type=int,
        help="Optional number of competency questions to run.",
    )
    parser.add_argument(
        "--no-umls",
        action="store_true",
        help="Disable UMLS term expansion for a deterministic local-only benchmark.",
    )
    parser.add_argument(
        "--start",
        type=int,
        default=1,
        help="1-based competency question index to start from.",
    )
    return parser.parse_args()


def main():
    args = parse_args()
    if args.no_umls:
        settings.UMLS_API_KEY = ""

    questions = json.loads(QUESTIONS_PATH.read_text())
    start_index = max(args.start - 1, 0)
    limit = args.limit if args.limit else len(questions) - start_index
    results = []
    selected_questions = questions[start_index : start_index + limit]
    for offset, item in enumerate(selected_questions, start=1):
        index = start_index + offset
        print(f"RUN {offset}/{len(selected_questions)} ({index}) {item['id']}: {item['question']}", flush=True)
        started = time.monotonic()
        result = run_question(item)
        result["elapsed_seconds"] = round(time.monotonic() - started, 2)
        results.append(result)
        status = "PASS" if result["ok"] else "FAIL"
        print(
            f"{status} {item['id']} elapsed={result['elapsed_seconds']}s "
            f"rows={result['row_count']} nodes={result['node_count']} "
            f"links={result['link_count']} missing={','.join(result['missing_targets']) or '-'}",
            flush=True,
        )
    OUTPUT_PATH.write_text(json.dumps(results, indent=2))

    passed = sum(1 for item in results if item["ok"])
    print(f"Passed {passed}/{len(results)} competency questions")
    for item in results:
        status = "PASS" if item["ok"] else "FAIL"
        print(
            f"{status} {item['id']} rows={item['row_count']} nodes={item['node_count']} "
            f"links={item['link_count']} missing={','.join(item['missing_targets']) or '-'}"
        )
    print(f"Results written to {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
