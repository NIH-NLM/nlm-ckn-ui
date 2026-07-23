#!/bin/bash
# ==============================================================================
# resolve-env.sh - Resolve deployment resource names for an environment
# ==============================================================================
# Centralizes how the deploy scripts discover AWS resource names. Most
# environments (dev/stage/prod) follow the `${PROJECT_NAME}-<env>-*`
# CloudFormation stack naming convention -- PROJECT_NAME comes from
# scripts/common.sh -- so values are read from stack outputs/exports.
#
# The `sandbox` account does NOT follow that convention: stack names are
# org-imposed (e.g. NLM-SBOX-CELL-KN-vpc-101-cellkn-arangodb) and the
# architecture differs (frontend is served via ALB->S3, not CloudFront; backend
# runs on ECS-on-EC2). Instead of remapping the messy stack names, sandbox
# exposes a stable contract via CloudFormation exports
# (${TARGET_PROJECT}-sandbox-*) and SSM parameters (/platform/${TARGET_PROJECT}/*),
# which we resolve here.
#
# TWO PROJECT NAMESPACES — DO NOT CONFLATE:
#   PROJECT_NAME   ("nlm-ckn", from scripts/common.sh) names resources in the
#                  springbok account: the dev/stage/prod stacks, plus the
#                  cross-account promotion sources (CKN_PROMOTE_*) that sandbox
#                  pulls its artifacts from.
#   TARGET_PROJECT ("cell-kn", defined below) names the sandbox account's OWN
#                  resources. These are NOT the decommissioned cell-kn-* stacks
#                  that used to live in springbok — they only share a prefix.
#                  Driving them from PROJECT_NAME breaks sandbox deploys.
#
# The sandbox ECS cluster export additionally embeds NLM-SBOX-CELL-KN, the
# org-assigned AWS account moniker. That is a separate identifier from the app
# name and would not necessarily change in a rename, so it stays literal.
#
# USAGE (sourced):
#   source "$(dirname "$0")/resolve-env.sh"
#   resolve_env <environment>
#   echo "$CKN_FRONTEND_BUCKET"
#
# USAGE (inspect):
#   ./scripts/sandbox/resolve-env.sh <environment>     # prints the resolved table
#
# Honors AWS_PROFILE / AWS_REGION from the environment (set AWS_PROFILE=nlmsandbox
# for local sandbox access; in CI the creds come from the environment directly).
#
# EXPORTS (empty string means "not applicable for this environment"):
#   CKN_ENVIRONMENT        Environment name that was resolved
#   CKN_FRONTEND_BUCKET    S3 bucket for the frontend build
#   CKN_CF_DIST_ID         CloudFront distribution id ("" => skip invalidation)
#   CKN_ECR_URL            Full ECR image URI (repo[:tag]) for the backend
#   CKN_ECS_CLUSTER        ECS cluster name
#   CKN_BACKEND_SERVICE    ECS service name ("" => no service to update yet)
#   CKN_BACKEND_INSTANCE_ID EC2 instance running the backend container ("" => N/A)
#   CKN_BACKEND_URL        Public backend URL (informational)
#   CKN_ARANGO_INSTANCE_ID EC2 instance id of the ArangoDB host
#   CKN_ARANGO_BUCKET      S3 bucket holding ArangoDB dataset dumps
#   CKN_DATASET_VERSION    Active dataset version (object key under the bucket)
# ==============================================================================

# PROJECT_NAME (the stack-name prefix for dev/stage/prod) comes from the shared
# constant. Resolved via BASH_SOURCE so it works whether this file is sourced by
# another script or executed directly.
# shellcheck source=../common.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../common.sh"
# Fail loudly: an empty PROJECT_NAME would silently resolve to names like
# "-stage-frontend" rather than erroring. Requires bash (BASH_SOURCE above).
: "${PROJECT_NAME:?PROJECT_NAME not set — scripts/common.sh failed to source (run under bash, not sh/zsh)}"

# TARGET_PROJECT is the project namespace baked into the SANDBOX account's own
# resource names — its CloudFormation exports (${TARGET_PROJECT}-sandbox-*) and
# SSM parameters (/platform/${TARGET_PROJECT}/*). It is deliberately separate
# from PROJECT_NAME: the two accounts renamed on different schedules, and the
# sandbox side still answers to "cell-kn". See the header before changing it.
# Export TARGET_PROJECT to re-point a one-off run (e.g. a sandbox rename).
# Unset-only defaulting (`=`, not `:=`): an explicitly empty TARGET_PROJECT is
# preserved so the required-value check in resolve_env can reject it.
: "${TARGET_PROJECT=cell-kn}"

# Helpers print the resolved value (empty if missing/unauthorized) and always
# return 0, so a failed lookup never trips the caller's `set -e` mid-resolution.
# `aws ... --output text` prints "None" for a null result; normalize that to "".
_clean() { [ "$1" = "None" ] && printf '' || printf '%s' "$1"; }

# _cfn_export <export-name>  -> prints the export value (empty if missing)
_cfn_export() {
  _clean "$(aws cloudformation list-exports \
    --region "${AWS_REGION:-us-east-1}" \
    --query "Exports[?Name=='$1'].Value" \
    --output text 2>/dev/null || true)"
}

# _ssm <parameter-name>  -> prints the parameter value (empty if missing)
_ssm() {
  _clean "$(aws ssm get-parameter \
    --region "${AWS_REGION:-us-east-1}" \
    --name "$1" \
    --query 'Parameter.Value' \
    --output text 2>/dev/null || true)"
}

# _stack_output <stack-name> <output-key>  -> prints the output value
_stack_output() {
  _clean "$(aws cloudformation describe-stacks \
    --region "${AWS_REGION:-us-east-1}" \
    --stack-name "$1" \
    --query "Stacks[0].Outputs[?OutputKey=='$2'].OutputValue" \
    --output text 2>/dev/null || true)"
}

resolve_env() {
  local env="$1"
  if [ -z "$env" ]; then
    echo "resolve_env: environment is required" >&2
    return 1
  fi
  CKN_ENVIRONMENT="$env"

  case "$env" in
    sandbox)
      # Sandbox: stable contract via exports + SSM, namespaced by TARGET_PROJECT
      # (see header — these are sandbox-account names, not springbok ones).
      # Checked at call time: an empty value would resolve to "-sandbox-*" and
      # every lookup would quietly return nothing. To override, `export
      # TARGET_PROJECT=...`; prefixing it onto `source` does not persist.
      : "${TARGET_PROJECT:?TARGET_PROJECT is empty — export it before calling resolve_env}"
      CKN_FRONTEND_BUCKET=$(_cfn_export "${TARGET_PROJECT}-sandbox-frontend-bucket")
      CKN_CF_DIST_ID=""                                   # no CloudFront; ALB->S3
      CKN_ECR_URL=$(_ssm "/platform/${TARGET_PROJECT}/shared/pEcrUrl")
      # NLM-SBOX-CELL-KN is the account moniker, not the app name — see header.
      CKN_ECS_CLUSTER=$(_cfn_export "NLM-SBOX-CELL-KN-${TARGET_PROJECT}-ECS-Cluster")
      CKN_BACKEND_SERVICE=""                              # not an ECS service; plain docker on EC2
      # Backend runs as a plain `backend` docker container on an EC2 host that is
      # registered as the target of the backend ALB target group. Resolve the
      # instance id from that target group (stable signal; not ECS-managed).
      # An explicit CKN_BACKEND_INSTANCE_ID in the environment wins, so a deploy
      # can be pinned if the target is ever deregistered (e.g. mid-replacement).
      if [ -n "${CKN_BACKEND_INSTANCE_ID:-}" ]; then
        : # honor caller-provided override
      else
        # The ALB forwards to the "-tg-80" target group (the one with the
        # backend instance registered). An older "-sandbox-backend-tg" export
        # points at an empty target group, so prefer "-tg-80-arn" and only fall
        # back to the legacy name.
        local btg
        btg=$(_cfn_export "${TARGET_PROJECT}-sandbox-backend-tg-80-arn")
        [ -z "$btg" ] && btg=$(_cfn_export "${TARGET_PROJECT}-sandbox-backend-tg-arn")
        if [ -n "$btg" ]; then
          CKN_BACKEND_INSTANCE_ID=$(_clean "$(aws elbv2 describe-target-health \
            --region "${AWS_REGION:-us-east-1}" --target-group-arn "$btg" \
            --query 'TargetHealthDescriptions[0].Target.Id' --output text 2>/dev/null || true)")
        else
          CKN_BACKEND_INSTANCE_ID=""
        fi
      fi
      CKN_BACKEND_URL=$(_cfn_export "${TARGET_PROJECT}-sandbox-backend-url")
      # "-dev-", not "-sandbox-": the sandbox account's ArangoDB stack was
      # deployed with Environment=dev, so its export carries that name. This is
      # still a SANDBOX-account export (cross-account exports aren't readable
      # here) — it is not the springbok cell-kn-dev-* stack of the same name.
      CKN_ARANGO_INSTANCE_ID=$(_cfn_export "${TARGET_PROJECT}-dev-arangodb-instance-id")
      CKN_ARANGO_BUCKET=$(_ssm "/platform/${TARGET_PROJECT}/arango/pArangodbBucketName")
      CKN_DATASET_VERSION=$(_ssm "/platform/${TARGET_PROJECT}/arango/pDatasetVersion")
      # ── Promotion sources (springbok account 952291113202) ──────────────
      # Sandbox promotes already-built stage artifacts cross-account, the same
      # way the dataset is pulled from the springbok Arango bucket. These are
      # pinned constants: cross-account CloudFormation exports aren't readable
      # from the sandbox account, so they can't be looked up here. They follow
      # PROJECT_NAME because they name springbok resources, not sandbox ones.
      #   Frontend: synced from the stage frontend bucket (AllowSandboxPromotionRead
      #     grant in nlm-ckn-iac: environment/services/frontend/cloudformation/
      #     frontend-cdn.yaml, IsStage condition).
      #   Backend: pulled from the shared ${PROJECT_NAME}-backend ECR repo
      #     (AllowCrossAccountAccess grant in nlm-ckn-iac:
      #     shared/cloudformation/shared-resources.yaml).
      CKN_PROMOTE_FRONTEND_BUCKET="${PROJECT_NAME}-stage-frontend"
      CKN_PROMOTE_ECR_REGISTRY="952291113202.dkr.ecr.us-east-1.amazonaws.com"
      CKN_PROMOTE_ECR_REPO="${PROJECT_NAME}-backend"
      ;;
    dev|stage|prod)
      # Conventional ${PROJECT_NAME}-<env>-* stacks (see scripts/common.sh).
      local p="$PROJECT_NAME"
      CKN_FRONTEND_BUCKET=$(_stack_output "${p}-${env}-frontend" "BucketName")
      # CloudFront lives in its own `-frontend-cdn` stack, split out from the
      # bucket stack so the distribution can be created alias-less and cut over
      # separately (nlm-ckn-iac: environment/services/frontend/cloudformation/).
      CKN_CF_DIST_ID=$(_stack_output "${p}-${env}-frontend-cdn" "CloudFrontDistributionId")
      CKN_ECR_URL=""                                      # resolved in deploy-backend (shared stack)
      CKN_ECS_CLUSTER=$(_cfn_export "${p}-${env}-cluster-name")
      CKN_BACKEND_SERVICE=$(_stack_output "${p}-${env}-backend" "ServiceName")
      CKN_BACKEND_INSTANCE_ID=""                          # ECS service, not a docker-on-EC2 host
      CKN_BACKEND_URL=$(_stack_output "${p}-${env}" "BackendUrl")
      CKN_ARANGO_INSTANCE_ID=$(_stack_output "${p}-${env}-arangodb" "InstanceId")
      local ver_param
      ver_param=$(_stack_output "${p}-${env}-arangodb" "DatasetVersionParameter")
      CKN_ARANGO_BUCKET=$(_ssm "/${p}/shared/arangodb-bucket-name")
      if [ -n "$ver_param" ]; then CKN_DATASET_VERSION=$(_ssm "$ver_param"); else CKN_DATASET_VERSION=""; fi
      ;;
    *)
      echo "resolve_env: unknown environment '$env' (expected dev|stage|prod|sandbox)" >&2
      return 1
      ;;
  esac

  export CKN_ENVIRONMENT CKN_FRONTEND_BUCKET CKN_CF_DIST_ID CKN_ECR_URL \
         CKN_ECS_CLUSTER CKN_BACKEND_SERVICE CKN_BACKEND_INSTANCE_ID CKN_BACKEND_URL \
         CKN_ARANGO_INSTANCE_ID CKN_ARANGO_BUCKET CKN_DATASET_VERSION \
         CKN_PROMOTE_FRONTEND_BUCKET CKN_PROMOTE_ECR_REGISTRY CKN_PROMOTE_ECR_REPO
}

# When executed directly (not sourced), print the resolved table for inspection.
if [ "${BASH_SOURCE[0]}" = "${0}" ]; then
  set -e
  resolve_env "$1"
  printf '%-22s %s\n' \
    "Environment:"        "$CKN_ENVIRONMENT" \
    "Frontend bucket:"    "${CKN_FRONTEND_BUCKET:-(none)}" \
    "CloudFront dist:"    "${CKN_CF_DIST_ID:-(none)}" \
    "ECR image:"          "${CKN_ECR_URL:-(none)}" \
    "ECS cluster:"        "${CKN_ECS_CLUSTER:-(none)}" \
    "Backend service:"    "${CKN_BACKEND_SERVICE:-(none)}" \
    "Backend instance:"   "${CKN_BACKEND_INSTANCE_ID:-(none)}" \
    "Backend URL:"        "${CKN_BACKEND_URL:-(none)}" \
    "Arango instance:"    "${CKN_ARANGO_INSTANCE_ID:-(none)}" \
    "Arango bucket:"      "${CKN_ARANGO_BUCKET:-(none)}" \
    "Dataset version:"    "${CKN_DATASET_VERSION:-(none)}"
fi
