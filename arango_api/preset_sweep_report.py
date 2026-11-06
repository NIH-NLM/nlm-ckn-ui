"""
Render `manage.py sweep_presets` output as the preset-sweep PR comment (#167).

Standard library only: CI runs this in a job that has neither the PR's code
nor Django, only the sweep's output and the PR's baseline file.

    python -m arango_api.preset_sweep_report SWEEP_OUTPUT BASELINES ETL PIN
"""

import json
import re
import sys

MARKER = "<!-- preset-sweep -->"

# Preset ids come from the PR's code and land in a comment the bot posts, so
# only plain identifiers are accepted; anything else cannot break the table.
LINE = re.compile(
    r"^(?P<status>ok|DROP|EMPTY|ERR|NULL|EXC|SKIP)\s+(?P<preset>[A-Za-z0-9_.-]+)"
    r"(?:\s+\[(?P<trail>(?:\d+(?: -> \d+)*)?)\])?(?:\s+baseline \d+)?\s*$"
)
# The count trail each status carries in sweep_presets output: none for EXC
# and SKIP, possibly empty ([]) for ERR and EMPTY, at least one count otherwise.
NO_TRAIL, MAYBE_EMPTY = {"EXC", "SKIP"}, {"ERR", "EMPTY"}

# Worst first, so the row that needs attention is never below the fold.
ORDER = {"EXC": 0, "ERR": 0, "NULL": 0, "EMPTY": 1, "DROP": 2, "SKIP": 3, "ok": 4}


def parse(sweep_output):
    """[(status, preset, terminal count or None)] for each preset line."""
    rows = []
    for line in sweep_output.splitlines():
        match = LINE.match(line)
        if not match:
            continue
        status, trail = match["status"], match["trail"]
        if status in NO_TRAIL:
            if trail is not None:
                continue
        elif trail is None or (trail == "" and status not in MAYBE_EMPTY):
            continue
        counts = [int(n) for n in trail.split(" -> ")] if trail else []
        rows.append((match["status"], match["preset"], counts[-1] if counts else None))
    return rows


def _delta(now, baseline):
    if not baseline or now is None:
        return ""
    return f"{(now - baseline) / baseline:+.0%}"


def render(sweep_output, baselines, etl_version, pinned_version):
    """The comment body: one table row per preset, worst first."""
    rows = sorted(parse(sweep_output), key=lambda r: (ORDER[r[0]], r[1]))
    header = f"**Preset sweep — ETL `{etl_version}`**"
    if pinned_version and pinned_version != etl_version:
        header += f" (pin was `{pinned_version}`)"
    if not rows:
        # A sweep prints a row for every preset, so none means it stopped first.
        return (
            f"{MARKER}\n{header}\n\n⚠️ The sweep reported no presets: it stopped "
            "before running them. See the workflow run's log.\n"
        )
    lines = [
        MARKER,
        header,
        "",
        "| | preset | baseline | now | Δ |",
        "|---|---|---|---|---|",
    ]
    for status, preset, now in rows:
        baseline = baselines.get(preset)
        if status == "ok":
            glyph, change = "✅", _delta(now, baseline) if baseline else "new"
        elif status == "SKIP":
            glyph, change = "⏭️", "skipped (known gap)"
        elif status == "DROP":
            glyph, change = "⚠️", _delta(now, baseline)
        else:
            glyph, change = "⚠️", "empty" if status == "EMPTY" else status.lower()
        shown = "" if now is None else now
        lines.append(
            f"| {glyph} | `{preset}` | {baseline or ''} | {shown} | {change} |"
        )
    attention = sum(1 for r in rows if r[0] not in ("ok", "SKIP"))
    lines += [
        "",
        f"{len(rows)} presets · {len(rows) - attention} ok or skipped · "
        f"{attention} need attention",
    ]
    return "\n".join(lines) + "\n"


def main(argv):
    sweep_path, baselines_path, etl_version, pinned_version = argv
    with open(sweep_path) as fh:
        sweep_output = fh.read()
    with open(baselines_path) as fh:
        baselines = {k: v for k, v in json.load(fh).items() if not k.startswith("_")}
    sys.stdout.write(render(sweep_output, baselines, etl_version, pinned_version))


if __name__ == "__main__":
    main(sys.argv[1:])
