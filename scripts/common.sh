# ==============================================================================
# common.sh - Shared constants for the deployment / ops scripts
# ==============================================================================
# Sourced by the scripts under scripts/ (app/, ops/, and the top-level ops
# helpers). Holds values that would otherwise be duplicated (and drift) across
# each script.
#
# USAGE (from a script, before any `cd`):
#   SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
#   source "$SCRIPT_DIR/common.sh"          # scripts at scripts/
#   source "$SCRIPT_DIR/../common.sh"       # scripts at scripts/app/ or scripts/ops/
#
# NOTE: scripts/sandbox/resolve-env.sh sources this for the dev/stage/prod
# stacks and the cross-account promotion sources, which all live in the springbok
# account. The sandbox account's OWN resources keep their org-imposed cell-kn-*
# / NLM-SBOX-* naming and are deliberately not driven by this constant — see the
# header of resolve-env.sh before renaming anything there.
# ==============================================================================

# Project name — the prefix for all CloudFormation stacks, SSM parameters,
# S3 buckets, ECR repos, etc. Change it here to rename the whole project.
PROJECT_NAME="nlm-ckn"
