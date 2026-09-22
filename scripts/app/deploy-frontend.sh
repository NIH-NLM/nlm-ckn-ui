#!/bin/bash
# ==============================================================================
# deploy-frontend.sh - Deploy Frontend Application
# ==============================================================================
# Builds the React frontend and deploys to S3/CloudFront.
#
# USAGE:
#   ./scripts/app/deploy-frontend.sh <environment>
#
# WHAT IT DOES:
#   1. Gets ALB DNS name from CloudFormation Stack
#   2. Syncs build files to S3 (leaving the plots/* asset prefix untouched)
#   3. Creates CloudFront invalidation
#   4. Shows application URLs
#
# PREREQUISITES:
#   - AWS CLI configured with appropriate credentials
#   - Node.js and npm installed
#   - Infrastructure deployed (nlm-ckn-iac: deploy/02-deploy-environment.sh)
#   - React application in ../react directory
#
#
# ROLLBACK:
#   S3 versioning is enabled. Use AWS Console to restore previous version.
#
# MONITORING:
#   Check invalidation status:
#     aws cloudfront get-invalidation \
#       --distribution-id <DIST_ID> \
#       --id <INVALIDATION_ID>
#
# NOTES:
#   CloudFront invalidation may take a few minutes to propagate globally.
#   Use hard refresh in browser (Ctrl+Shift+R) to bypass local cache.
# ==============================================================================
set -e

# Capture the script dir before any cd so we can find sibling scripts later.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color


# Check arguments
if [ $# -ne 1 ]; then
  echo "Usage: $0 <environment>"
  echo "Example: $0 dev"
  exit 1
fi

ENVIRONMENT=$1
source "$SCRIPT_DIR/../common.sh"
AWS_REGION=${AWS_REGION:-us-east-1}
STACK_NAME="${PROJECT_NAME}-${ENVIRONMENT}-frontend"

# Validate environment
if [[ ! "$ENVIRONMENT" =~ ^(dev|stage|sandbox|prod)$ ]]; then
  echo -e "${RED}Error: Environment must be dev, stage, sandbox, or prod${NC}"
  exit 1
fi

# CloudFront + Route53 were split out of the frontend stack into a separate
# CDN stack (nlm-ckn-iac: environment/services/frontend/cloudformation/frontend-cdn.yaml)
# so the bucket can be provisioned ahead of cutover. The bucket stack now
# exposes only BucketName; the CloudFront distribution id and FrontendUrl live
# in the CDN stack, which may not exist yet. We always push to the bucket, but
# only invalidate when the CDN stack is present.
CDN_STACK_NAME="${PROJECT_NAME}-${ENVIRONMENT}-frontend-cdn"

# Helper: fetch selected outputs from a stack as "Key<TAB>Value" lines.
# Returns empty (and non-error) only when the stack genuinely doesn't exist.
# Any other describe-stacks failure (permissions, credentials, throttling,
# connectivity) is propagated so a caller can't silently treat it as "absent"
# and skip CDN invalidation or the smoke test. When the smoke test does run, a
# failing probe fails the deploy (see #207).
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
  # A non-existent stack is expected (the CDN stack may not be deployed yet).
  if printf '%s' "$out" | grep -q 'does not exist'; then
    return 0
  fi
  echo -e "${RED}Error: describe-stacks failed for $1:${NC}" >&2
  printf '%s\n' "$out" >&2
  return 1
}

echo -e "${GREEN}Getting infrastructure details from CloudFormation / SSM...${NC}"

# Bucket stack — must exist.
STACK_DATA=$(fetch_stack_outputs "$STACK_NAME")
if [ -z "$STACK_DATA" ]; then
  echo -e "${RED}Error: Stack $STACK_NAME not found or has no outputs.${NC}"
  exit 1
fi

# CDN stack — optional. In a not-yet-split environment its outputs may still
# live in the bucket stack, so we merge both (bucket stack first, CDN wins).
CDN_DATA=$(fetch_stack_outputs "$CDN_STACK_NAME")

# Loop through the lines and assign variables
while read -r key value; do
  if [ -n "$key" ]; then
    declare "$key=$value"
  fi
done <<< "$STACK_DATA
$CDN_DATA"

# Map to shorter internal script variables
S3_BUCKET=$BucketName
CF_DIST_ID=$CloudFrontDistributionId

# The bucket is required; the CloudFront distribution is not (CDN may be
# deployed separately, later).
: "${S3_BUCKET:?Error: BucketName output is missing from stack.}"

echo "  S3 Bucket: $S3_BUCKET"
if [ -n "$CF_DIST_ID" ]; then
  echo "  CloudFront Distribution: $CF_DIST_ID"
else
  echo -e "  ${YELLOW}CloudFront Distribution: not found (CDN stack $CDN_STACK_NAME not deployed yet) — will skip invalidation.${NC}"
fi


# Change to react directory (script lives in scripts/app/)
cd "$(dirname "$0")/../../react"
# Build the frontend
echo -e "${YELLOW}Running npm install (if needed)...${NC}"
npm ci --prefer-offline --no-audit

echo -e "${YELLOW}Building React application...${NC}"
# Bake the version into the bundle so the string ships inside the artifact it
# names. The backend image tag cannot serve this: frontend and backend deploy
# independently and conditionally (ci.yml), so a frontend-only change would
# leave the backend — and any version it reported — untouched.
#
# Same resolution rule as deploy-backend.sh's IMAGE_TAG, so both halves report
# the same shape of version in a given environment: an explicit override if
# set, otherwise the short git SHA.
if [ -z "${VERSION:-}" ]; then
  VERSION=$(git rev-parse --short HEAD 2>/dev/null) || {
    echo -e "${RED}Error: could not determine a version (not a git checkout?)${NC}"
    echo "Set the VERSION environment variable to override."
    exit 1
  }
fi
echo -e "${YELLOW}Building with REACT_APP_VERSION=$VERSION${NC}"
REACT_APP_VERSION="$VERSION" npm run build-react

if [ ! -d "build" ]; then
    echo -e "${RED}Error: Build directory not found!${NC}"
    exit 1
fi

# Upload to S3
#
# `plots/*` is deliberately excluded from BOTH sides of the sync. The bucket is
# shared with the static plot assets copied in by app/deploy-assets.sh
# (~2,850 objects under plots/<nlm-ckn tag>/), which are not part of the React
# build. Without the exclusion, `--delete` treats every one of them as surplus
# and wipes them on the next frontend-only deploy. The two deploys must not be
# able to see each other's keys — see docs/static-asset-copy-plan.md.
echo -e "\n${GREEN}Uploading to S3: s3://$S3_BUCKET/ (excluding plots/*)${NC}"
aws s3 sync build/ s3://$S3_BUCKET/ --delete --exclude 'plots/*'

# Invalidate CloudFront cache (only when the CDN stack is deployed)
if [ -n "$CF_DIST_ID" ]; then
  echo -e "\n${GREEN}Invalidating CloudFront cache...${NC}"
  INVALIDATION_ID=$(aws cloudfront create-invalidation \
      --distribution-id $CF_DIST_ID \
      --paths "/*" \
      --query 'Invalidation.Id' \
      --output text)

  echo "  Invalidation ID: $INVALIDATION_ID"
else
  echo -e "\n${YELLOW}Skipping CloudFront invalidation — CDN stack $CDN_STACK_NAME not deployed.${NC}"
  echo -e "${YELLOW}Bucket is up to date; run this script again once the CDN stack exists to invalidate.${NC}"
fi

echo -e "\n${GREEN}✓ Deployment complete!${NC}"
if [ -n "$FrontendUrl" ]; then
  echo -e "\n${GREEN}Frontend URL: $FrontendUrl${NC}"
  echo -e "${GREEN}ArangoDB URL: $FrontendUrl:8529${NC}"
fi
if [ -n "$CF_DIST_ID" ]; then
  echo -e "\n${YELLOW}Note: CloudFront invalidation may take a few minutes to propagate.${NC}"
fi

# Smoke test the deployment (advisory — never fails the deploy).
# CloudFront may still be propagating the invalidation, so give it extra room.
# Only meaningful once the CDN stack exists — without it there's no public URL
# to hit, so skip rather than report a guaranteed failure.
if [ -n "$CF_DIST_ID" ]; then
  echo -e "\n${GREEN}Running smoke test...${NC}"
  "$SCRIPT_DIR/../ops/smoke-test.sh" "$ENVIRONMENT" --timeout 20
else
  echo -e "\n${YELLOW}Skipping smoke test — no CloudFront URL yet (CDN stack $CDN_STACK_NAME not deployed).${NC}"
fi
