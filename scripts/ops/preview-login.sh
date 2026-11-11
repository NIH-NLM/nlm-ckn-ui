#!/bin/bash
# ==============================================================================
# preview-login.sh - Open an nlm-ckn-ui PR preview in the browser
# ==============================================================================
# Mints a signed sign-in link for https://pr-<n>.<env>.<domain> and opens it.
# The link sets an HttpOnly session cookie for that one preview, valid for
# --hours (default 12). Anyone with the link can use it until then, so it can
# be pasted to a reviewer without AWS access.
#
# The signing key is the `session-key` in the preview KeyValueStore
# (nlm-ckn-iac's environment/preview/cloudformation/preview-platform.yaml);
# reading it needs cloudformation:DescribeStacks on the
# platform stack and cloudfront-keyvaluestore:DescribeKeyValueStore/GetKey.
# Rotating the key (see nlm-ckn-iac's deploy/03-deploy-preview-platform.sh)
# invalidates every link and cookie.
#
# USAGE:
#   AWS_PROFILE=springbok ./scripts/ops/preview-login.sh <pr> [--env dev] [--hours 12] [--print]
#     --print: print the link instead of opening it
#
# REQUIRES: aws CLI, perl with Digest::SHA (core Perl; on Debian/Ubuntu it is
# in the `perl` package, not the minimal `perl-base`)
# ==============================================================================
set -euo pipefail

perl -MDigest::SHA -e1 2>/dev/null || {
  echo "Error: perl with Digest::SHA is required (Debian/Ubuntu: apt install perl)" >&2
  exit 1; }

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/../common.sh"

PR="${1:-}"
[[ "$PR" =~ ^[1-9][0-9]{0,4}$ ]] || {
  echo "Usage: $0 <pr> [--env dev] [--hours 12] [--print]" >&2; exit 1; }
shift

ENVIRONMENT=dev
HOURS=12
PRINT_ONLY=false
while [ $# -gt 0 ]; do
  case "$1" in
    --env) ENVIRONMENT="${2:?--env needs a value}"; shift 2 ;;
    --hours) HOURS="${2:?--hours needs a value}"; shift 2 ;;
    --print) PRINT_ONLY=true; shift ;;
    *) echo "Error: unknown option: $1 (valid: --env, --hours, --print)" >&2; exit 1 ;;
  esac
done
[[ "$HOURS" =~ ^[0-9]+$ ]] && [ "$HOURS" -ge 1 ] && [ "$HOURS" -le 168 ] || {
  echo "Error: --hours must be 1-168" >&2; exit 1; }

AWS_REGION=us-east-1
STACK_NAME="${PROJECT_NAME}-${ENVIRONMENT}-preview-platform"

output() {
  aws cloudformation describe-stacks --stack-name "$STACK_NAME" --region "$AWS_REGION" \
    --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text
}
DOMAIN=$(output PreviewDomain)
KVS_ARN=$(output PreviewAuthStoreArn)

KEY=$(aws cloudfront-keyvaluestore get-key --region "$AWS_REGION" \
  --kvs-arn "$KVS_ARN" --key session-key --query Value --output text) || {
  echo "Error: could not read session-key from ${KVS_ARN}" >&2
  echo "       (not seeded yet? run nlm-ckn-iac's ./deploy/03-deploy-preview-platform.sh ${ENVIRONMENT})" >&2
  exit 1; }

# Must match verify() in nlm-ckn-iac preview-platform.yaml's PreviewRouterFunction.
EXP=$(( $(date +%s) + HOURS * 3600 ))
# HMAC-SHA256 hex. The key goes in on stdin (printf is a builtin), not argv,
# so it never shows up in ps.
SIG=$(printf '%s' "$KEY" | perl -MDigest::SHA=hmac_sha256_hex \
  -e 'local $/; my $key = <STDIN>; print hmac_sha256_hex($ARGV[0], $key)' "pr-${PR}:${EXP}")
URL="https://pr-${PR}.${DOMAIN}/_preview/login?token=${EXP}.${SIG}"

if [ "$PRINT_ONLY" = true ]; then
  echo "$URL"
  exit 0
fi

echo "Sign-in link for PR ${PR} (valid ${HOURS}h, shareable):"
echo "  $URL"
if command -v open >/dev/null; then
  open "$URL"
elif command -v xdg-open >/dev/null; then
  xdg-open "$URL"
fi
