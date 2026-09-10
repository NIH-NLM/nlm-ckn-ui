#!/usr/bin/env python3
"""Regenerate react/src/assets/plot-manifest.json from the published plot assets.

Each nlm-ckn release publishes a set of per-dataset quality-control figures
(nlm-ckn#283). They are served from the frontend bucket alongside the app, so
displaying one is just a URL — but nothing in the graph says which URL. A cell
set dataset document carries no plot attribute, and the paths cannot be
reconstructed from the ones it does carry: the plot pipeline writes its own
author, journal and year strings, which disagree with `Citation` often enough to
matter ("Am J Respir Cell Mol Biol" vs the full journal name, "Nat Commun-2023.0"
with a float year, "Dominguez_Conde" for "Domínguez Conde"). Deriving the path
from the document gets 78 of 84 datasets and fails silently on the rest.

So the paths are enumerated once, here, and committed as a manifest the UI reads
directly. Rerun this when ETL_VERSION moves to a release built from a different
nlm-ckn tag; the tag is recorded in the manifest so a stale one is visible in the
diff rather than at runtime.

    ./scripts/dev/build-plot-manifest.py              # resolve the tag from ETL_VERSION
    ./scripts/dev/build-plot-manifest.py --tag v1.0.0-rc.10

Datasets are keyed by anatomical structure and the last six characters of the
dataset UUID, which is what the published directory names carry. That is enough
to be unique: across the 89 CSD documents in v1.7.0-rc.1 the pair collides for
none of them, and every published directory matches exactly one document.

Figures are recorded per file that actually exists. Coverage is not uniform —
five datasets have no stacked violin plot and one has no interactive silhouette
page — and an absent entry is how the UI knows to leave the figure out rather
than link to a 404.
"""

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_OUT = REPO_ROOT / "react" / "src" / "assets" / "plot-manifest.json"

# The three figures nlm-ckn#283 asks for, in the order the UI shows them, mapped
# to the extensions worth recording. The silhouette summary is published both as
# an interactive plotly page and as a flat SVG; the UI prefers the page and falls
# back to the SVG, so both are recorded.
FIGURES = {
    "silhouette_fscore_summary": ("html", "svg"),
    "dendrogram": ("svg",),
    "stacked_violin": ("svg",),
}

# Same-prefix figures that are NOT the one we want. "dendrogram_before_filter_"
# is a different plot; "<figure>__scaled" is a rescaled variant of one.
EXCLUDED = re.compile(r"^(dendrogram_before_filter_|[a-z_]+__scaled)")

# plots/<tag>/<anatomical structure>/sc-nsforest-qc-nf/results/<dataset dir>/<file>
KEY_PATTERN = re.compile(
    r"^(?P<anatomy>[^/]+)/sc-nsforest-qc-nf/results/(?P<dataset>[^/]+)/(?P<filename>[^/]+)$"
)

# Trailing "-<hash>" of a published dataset directory name.
HASH_PATTERN = re.compile(r"-(?P<hash>[0-9a-f]{6})$")


def build_manifest(tag, keys):
    """Group published plot keys into the manifest the UI consumes.

    Args:
        tag: the nlm-ckn release tag the keys were published under.
        keys: object keys relative to ``plots/<tag>/``.

    Returns:
        A dict with the tag and a ``datasets`` map, keyed by
        ``<anatomical structure>/<last six of the dataset UUID>``.
    """
    datasets = {}
    for key in keys:
        match = KEY_PATTERN.match(key)
        if not match:
            # _vendor/plotly-*.min.js, and anything else outside the per-dataset
            # results tree. Not an error: the UI never addresses those by name.
            continue
        directory = match["dataset"]
        hash_match = HASH_PATTERN.search(directory)
        if not hash_match:
            print(f"warning: no dataset hash in directory {directory!r}", file=sys.stderr)
            continue

        filename = match["filename"]
        if EXCLUDED.match(filename):
            continue
        for figure, extensions in FIGURES.items():
            extension = filename.rsplit(".", 1)[-1]
            if not filename.startswith(f"{figure}_") or extension not in extensions:
                continue
            entry = datasets.setdefault(
                f"{match['anatomy']}/{hash_match['hash']}",
                {"dir": f"{match['anatomy']}/sc-nsforest-qc-nf/results/{directory}", "figures": {}},
            )
            entry["figures"].setdefault(figure, {})[extension] = filename
            break

    return {"tag": tag, "datasets": dict(sorted(datasets.items()))}


def aws(*args):
    """Run an aws CLI command, returning stdout and failing loudly."""
    result = subprocess.run(
        ["aws", *args], capture_output=True, text=True, check=False
    )
    if result.returncode != 0:
        sys.exit(f"aws {' '.join(args)} failed:\n{result.stderr.strip()}")
    return result.stdout


def ssm_parameter(name, override, flag):
    """Read a shared SSM parameter, as the deploy scripts do.

    The deploy role can read these; an individual developer's credentials
    generally cannot, so every lookup has a flag that skips it.
    """
    if override:
        return override
    result = subprocess.run(
        ["aws", "ssm", "get-parameter", "--name", name,
         "--query", "Parameter.Value", "--output", "text"],
        capture_output=True, text=True, check=False,
    )
    if result.returncode != 0:
        sys.exit(
            f"could not read SSM parameter {name}:\n{result.stderr.strip()}\n"
            f"Pass {flag} to name the bucket directly."
        )
    return result.stdout.strip()


def resolve_tag(dataset_bucket):
    """Resolve ETL_VERSION to an nlm-ckn tag through the release config.

    The same hop scripts/app/deploy-assets.sh makes, so the manifest is built
    for the tag whose assets that script deploys.
    """
    etl_version = (REPO_ROOT / "ETL_VERSION").read_text().strip()
    if not etl_version:
        sys.exit("ETL_VERSION is empty; pass --tag instead.")
    bucket = ssm_parameter(
        "/nlm-ckn/shared/arangodb-bucket-name", dataset_bucket, "--dataset-bucket"
    )
    uri = f"s3://{bucket}/runs/{etl_version}/release.json"
    tag = json.loads(aws("s3", "cp", uri, "-")).get("nlm_ckn_tag", "").strip()
    if not tag:
        sys.exit(f"{uri} has no non-empty nlm_ckn_tag; pass --tag instead.")
    print(f"ETL_VERSION {etl_version} -> nlm-ckn tag {tag}", file=sys.stderr)
    return tag


def list_keys(tag, static_assets_bucket):
    """List every published object under a tag, relative to its prefix."""
    bucket = ssm_parameter(
        "/nlm-ckn/shared/static-assets-bucket-name",
        static_assets_bucket,
        "--static-assets-bucket",
    )
    prefix = f"plots/{tag}/"
    # JSON rather than the text output the shell scripts use: published directory
    # names contain spaces ("respiratory_system-Guo-Nat Commun-2023.0-3058a2"),
    # which any whitespace-splitting of `--output text` would tear in half.
    listing = aws(
        "s3api", "list-objects-v2",
        "--bucket", bucket,
        "--prefix", prefix,
        "--query", "Contents[].Key",
        "--output", "json",
    )
    keys = [key[len(prefix):] for key in json.loads(listing) or [] if key.startswith(prefix)]
    if not keys:
        sys.exit(f"s3://{bucket}/{prefix} is empty — were this tag's assets published?")
    return keys


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--tag", help="nlm-ckn tag to enumerate (default: resolve from ETL_VERSION)")
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT, help=f"default: {DEFAULT_OUT}")
    parser.add_argument("--static-assets-bucket", help="skip the SSM lookup for the plots bucket")
    parser.add_argument("--dataset-bucket", help="skip the SSM lookup for the release.json bucket")
    args = parser.parse_args()

    tag = args.tag or resolve_tag(args.dataset_bucket)
    manifest = build_manifest(tag, list_keys(tag, args.static_assets_bucket))
    args.out.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n")

    figures = sum(len(entry["figures"]) for entry in manifest["datasets"].values())
    print(f"{args.out.relative_to(REPO_ROOT)}: {len(manifest['datasets'])} datasets, {figures} figures")


if __name__ == "__main__":
    main()
