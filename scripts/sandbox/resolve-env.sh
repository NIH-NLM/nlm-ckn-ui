#!/bin/bash
# ==============================================================================
# resolve-env.sh - Resolve deployment resource names for an environment
# ==============================================================================
# Centralizes how the deploy scripts discover AWS resource names. Most
# environments (dev/stage/prod) follow the `cell-kn-<env>-*` CloudFormation
# stack naming convention, so values are read from stack outputs/exports.
#
# The `sandbox` account does NOT follow that convention: stack names are
# org-imposed (e.g. NLM-SBOX-CELL-KN-vpc-101-cellkn-arangodb) and the
# architecture differs (frontend is served via ALB->S3, not CloudFront;
# backend runs on ECS-on-EC2). Instead of remapping the messy stack names,
# sandbox exposes a stable contract via CloudFormation exports
# (cell-kn-sandbox-*) and SSM parameters (/platform/cell-kn/*), which we
# resolve here.
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
      # Sandbox: stable contract via exports + SSM (see header).
      CKN_FRONTEND_BUCKET=$(_cfn_export "cell-kn-sandbox-frontend-bucket")
      CKN_CF_DIST_ID=""                                   # no CloudFront; ALB->S3
      CKN_ECR_URL=$(_ssm "/platform/cell-kn/shared/pEcrUrl")
      CKN_ECS_CLUSTER=$(_cfn_export "NLM-SBOX-CELL-KN-cell-kn-ECS-Cluster")
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
        # backend instance registered). An older "cell-kn-sandbox-backend-tg"
        # export points at an empty target group, so prefer "-tg-80-arn" and
        # only fall back to the legacy name.
        local btg
        btg=$(_cfn_export "cell-kn-sandbox-backend-tg-80-arn")
        [ -z "$btg" ] && btg=$(_cfn_export "cell-kn-sandbox-backend-tg-arn")
        if [ -n "$btg" ]; then
          CKN_BACKEND_INSTANCE_ID=$(_clean "$(aws elbv2 describe-target-health \
            --region "${AWS_REGION:-us-east-1}" --target-group-arn "$btg" \
            --query 'TargetHealthDescriptions[0].Target.Id' --output text 2>/dev/null || true)")
        else
          CKN_BACKEND_INSTANCE_ID=""
        fi
      fi
      CKN_BACKEND_URL=$(_cfn_export "cell-kn-sandbox-backend-url")
      CKN_ARANGO_INSTANCE_ID=$(_cfn_export "cell-kn-dev-arangodb-instance-id")
      CKN_ARANGO_BUCKET=$(_ssm "/platform/cell-kn/arango/pArangodbBucketName")
      CKN_DATASET_VERSION=$(_ssm "/platform/cell-kn/arango/pDatasetVersion")
      # ── Promotion sources (springbok account 952291113202) ──────────────
      # Sandbox promotes already-built stage artifacts cross-account, the same
      # way the dataset is pulled from the springbok Arango bucket. These are
      # pinned constants: cross-account CloudFormation exports aren't readable
      # from the sandbox account, so they can't be looked up here.
      #   Frontend: synced from the stage frontend bucket (grant in
      #     cloudformation/environment/frontend.yaml, IsStage condition).
      #   Backend: pulled from the shared cell-kn-backend ECR repo (grant in
      #     cloudformation/shared/shared-resources.yaml).
      CKN_PROMOTE_FRONTEND_BUCKET="cell-kn-stage-frontend"
      CKN_PROMOTE_ECR_REGISTRY="952291113202.dkr.ecr.us-east-1.amazonaws.com"
      CKN_PROMOTE_ECR_REPO="cell-kn-backend"
      ;;
    dev|stage|prod)
      # Conventional cell-kn-<env>-* stacks.
      local p="cell-kn"
      CKN_FRONTEND_BUCKET=$(_stack_output "${p}-${env}-frontend" "BucketName")
      CKN_CF_DIST_ID=$(_stack_output "${p}-${env}-frontend" "CloudFrontDistributionId")
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
