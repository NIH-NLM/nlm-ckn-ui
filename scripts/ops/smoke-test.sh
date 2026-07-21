#!/bin/bash
# ==============================================================================
# smoke-test.sh - Generic post-deploy smoke test for any CKN environment
# ==============================================================================
# A fast, read-only pass/fail check to run after deploying to any environment.
# It probes the public edge (CloudFront -> S3 app and CloudFront -> backend ALB
# via /arango_api/*), which is the exact path real users take, so it exercises
# the frontend, the backend, and ArangoDB connectivity end to end.
#
# Each probe prints PASS/FAIL with the HTTP status and latency. The script exits
# non-zero if any probe fails, so it can gate a deploy in CI or a release script.
# Nothing is restarted, resized, or restored.
#
# USAGE:
#   AWS_PROFILE=springbok ./scripts/ops/smoke-test.sh [env] [options]
#
#   env             Environment: dev | stage | prod | sandbox (default: stage).
#                   Used to resolve the base URL from the frontend stack output.
#   --url URL       Probe this base URL directly and skip stack lookup. Handy for
#                   environments without a FrontendUrl output (e.g. sandbox) or a
#                   local/preview deploy. Also reads BASE_URL from the env.
#   --timeout N     Per-request timeout in seconds (default: 10).
#   -k, --insecure  Skip TLS cert verification (for a tunnelled localhost URL
#                   where the cert won't match, e.g. via alb-tunnel.sh).
#   -h, --help      Show this help.
#
# EXIT CODES: 0 = all probes passed, 1 = one or more failed, 2 = setup error.
# ==============================================================================
set -uo pipefail

ENVIRONMENT="stage"
BASE_URL="${BASE_URL:-}"
TIMEOUT=10
INSECURE=""
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/../common.sh"
PROJECT="$PROJECT_NAME"
export AWS_REGION="${AWS_REGION:-us-east-1}"

while [ $# -gt 0 ]; do
  case "$1" in
    --url) BASE_URL="$2"; shift 2 ;;
    --url=*) BASE_URL="${1#*=}"; shift ;;
    --timeout) TIMEOUT="$2"; shift 2 ;;
    --timeout=*) TIMEOUT="${1#*=}"; shift ;;
    -k|--insecure) INSECURE=1; shift ;;
    -h|--help) sed -n '2,28p' "$0"; exit 0 ;;
    dev|stage|prod|sandbox) ENVIRONMENT="$1"; shift ;;
    *) echo "unknown argument: $1 (try --help)" >&2; exit 2 ;;
  esac
done

# ── Resolve the base URL ──────────────────────────────────────────────────────
# CloudFront was split out of the frontend bucket stack into a separate CDN
# stack (see deploy-frontend.sh): the FrontendUrl output now lives in
# ${PROJECT}-${ENVIRONMENT}-frontend-cdn, while the bucket stack exposes only
# BucketName. Check the bucket stack first (for not-yet-split envs), then the
# CDN stack, which wins if present.
if [ -z "$BASE_URL" ]; then
  for stack in "${PROJECT}-${ENVIRONMENT}-frontend" "${PROJECT}-${ENVIRONMENT}-frontend-cdn"; do
    url=$(aws cloudformation describe-stacks \
      --stack-name "$stack" \
      --query "Stacks[0].Outputs[?OutputKey=='FrontendUrl'].OutputValue" \
      --output text 2>/dev/null)
    [ -n "$url" ] && [ "$url" != "None" ] && BASE_URL="$url"
  done
fi
if [ -z "$BASE_URL" ] || [ "$BASE_URL" = "None" ]; then
  echo "Could not resolve a base URL for env '$ENVIRONMENT'." >&2
  echo "Pass one explicitly: $0 $ENVIRONMENT --url https://host" >&2
  exit 2
fi
BASE_URL="${BASE_URL%/}"   # trim trailing slash

echo "Smoke test  env=$ENVIRONMENT  url=$BASE_URL  timeout=${TIMEOUT}s"
echo "----------------------------------------------------------------------"

FAILURES=0

# probe <label> <path> <expected-status> [grep-pattern] [json-body]
# GET by default; if json-body is given, POSTs it as application/json.
# Passes when the HTTP status matches and (if given) the body matches the pattern.
probe() {
  local label="$1" path="$2" want="$3" pattern="${4:-}" data="${5:-}"
  local body status time
  local args=(-sS -m "$TIMEOUT" -w '\n%{http_code} %{time_total}')
  [ -n "$INSECURE" ] && args+=(-k)
  [ -n "$data" ] && args+=(-H 'Content-Type: application/json' --data "$data")
  body=$(curl "${args[@]}" "${BASE_URL}${path}" 2>/dev/null)
  read -r status time <<<"$(printf '%s' "$body" | tail -1)"
  body=$(printf '%s' "$body" | sed '$d')

  local ok=true reason=""
  if [ "$status" != "$want" ]; then
    ok=false; reason="status=$status want=$want"
  elif [ -n "$pattern" ] && ! printf '%s' "$body" | grep -qiE "$pattern"; then
    ok=false; reason="body did not match /$pattern/"
  fi

  if $ok; then
    printf 'PASS  %-28s %s (%ss)\n' "$label" "$status" "${time:-0}"
  else
    printf 'FAIL  %-28s %s\n' "$label" "$reason"
    [ -n "$body" ] && printf '        body: %s\n' "$(printf '%s' "$body" | head -c 200 | tr '\n' ' ')"
    FAILURES=$((FAILURES + 1))
  fi
}

# 1. Frontend app loads (S3 origin via CloudFront).
probe "frontend"            "/"                         200 '<!doctype html|<div id="root"'
# 2. Backend reachable through the same edge users hit (ALB origin via CloudFront).
#    Note: /health/ is NOT proxied to the backend through CloudFront (it resolves
#    to the S3 app), so we use the version endpoint as the backend liveness probe.
probe "backend version"     "/arango_api/version/"      200
# 3. ArangoDB connectivity + dataset present (real query through the full stack).
#    collections/ is a POST that takes a graph; a JSON array back means Arango is up.
probe "arango collections"  "/arango_api/collections/"  200 '\[.*\]' '{"graph":"ontologies"}'

echo "----------------------------------------------------------------------"
if [ "$FAILURES" -eq 0 ]; then
  echo "OK  all probes passed"
  exit 0
else
  echo "FAILED  $FAILURES probe(s) failed"
  exit 1
fi
