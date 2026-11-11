#!/bin/bash
# ==============================================================================
# deploy-assets.sh - Copy static plot assets into an environment's frontend bucket
# ==============================================================================
# Copies one nlm-ckn release's published plot assets from the shared
# static-assets bucket into the environment's frontend S3 bucket, then
# invalidates the CDN for that prefix.
#
#   s3://<shared static-assets bucket>/plots/<nlm-ckn tag>/...
#     -> s3://<env frontend bucket>/plots/<nlm-ckn tag>/...
#
# The assets are published once per nlm-ckn release tag by that repo's
# publish-plot-assets.yml (~2,850 objects, ~500 MB stored). Design, rationale
# and the surrounding work breakdown: docs/static-asset-copy-plan.md.
#
# USAGE:
#   ./scripts/app/deploy-assets.sh [--tag <nlm-ckn tag>] [--force] [--prune [N]] <environment>
#
# ARGUMENTS:
#   environment    Environment name: dev, stage, or prod (sandbox is blocked —
#                  see the guard below), or any environment with a
#                  scripts/envs/<env>.conf file (see scripts/env-config.sh)
#   --tag TAG      Copy this nlm-ckn tag instead of the one the pinned
#                  ETL_VERSION resolves to. No default: an ad-hoc escape hatch,
#                  not a fallback.
#   --force        Re-copy even when the destination prefix already holds the
#                  same number of objects as the source.
#   --prune [N]    Delete all but the N most recently written plots/<tag>/
#                  prefixes in the destination (default N=3), keeping the tag
#                  this run deployed regardless. Runs whether or not this run
#                  copied anything, so it works on an already-current
#                  environment. Prompts when run interactively.
#
# HOW THE TAG IS RESOLVED (see the plan doc for why each hop is safe):
#   ETL_VERSION (repo root)
#     -> s3://<arangodb bucket>/runs/<ETL_VERSION>/release.json
#          -> .nlm_ckn_tag
#               -> s3://<static assets bucket>/plots/<nlm_ckn_tag>/
#   Every failure in that chain is fatal. A wrong tag here means a successful
#   deploy with a bucket full of the wrong release's plots.
#
# WHAT IT DOES:
#   1. Resolves the nlm-ckn tag and both bucket names
#   2. Refuses to run for sandbox (its ALB->Lambda path cannot serve these)
#   3. Verifies the source prefix exists and is non-empty
#   4. Skips when the destination already matches, unless --force
#   5. Syncs the prefix (no --delete, no metadata flags — see the copy step)
#   6. Verifies the key sets match and that Content-Encoding: gzip survived
#   7. Invalidates /plots/<tag>/* only (never /*)
#   8. Fetches a sample SVG, plotly page, and the page's relative plotly src
#      over the public URL, then prints those URLs to check in a browser
#      (advisory — never fails the deploy)
#   9. Prunes older tag prefixes, with --prune
#
# ORDERING: run this BEFORE deploy-dataset.sh. Nothing references the new
# prefix until the dataset that links to it goes live, so copying first means
# the URLs are backed by objects the moment the database swaps.
#
# PREREQUISITES:
#   - ETL_VERSION file at the repository root (unless --tag is given)
#   - AWS credentials with read on the shared static-assets bucket's plots/*
#     and write on the frontend bucket's plots/*
#   - The frontend bucket stack (${PROJECT_NAME}-<env>-frontend) deployed
#
# ENVIRONMENT VARIABLES (optional):
#   AWS_REGION     AWS region (default: us-east-1)
# ==============================================================================
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/../common.sh"
source "$SCRIPT_DIR/../env-config.sh"
AWS_REGION=${AWS_REGION:-us-east-1}

# ── Arguments ────────────────────────────────────────────────────────────────
TAG=""
FORCE=false
PRUNE=false
PRUNE_KEEP=3
POSITIONAL=()
while [[ $# -gt 0 ]]; do
  case $1 in
    --tag) TAG="${2:?--tag requires a value}"; shift 2 ;;
    --tag=*) TAG="${1#*=}"; shift ;;
    --force) FORCE=true; shift ;;
    --prune)
      PRUNE=true; shift
      # Optional numeric argument; anything else belongs to the next flag or
      # the positional environment.
      if [[ ${1:-} =~ ^[0-9]+$ ]]; then PRUNE_KEEP="$1"; shift; fi ;;
    --prune=*) PRUNE=true; PRUNE_KEEP="${1#*=}"; shift ;;
    -h|--help) sed -n '2,60p' "$0"; exit 0 ;;
    -*) echo -e "${RED}Unknown option: $1 (try --help)${NC}" >&2; exit 1 ;;
    *) POSITIONAL+=("$1"); shift ;;
  esac
done

if [ ${#POSITIONAL[@]} -ne 1 ]; then
  echo "Usage: $0 [--tag <nlm-ckn tag>] [--force] [--prune [N]] <environment>"
  echo "Example: $0 dev"
  exit 1
fi
ENVIRONMENT="${POSITIONAL[0]}"

# Config-file environments (scripts/envs/<env>.conf) live in another account and
# name every resource explicitly; dev/stage/prod resolve from stack outputs.
CONFIG_ENV=false
if ckn_has_env_config "$ENVIRONMENT"; then
  CONFIG_ENV=true
elif [[ ! "$ENVIRONMENT" =~ ^(dev|stage|sandbox|prod)$ ]]; then
  echo -e "${RED}Error: unknown environment '${ENVIRONMENT}'.${NC}"
  echo "Expected dev, stage, prod, sandbox, or one with a config file: $(ckn_env_config_names)"
  exit 1
fi

if [[ "$PRUNE" == true && ( ! "$PRUNE_KEEP" =~ ^[0-9]+$ || "$PRUNE_KEEP" -lt 1 ) ]]; then
  echo -e "${RED}Error: --prune requires a positive keep count (got '${PRUNE_KEEP}')${NC}"
  exit 1
fi

# ── Guard: sandbox cannot serve these objects yet ────────────────────────────
# Sandbox has no CloudFront; it serves the frontend bucket through an
# ALB -> Lambda target (nlm-ckn-iac
# environment/sandbox/cloudformation/alb-s3-lambda-target-group.yaml). That
# handler drops Content-Encoding, UTF-8-decodes image/svg+xml (corrupting gzip
# bytes), and rejects objects over MAX_OBJECT_BYTES=700,000 — which the ~1 MB
# vendored plotly bundle exceeds. Copying assets there produces blank plots and
# corrupted SVGs, not a partial success. This is a hard stop, not a silent skip:
# it must fail loudly if a caller wires sandbox in before the IaC fix lands
# (work item 6 in docs/static-asset-copy-plan.md).
if [ "$ENVIRONMENT" = "sandbox" ]; then
  echo -e "${RED}Error: static plot assets must not be copied into sandbox yet.${NC}"
  echo "The sandbox ALB->Lambda path cannot serve pre-gzipped objects:"
  echo "  - Content-Encoding is not forwarded"
  echo "  - image/svg+xml is UTF-8 decoded (corrupts gzip bytes)"
  echo "  - objects over MAX_OBJECT_BYTES (700,000) return 413"
  echo "See docs/static-asset-copy-plan.md ('Blocker: the ALB->Lambda path')."
  exit 1
fi

# ── Helper: fetch selected outputs from a stack as \"Key<TAB>Value\" lines ─────
# Same contract as deploy-frontend.sh: empty (and non-error) only when the stack
# genuinely does not exist. Any other describe-stacks failure (permissions,
# credentials, throttling) is propagated so a caller can't silently treat it as
# "absent" and skip the CDN invalidation.
fetch_stack_outputs() {
  local out
  if out=$(aws cloudformation describe-stacks \
    --stack-name "$1" \
    --region "$AWS_REGION" \
    --query 'Stacks[0].Outputs[?OutputKey==`BucketName` || OutputKey==`CloudFrontDistributionId` || OutputKey==`FrontendUrl`].[OutputKey,OutputValue]' \
    --output text 2>&1); then
    printf '%s\n' "$out"
    return 0
  fi
  if printf '%s' "$out" | grep -q 'does not exist'; then
    return 0
  fi
  echo -e "${RED}Error: describe-stacks failed for $1:${NC}" >&2
  printf '%s\n' "$out" >&2
  return 1
}

# ── Helper: read an SSM parameter, failing with a useful message ─────────────
get_ssm_parameter() {
  local name="$1" hint="$2" value
  value=$(aws ssm get-parameter \
    --name "$name" \
    --query 'Parameter.Value' \
    --output text \
    --region "$AWS_REGION" 2>/dev/null) || {
    echo -e "${RED}Error: could not read SSM parameter ${name}${NC}" >&2
    echo "$hint" >&2
    return 1
  }
  if [ -z "$value" ] || [ "$value" = "None" ]; then
    echo -e "${RED}Error: SSM parameter ${name} is empty${NC}" >&2
    return 1
  fi
  printf '%s\n' "$value"
}

# ── Helper: list object keys under a prefix, relative to that prefix ─────────
# list-objects-v2 auto-paginates, so this is complete for the ~2,850-object
# prefixes we deal with. An absent/empty prefix yields no lines rather than an
# error, which is what the "does the source exist" check below tests for.
list_relative_keys() {
  local bucket="$1" prefix="$2"
  aws s3api list-objects-v2 \
    --bucket "$bucket" \
    --prefix "$prefix" \
    --query 'Contents[].Key' \
    --output text \
    --region "$AWS_REGION" \
    | tr '\t' '\n' \
    | sed -e "s|^${prefix}||" -e '/^None$/d' -e '/^$/d' \
    | LC_ALL=C sort
}

# ── Prune older tag prefixes ─────────────────────────────────────────────────
# Retention is bounded by tidiness, not cost (~500 MB / a few cents a month per
# tag). Keep the current and previous tag at minimum so a dataset rollback still
# has plots. This is an explicit mode rather than a bucket lifecycle rule: a
# prefix-scoped lifecycle rule would silently expire the prefix a rollback
# depends on.
prune_old_prefixes() {
  echo ""
  echo -e "${GREEN}==> Pruning to the ${PRUNE_KEEP} most recent tag prefixes...${NC}"
  local ALL_PREFIXES RANKED DOOMED last p reply
  ALL_PREFIXES=$(aws s3api list-objects-v2 \
    --bucket "$DST_BUCKET" \
    --prefix 'plots/' \
    --delimiter '/' \
    --query 'CommonPrefixes[].Prefix' \
    --output text \
    --region "$AWS_REGION" | tr '\t' '\n' | sed -e '/^None$/d' -e '/^$/d')

  # Order by the most recent write within each prefix; S3 has no prefix
  # timestamp, and sorting release tags lexically would misplace rc builds.
  RANKED=""
  while read -r p; do
    [ -n "$p" ] || continue
    last=$(aws s3api list-objects-v2 \
      --bucket "$DST_BUCKET" --prefix "$p" \
      --query 'max_by(Contents, &LastModified).LastModified' \
      --output text --region "$AWS_REGION" 2>/dev/null || echo "")
    # Guarded with `if` rather than `&&`: a failing test as the last command in
    # a loop body would trip `set -e`.
    if [ -n "$last" ] && [ "$last" != "None" ]; then
      RANKED+="${last}	${p}"$'\n'
    fi
  done <<< "$ALL_PREFIXES"

  DOOMED=$(printf '%s' "$RANKED" | LC_ALL=C sort -r | tail -n +$((PRUNE_KEEP + 1)) | cut -f2)
  # Never prune what we just deployed, whatever the ordering says.
  DOOMED=$(printf '%s\n' "$DOOMED" | grep -Fxv "$PREFIX" || true)

  if [ -z "$DOOMED" ]; then
    echo "  Nothing to prune."
  else
    echo -e "${YELLOW}These prefixes will be permanently deleted:${NC}"
    printf '%s\n' "$DOOMED" | sed 's|^|    s3://'"$DST_BUCKET"'/|'
    if [ -t 0 ]; then
      read -r -p "Delete them? [y/N] " reply
      [[ "$reply" =~ ^[Yy]$ ]] || { echo "  Skipped."; DOOMED=""; }
    fi
    while read -r p; do
      [ -n "$p" ] || continue
      echo "  Deleting s3://${DST_BUCKET}/${p}"
      aws s3 rm "s3://${DST_BUCKET}/${p}" --recursive --only-show-errors --region "$AWS_REGION"
    done <<< "$DOOMED"
  fi
}


# ── Sample URLs + edge smoke test ────────────────────────────────────────────
# Advisory, and deliberately so — same contract as deploy-frontend.sh's smoke
# test. The authoritative checks already ran against S3 above (every source key
# present, Content-Encoding intact). This one confirms the objects are reachable
# the way a browser reaches them, and leaves URLs on screen to eyeball.
#
# `--compressed` is NOT optional. CloudFront's CachingOptimized policy
# normalizes Accept-Encoding into the cache key, so a bare `curl -I` (which
# sends no Accept-Encoding at all) lands on a different cache key than every
# real browser and therefore always reports `x-cache: Miss`. Sending the
# browser's header is both the realistic test and the only way to read x-cache
# correctly. Anyone spot-checking these URLs by hand should do the same.

# Percent-encode a key for use in a URL; plot paths can contain spaces.
url_encode_path() {
  python3 -c 'import sys, urllib.parse; print(urllib.parse.quote(sys.argv[1]))' "$1"
}

# Probe one URL. Prints a PASS/FAIL line; returns 1 on anything but a 200 that
# still carries Content-Encoding: gzip.
probe_url() {
  local label="$1" url="$2" headers status encoding
  headers=$(curl -sSI --compressed --max-time 20 "$url" 2>/dev/null) || headers=""
  status=$(printf '%s' "$headers" | awk 'NR==1 {print $2}' | tr -d '\r')
  encoding=$(printf '%s' "$headers" | awk 'tolower($1) == "content-encoding:" {print $2}' | tr -d '\r')
  if [ "$status" = "200" ] && [ "$encoding" = "gzip" ]; then
    echo -e "  ${GREEN}PASS${NC} $label (200, gzip)"
    return 0
  fi
  echo -e "  ${RED}FAIL${NC} $label — HTTP ${status:-no response}, Content-Encoding ${encoding:-none}"
  echo "       $url"
  return 1
}

check_edge_and_print_urls() {
  local SAMPLE_SVG SAMPLE_HTML SVG_URL HTML_URL VENDOR_URL VENDOR_SRC EDGE_OK
  SAMPLE_SVG=$(printf '%s\n' "$SRC_KEYS" | grep -m1 '\.svg$' || true)
  SAMPLE_HTML=$(printf '%s\n' "$SRC_KEYS" | grep -m1 '\.html$' || true)

  echo ""
  if [ -z "$BASE_URL" ]; then
  echo -e "${YELLOW}==> Skipping edge check — $NO_URL_REASON.${NC}"
  echo "  Objects are in place at s3://${DST_BUCKET}/${PREFIX} but have no public URL yet."
  else
  echo -e "${GREEN}==> Checking the assets over ${BASE_URL}...${NC}"
  EDGE_OK=true

  SVG_URL=""
  if [ -n "$SAMPLE_SVG" ]; then
    SVG_URL="${BASE_URL}/$(url_encode_path "${PREFIX}${SAMPLE_SVG}")"
    probe_url "SVG" "$SVG_URL" || EDGE_OK=false
  fi

  HTML_URL=""
  VENDOR_URL=""
  if [ -n "$SAMPLE_HTML" ]; then
    HTML_URL="${BASE_URL}/$(url_encode_path "${PREFIX}${SAMPLE_HTML}")"
    probe_url "plotly page" "$HTML_URL" || EDGE_OK=false

    # The check that actually proves the copy is usable: the pages reference
    # plotly by a document-relative src (../../../../_vendor/plotly-<ver>.min.js),
    # which only resolves if the served path mirrors the S3 key layout. Pull the
    # src out of the page as delivered and follow it.
    VENDOR_SRC=$(curl -s --compressed --max-time 30 "$HTML_URL" \
      | grep -m1 -oE 'src="[^"]*_vendor/[^"]*"' \
      | sed -e 's/^src="//' -e 's/"$//') || VENDOR_SRC=""
    if [ -n "$VENDOR_SRC" ]; then
      VENDOR_URL=$(python3 -c \
        'import sys, urllib.parse; print(urllib.parse.urljoin(sys.argv[1], sys.argv[2]))' \
        "$HTML_URL" "$VENDOR_SRC")
      probe_url "vendored plotly via the page's relative src" "$VENDOR_URL" || EDGE_OK=false
    else
      echo -e "  ${YELLOW}SKIP${NC} could not find a _vendor src in the page to follow"
    fi
  fi

  if [ "$EDGE_OK" = true ]; then
    echo -e "  ${GREEN}✓ assets are reachable over the CDN${NC}"
  else
    # Non-blocking: the objects are verified in S3, and a fresh prefix can
    # briefly 404 at an edge that cached a miss before the copy landed. Retry
    # the URLs by hand before treating this as a real failure.
    echo -e "  ${YELLOW}Edge check reported failures (non-blocking — the S3-side"
    echo -e "  verification above passed). Retry the URLs in a minute; if they"
    echo -e "  still fail, check the bucket policy and the CDN behaviors.${NC}"
  fi

  echo ""
  echo -e "${GREEN}==> Verify in a browser:${NC}"
  if [ -n "$HTML_URL" ];   then echo "  plotly page   : $HTML_URL"; fi
  if [ -n "$SVG_URL" ];    then echo "  static SVG    : $SVG_URL"; fi
  if [ -n "$VENDOR_URL" ]; then echo "  plotly bundle : $VENDOR_URL"; fi
  echo ""
  echo "  The page should render an interactive plot with no console errors."
  echo "  Spot-check headers with:  curl -sI --compressed '<url>'"
  echo "  (without --compressed, x-cache always reads Miss — see the note above)"
  fi
}


if [ "$CONFIG_ENV" = true ]; then
  # Assumes the target account's role; everything below runs under it, and the
  # springbok source buckets are read cross-account.
  echo -e "${GREEN}==> Loading scripts/envs/${ENVIRONMENT}.conf...${NC}"
  ckn_load_env_config "$ENVIRONMENT"
  ckn_require CKN_FRONTEND_BUCKET CKN_STATIC_ASSETS_BUCKET
  if [ -z "$TAG" ]; then ckn_require CKN_ARANGO_BUCKET; fi
  ckn_resolve CKN_CF_DIST_ID CKN_FRONTEND_URL
fi

echo -e "${GREEN}==> Resolving release tag and buckets...${NC}"

# ── Source bucket (shared, written by nlm-ckn's publish-plot-assets.yml) ─────
if [ "$CONFIG_ENV" = true ]; then
  SRC_BUCKET="$CKN_STATIC_ASSETS_BUCKET"
else
  SRC_BUCKET=$(get_ssm_parameter \
    "/${PROJECT_NAME}/shared/static-assets-bucket-name" \
    "Make sure the shared static-assets stack (nlm-ckn-iac shared/cloudformation/static-assets.yaml) is deployed.")
fi

# ── Tag ──────────────────────────────────────────────────────────────────────
# Without --tag, resolve it through release.json. `nlm_ckn_tag` there is the tag
# the ETL built from, i.e. the tag whose plots the graph will reference. It is
# not independently verified against what publish-plot-assets.yml actually
# pushed — the "source prefix is non-empty" check below is what catches an ETL
# release built from a tag whose assets were never published.
if [ -n "$TAG" ]; then
  echo "  nlm-ckn tag  : $TAG  (explicit --tag)"
else
  ETL_VERSION_FILE="$SCRIPT_DIR/../../ETL_VERSION"
  if [ ! -f "$ETL_VERSION_FILE" ]; then
    echo -e "${RED}Error: ETL_VERSION file not found at $ETL_VERSION_FILE${NC}"
    echo "Pass --tag <nlm-ckn tag> to copy a specific release instead."
    exit 1
  fi
  ETL_VERSION=$(tr -d '[:space:]' < "$ETL_VERSION_FILE")
  if [ -z "$ETL_VERSION" ]; then
    echo -e "${RED}Error: ETL_VERSION file is empty${NC}"
    exit 1
  fi

  # Same bucket deploy-dataset.sh resolves, read under the same role — so this
  # lookup needs no new IAM.
  if [ "$CONFIG_ENV" = true ]; then
    DATASET_BUCKET="$CKN_ARANGO_BUCKET"
  else
    DATASET_BUCKET=$(get_ssm_parameter \
      "/${PROJECT_NAME}/shared/arangodb-bucket-name" \
      "Make sure the shared-resources stack is deployed.")
  fi

  RELEASE_JSON_URI="s3://${DATASET_BUCKET}/runs/${ETL_VERSION}/release.json"
  RELEASE_JSON=$(aws s3 cp "$RELEASE_JSON_URI" - --region "$AWS_REGION" 2>/dev/null) || {
    echo -e "${RED}Error: could not read ${RELEASE_JSON_URI}${NC}"
    echo "trigger-release.sh in nlm-ckn-etl uploads this for every release."
    echo "For a run that predates the convention, pass --tag <nlm-ckn tag>."
    exit 1
  }
  TAG=$(printf '%s' "$RELEASE_JSON" | python3 -c '
import json, sys
try:
    tag = json.load(sys.stdin).get("nlm_ckn_tag")
except json.JSONDecodeError as exc:
    sys.exit("release.json is not valid JSON: %s" % exc)
if not tag or not str(tag).strip():
    sys.exit("release.json has no non-empty nlm_ckn_tag key")
print(str(tag).strip())
') || {
    echo -e "${RED}Error: could not resolve nlm_ckn_tag from ${RELEASE_JSON_URI}${NC}"
    echo "Pass --tag <nlm-ckn tag> to copy a specific release instead."
    exit 1
  }
  # Echo the mapping before anything is copied — this is the line to eyeball
  # against release.json when verifying a deploy.
  echo "  ETL_VERSION  : $ETL_VERSION"
  echo "  nlm-ckn tag  : $TAG  (from runs/${ETL_VERSION}/release.json)"
fi

PREFIX="plots/${TAG}/"

# ── Destination bucket + optional CDN ────────────────────────────────────────
# NO_CDN_REASON / NO_URL_REASON explain the skipped invalidation and edge
# check, which differ in wording between the two kinds of environment.
if [ "$CONFIG_ENV" = true ]; then
  DST_BUCKET="$CKN_FRONTEND_BUCKET"
  CF_DIST_ID="$CKN_CF_DIST_ID"
  BASE_URL="${CKN_FRONTEND_URL%/}"
  NO_CDN_REASON="CKN_CF_DIST_ID is not set in scripts/envs/${ENVIRONMENT}.conf"
  NO_URL_REASON="CKN_FRONTEND_URL is not set in scripts/envs/${ENVIRONMENT}.conf"
else
  STACK_NAME="${PROJECT_NAME}-${ENVIRONMENT}-frontend"
  CDN_STACK_NAME="${PROJECT_NAME}-${ENVIRONMENT}-frontend-cdn"

  STACK_DATA=$(fetch_stack_outputs "$STACK_NAME")
  if [ -z "$STACK_DATA" ]; then
    echo -e "${RED}Error: Stack $STACK_NAME not found or has no outputs.${NC}"
    exit 1
  fi
  CDN_DATA=$(fetch_stack_outputs "$CDN_STACK_NAME")

  BucketName=""
  CloudFrontDistributionId=""
  FrontendUrl=""
  while read -r key value; do
    if [ -n "$key" ]; then
      declare "$key=$value"
    fi
  done <<< "$STACK_DATA
$CDN_DATA"

  DST_BUCKET=$BucketName
  CF_DIST_ID=$CloudFrontDistributionId
  BASE_URL=$FrontendUrl
  : "${DST_BUCKET:?Error: BucketName output is missing from stack $STACK_NAME.}"
  NO_CDN_REASON="CDN stack $CDN_STACK_NAME not deployed"
  NO_URL_REASON="no FrontendUrl output — CDN stack $CDN_STACK_NAME not deployed"
fi

echo "  Source       : s3://${SRC_BUCKET}/${PREFIX}"
echo "  Destination  : s3://${DST_BUCKET}/${PREFIX}"
if [ -n "$CF_DIST_ID" ]; then
  echo "  CloudFront   : $CF_DIST_ID"
else
  echo -e "  ${YELLOW}CloudFront   : not configured ($NO_CDN_REASON) — will skip invalidation.${NC}"
fi

# ── Verify the source prefix exists and is non-empty ─────────────────────────
echo ""
echo -e "${GREEN}==> Checking source prefix...${NC}"
SRC_KEYS=$(list_relative_keys "$SRC_BUCKET" "$PREFIX")
SRC_COUNT=$(printf '%s' "$SRC_KEYS" | grep -c '' || true)
if [ "$SRC_COUNT" -eq 0 ]; then
  echo -e "${RED}Error: no objects under s3://${SRC_BUCKET}/${PREFIX}${NC}"
  echo "The assets for tag '${TAG}' were never published, or the tag is wrong."
  echo "Published tags:"
  aws s3 ls "s3://${SRC_BUCKET}/plots/" --region "$AWS_REGION" || true
  exit 1
fi
echo "  $SRC_COUNT objects in source"

# ── Skip when already copied ─────────────────────────────────────────────────
DST_KEYS=$(list_relative_keys "$DST_BUCKET" "$PREFIX")
DST_COUNT=$(printf '%s' "$DST_KEYS" | grep -c '' || true)
echo "  $DST_COUNT objects in destination"

if [ "$DST_COUNT" -eq "$SRC_COUNT" ] && [ "$FORCE" != true ]; then
  echo -e "${GREEN}✓ Destination already has all $SRC_COUNT objects for ${TAG} — nothing to do.${NC}"
  echo "  Use --force to re-copy."
  # Still worth showing the URLs and confirming they serve: "it is already
  # deployed" is exactly when someone re-runs this to get a link to check.
  check_edge_and_print_urls
  # Retention is independent of whether this run copied anything: pruning an
  # already-current environment is the normal way to reclaim old tags.
  if [ "$PRUNE" = true ]; then prune_old_prefixes; fi
  exit 0
fi

# ── Copy ─────────────────────────────────────────────────────────────────────
# Deliberately NO flags beyond --only-show-errors:
#   - no --delete: the destination prefix is append-only per tag, and a stray
#     --delete here is the same hazard this whole plan exists to remove.
#   - no --content-type / --cache-control / --metadata: any of those flips the
#     CLI to MetadataDirective=REPLACE, which silently drops the
#     Content-Encoding: gzip the publisher set and breaks every object. If we
#     ever want different cache headers they must be set at publish time in
#     nlm-ckn, not here.
#
# The plan doc suggests bumping concurrency with
# `aws configure set default.s3.max_concurrent_requests 32`. That is omitted
# deliberately: it writes to ~/.aws/config permanently and changes every other
# AWS command the caller runs afterwards. The CLI default (10) copies this
# prefix in a few minutes, which is fast enough. Run that command yourself if
# you want it faster.
echo ""
echo -e "${GREEN}==> Copying ${SRC_COUNT} objects...${NC}"
echo -e "${YELLOW}This usually takes 1-3 minutes (server-side copies of small objects).${NC}"
aws s3 sync "s3://${SRC_BUCKET}/${PREFIX}" "s3://${DST_BUCKET}/${PREFIX}" \
  --only-show-errors --region "$AWS_REGION"

# ── Verify ───────────────────────────────────────────────────────────────────
# Compare key sets rather than counts (a count match can hide a missing object
# paired with a surplus one), then confirm the gzip encoding survived the copy.
echo ""
echo -e "${GREEN}==> Verifying...${NC}"
DST_KEYS=$(list_relative_keys "$DST_BUCKET" "$PREFIX")
MISSING=$(LC_ALL=C comm -23 <(printf '%s\n' "$SRC_KEYS") <(printf '%s\n' "$DST_KEYS") || true)
if [ -n "$MISSING" ]; then
  echo -e "${RED}Error: objects missing from the destination after the copy:${NC}"
  printf '%s\n' "$MISSING" | head -20
  echo "  ($(printf '%s' "$MISSING" | grep -c '' || true) total)"
  exit 1
fi
echo "  ✓ all $SRC_COUNT source keys present"

# Spot-check one object of each content type. The publisher gzips everything in
# place, so a dropped Content-Encoding means the browser gets gzip bytes labelled
# as SVG/HTML and renders nothing.
assert_gzip() {
  local key="$1" encoding
  encoding=$(aws s3api head-object \
    --bucket "$DST_BUCKET" \
    --key "${PREFIX}${key}" \
    --query 'ContentEncoding' \
    --output text \
    --region "$AWS_REGION" 2>/dev/null || echo "")
  if [ "$encoding" != "gzip" ]; then
    echo -e "${RED}Error: ${PREFIX}${key} has Content-Encoding '${encoding:-none}', expected 'gzip'.${NC}"
    echo "The copy stripped object metadata — check for --content-type/--metadata"
    echo "flags on the sync above (they force MetadataDirective=REPLACE)."
    return 1
  fi
  echo "  ✓ ${key} — Content-Encoding: gzip"
}

for ext in svg html; do
  sample=$(printf '%s\n' "$SRC_KEYS" | grep -m1 "\.${ext}\$" || true)
  if [ -n "$sample" ]; then
    assert_gzip "$sample"
  else
    echo -e "  ${YELLOW}no .${ext} object under the prefix to spot-check${NC}"
  fi
done

# ── Invalidate ───────────────────────────────────────────────────────────────
# Scoped to the tag prefix, never /* — the SPA cache has nothing to do with
# this change. Mostly cheap insurance: a brand-new tag prefix has never been
# requested, so nothing is cached there. It matters for a --force re-copy of the
# same tag, or to clear a negative cache entry if someone raced the copy.
if [ -n "$CF_DIST_ID" ]; then
  echo ""
  echo -e "${GREEN}==> Invalidating /${PREFIX}*${NC}"
  INVALIDATION_ID=$(aws cloudfront create-invalidation \
    --distribution-id "$CF_DIST_ID" \
    --paths "/${PREFIX}*" \
    --query 'Invalidation.Id' \
    --output text)
  echo "  Invalidation ID: $INVALIDATION_ID"
else
  echo ""
  echo -e "${YELLOW}Skipping CloudFront invalidation — $NO_CDN_REASON.${NC}"
fi

check_edge_and_print_urls

if [ "$PRUNE" = true ]; then prune_old_prefixes; fi

echo ""
echo -e "${GREEN}✓ Assets for ${TAG} deployed to ${ENVIRONMENT}.${NC}"
echo "  s3://${DST_BUCKET}/${PREFIX}"
