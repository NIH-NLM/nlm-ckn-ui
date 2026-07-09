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
# NOTE: the sandbox scripts (scripts/sandbox/) are intentionally NOT wired to
# this constant — the sandbox account keeps its own cell-kn-* naming contract.
# ==============================================================================

# Project name — the prefix for all CloudFormation stacks, SSM parameters,
# S3 buckets, ECR repos, etc. Change it here to rename the whole project.
PROJECT_NAME="nlm-ckn"
