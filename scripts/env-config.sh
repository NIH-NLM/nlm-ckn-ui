# shellcheck shell=bash
# ==============================================================================
# env-config.sh - Config-file environments for the deploy scripts
# ==============================================================================
# dev/stage/prod discover their resources from ${PROJECT_NAME}-<env>-* stack
# outputs. Other environments (e.g. int) live in other AWS accounts whose
# stacks and exports we make no assumptions about. Each one is described by a
# file instead:
#
#   scripts/envs/<env>.conf
#
# Adding an environment means adding a file — no script changes. See
# scripts/envs/int.conf for the full key list.
#
# VALUES
#   Each key is either a fixed name or "ssm:<parameter name>". ssm: values are
#   read in the TARGET account, after the role below has been assumed. A key
#   already set in the caller's environment wins over the file, so a one-off
#   run can be re-pointed without editing it:
#     CKN_ARANGO_INSTANCE_ID=i-0abc... ./scripts/app/deploy-dataset.sh int
#
# ACCESS
#   The scripts run with your normal (springbok) credentials and assume
#   arn:aws:iam::<CKN_ACCOUNT_ID>:role/<CKN_ROLE_NAME> for everything they do.
#   The source buckets (dataset dumps, static plot assets) stay in springbok
#   and are read cross-account under that role, so their bucket policies must
#   grant it read. If the caller is already in the target account, no role is
#   assumed.
#
# USAGE (sourced, after common.sh):
#   source "$SCRIPT_DIR/../env-config.sh"
#   if ckn_has_env_config "$ENVIRONMENT"; then
#     ckn_load_env_config "$ENVIRONMENT"   # reads the file, assumes the role
#     ckn_require CKN_FRONTEND_BUCKET ...  # resolve keys this script needs; fail if empty
#     ckn_resolve CKN_CF_DIST_ID ...       # resolve optional keys
#   fi
#
# Long-running callers (the 90-minute dataset restore) should call
# ckn_refresh_role periodically: chained role sessions are capped at one hour.
# ==============================================================================

CKN_ENV_CONFIG_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/envs"

# Every key a config file may set. Kept in one place so caller overrides and
# ssm: resolution cover the same set.
CKN_CONFIG_KEYS=(
  CKN_ACCOUNT_ID CKN_ROLE_NAME CKN_REGION
  CKN_ARANGO_INSTANCE_ID CKN_DATASET_VERSION_PARAM CKN_ARANGO_ROOT_SECRET
  CKN_ARANGO_RO_USER_PARAM CKN_ARANGO_RO_PASSWORD_SECRET
  CKN_FRONTEND_BUCKET CKN_CF_DIST_ID CKN_FRONTEND_URL
  CKN_ARANGO_BUCKET CKN_STATIC_ASSETS_BUCKET
)

ckn_has_env_config() {
  [[ "$1" =~ ^[a-z0-9-]+$ ]] && [ -f "$CKN_ENV_CONFIG_DIR/$1.conf" ]
}

# Names of the configured environments, space-separated, for usage messages.
ckn_env_config_names() {
  local f names=()
  for f in "$CKN_ENV_CONFIG_DIR"/*.conf; do
    [ -e "$f" ] || continue
    f="${f##*/}"
    names+=("${f%.conf}")
  done
  printf '%s' "${names[*]}"
}

ckn_load_env_config() {
  local env="$1" key value
  local -a overrides=()

  # Remember caller-set keys so they survive sourcing the file.
  for key in "${CKN_CONFIG_KEYS[@]}"; do
    if [ -n "${!key+x}" ]; then overrides+=("$key=${!key}"); fi
  done
  for key in "${CKN_CONFIG_KEYS[@]}"; do unset "$key"; done

  # shellcheck source=/dev/null
  source "$CKN_ENV_CONFIG_DIR/$env.conf"

  for value in ${overrides[@]+"${overrides[@]}"}; do
    printf -v "${value%%=*}" '%s' "${value#*=}"
  done

  : "${CKN_ACCOUNT_ID:?CKN_ACCOUNT_ID is not set in scripts/envs/$env.conf}"
  : "${CKN_ROLE_NAME:?CKN_ROLE_NAME is not set in scripts/envs/$env.conf}"
  AWS_REGION="${CKN_REGION:-${AWS_REGION:-us-east-1}}"
  export AWS_REGION

  ckn_assume_role "$env"
}

# Resolve ssm: values for just the given keys, in the target account. Scripts
# name only the keys they use, so a key one script needs never costs another
# an IAM permission or a failed lookup.
ckn_resolve() {
  local key param value
  for key in "$@"; do
    param="${!key:-}"
    [[ "$param" == ssm:* ]] || continue
    param="${param#ssm:}"
    value=$(aws ssm get-parameter --name "$param" \
      --query 'Parameter.Value' --output text --region "$AWS_REGION") || {
      echo "Error: could not read SSM parameter $param (for $key) in account $CKN_ACCOUNT_ID" >&2
      return 1
    }
    [ "$value" = "None" ] && value=""
    printf -v "$key" '%s' "$value"
  done
}

# ckn_resolve, then fail naming every key that came out empty.
ckn_require() {
  local key missing=()
  ckn_resolve "$@" || return 1
  for key in "$@"; do
    [ -n "${!key:-}" ] || missing+=("$key")
  done
  if [ ${#missing[@]} -gt 0 ]; then
    echo "Error: scripts/envs/${CKN_ENV_NAME:-?}.conf does not set: ${missing[*]}" >&2
    return 1
  fi
}

# ── Role assumption ──────────────────────────────────────────────────────────
# The caller's own credentials are saved so the role can be re-assumed from
# them (re-assuming from the role's own session would be a second chain hop).

_ckn_assume_once() {
  local out
  out=$(
    # Run with the caller's original credentials, not a previous role session.
    if [ "$_CKN_BASE_AKID_SET" = 1 ]; then export AWS_ACCESS_KEY_ID="$_CKN_BASE_AKID"; else unset AWS_ACCESS_KEY_ID; fi
    if [ "$_CKN_BASE_SECRET_SET" = 1 ]; then export AWS_SECRET_ACCESS_KEY="$_CKN_BASE_SECRET"; else unset AWS_SECRET_ACCESS_KEY; fi
    if [ "$_CKN_BASE_TOKEN_SET" = 1 ]; then export AWS_SESSION_TOKEN="$_CKN_BASE_TOKEN"; else unset AWS_SESSION_TOKEN; fi
    aws sts assume-role \
      --role-arn "arn:aws:iam::${CKN_ACCOUNT_ID}:role/${CKN_ROLE_NAME}" \
      --role-session-name "ckn-deploy-${CKN_ENV_NAME}" \
      --duration-seconds "${CKN_ROLE_DURATION:-3600}" \
      --region "$AWS_REGION" --output json
  ) || return 1
  out=$(printf '%s' "$out" | python3 -c '
import json, sys
from datetime import datetime
c = json.load(sys.stdin)["Credentials"]
exp = datetime.fromisoformat(c["Expiration"].replace("Z", "+00:00"))
print(c["AccessKeyId"], c["SecretAccessKey"], c["SessionToken"], int(exp.timestamp()))
') || return 1
  read -r AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN _CKN_ROLE_EXPIRES <<< "$out"
  export AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN
}

ckn_assume_role() {
  CKN_ENV_NAME="$1"
  _CKN_ROLE_ASSUMED=0

  local current
  current=$(aws sts get-caller-identity --query Account --output text --region "$AWS_REGION") || {
    echo "Error: no usable AWS credentials (aws sts get-caller-identity failed)" >&2
    return 1
  }
  if [ "$current" = "$CKN_ACCOUNT_ID" ]; then
    echo "  Credentials are already in account $CKN_ACCOUNT_ID — not assuming a role"
    return 0
  fi

  _CKN_BASE_AKID_SET=0; _CKN_BASE_SECRET_SET=0; _CKN_BASE_TOKEN_SET=0
  if [ -n "${AWS_ACCESS_KEY_ID+x}" ]; then _CKN_BASE_AKID_SET=1; _CKN_BASE_AKID="$AWS_ACCESS_KEY_ID"; fi
  if [ -n "${AWS_SECRET_ACCESS_KEY+x}" ]; then _CKN_BASE_SECRET_SET=1; _CKN_BASE_SECRET="$AWS_SECRET_ACCESS_KEY"; fi
  if [ -n "${AWS_SESSION_TOKEN+x}" ]; then _CKN_BASE_TOKEN_SET=1; _CKN_BASE_TOKEN="$AWS_SESSION_TOKEN"; fi

  echo "  Assuming arn:aws:iam::${CKN_ACCOUNT_ID}:role/${CKN_ROLE_NAME} (from account $current)"
  _ckn_assume_once || {
    echo "Error: could not assume ${CKN_ROLE_NAME} in account ${CKN_ACCOUNT_ID}" >&2
    return 1
  }
  _CKN_ROLE_ASSUMED=1
}

# Re-assume when the session has under 10 minutes left. A no-op when no role
# was assumed, so callers can invoke it unconditionally.
ckn_refresh_role() {
  [ "${_CKN_ROLE_ASSUMED:-0}" = 1 ] || return 0
  [ "$(date +%s)" -lt $(( _CKN_ROLE_EXPIRES - 600 )) ] && return 0
  echo "  Refreshing ${CKN_ROLE_NAME} session"
  _ckn_assume_once || {
    echo "Error: could not refresh the ${CKN_ROLE_NAME} session" >&2
    return 1
  }
}
