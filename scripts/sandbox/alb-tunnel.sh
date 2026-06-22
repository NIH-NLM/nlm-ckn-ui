#!/bin/bash
# ==============================================================================
# alb-tunnel.sh - SSM Port-Forward to an internal-only-reachable ALB
# ==============================================================================
# The sandbox ALB is internet-facing but its security group only trusts the NLM
# developer CIDRs, and the subnet NACL blocks the proxy path -- so it is not
# reachable from a laptop or webproxy. The only route in is from *inside* the
# VPC. This script:
#
#   1. Looks up the ALB by tag (Name=cell-kn-<env>-alb): its security group and
#      one of its private (in-VPC) IPs.
#   2. Picks a running EC2 instance in the same VPC as the SSM jump host
#      (preferring an ArangoDB instance).
#   3. Temporarily authorizes the jump host's private IP on the ALB security
#      group for the target port, so the in-VPC connection is allowed.
#   4. Opens an SSM AWS-StartPortForwardingSessionToRemoteHost tunnel to the
#      ALB's *private* IP (keeps the source IP in-VPC, matching the SG rule).
#   5. On exit (Ctrl+C / error) REVOKES the SG rule it added, leaving the SG as
#      it found it.
#
# USAGE:
#   AWS_PROFILE=nlmsandbox ./scripts/sandbox/alb-tunnel.sh [environment] \
#       [--remote-port N] [--local-port N]
#
# ARGUMENTS:
#   environment        dev, stage, sandbox, or prod (default: sandbox)
#   --remote-port N    ALB listener port to reach (default: 443)
#   --local-port N     Local port to bind (default: 8530)
#   --no-smoke         Skip the smoke test (smoke test runs by default).
#
# Then open https://localhost:<local-port>/ (use -k / accept the cert warning;
# the ALB serves its default cert and routes by path).
#
# PREREQUISITES:
#   - AWS CLI + Session Manager plugin, credentials for the target account.
#   - Permission to authorize/revoke ingress on the ALB security group.
# ==============================================================================
set -e

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'

# --- Parse arguments ----------------------------------------------------------
ENVIRONMENT="sandbox"
REMOTE_PORT="443"
LOCAL_PORT="8530"
SMOKE=1
while [ $# -gt 0 ]; do
  case "$1" in
    --remote-port) REMOTE_PORT="$2"; shift 2 ;;
    --local-port)  LOCAL_PORT="$2";  shift 2 ;;
    --no-smoke)    SMOKE=""; shift ;;
    *) ENVIRONMENT="$1"; shift ;;
  esac
done

PROJECT_NAME="cell-kn"
AWS_REGION="us-east-1"
ALB_NAME_TAG="${PROJECT_NAME}-${ENVIRONMENT}-alb"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

if [[ ! "$ENVIRONMENT" =~ ^(dev|stage|sandbox|prod)$ ]]; then
  echo -e "${RED}Error: Environment must be dev, stage, sandbox, or prod${NC}"; exit 1
fi

# State for cleanup
SG_ID=""
JUMP_IP=""
RULE_ADDED=""
SSM_PID=""
CLEANED=""

cleanup() {
  [ -n "$CLEANED" ] && return
  CLEANED=1
  # Stop the SSM session first so we don't leave a dangling tunnel.
  [ -n "$SSM_PID" ] && kill "$SSM_PID" 2>/dev/null || true
  if [ -n "$RULE_ADDED" ]; then
    echo ""
    echo "==> Cleaning up: revoking temporary SG rule (${JUMP_IP}/32 on ${REMOTE_PORT})..."
    aws ec2 revoke-security-group-ingress \
      --region "$AWS_REGION" \
      --group-id "$SG_ID" \
      --ip-permissions "IpProtocol=tcp,FromPort=${REMOTE_PORT},ToPort=${REMOTE_PORT},IpRanges=[{CidrIp=${JUMP_IP}/32}]" \
      >/dev/null 2>&1 \
      && echo -e "${GREEN}    Revoked.${NC}" \
      || echo -e "${YELLOW}    Warning: could not revoke ${JUMP_IP}/32 on ${REMOTE_PORT}; remove it manually.${NC}"
  fi
}
trap cleanup EXIT INT TERM

# --- 1. Look up ALB by tag: SG + VPC + a private IP ---------------------------
echo "==> Looking up ALB Name=${ALB_NAME_TAG}..."

# Primary: the Resource Groups Tagging API (by Name tag). It is eventually
# consistent and occasionally returns nothing even when the tag exists, so we
# fall back to a direct describe-load-balancers by name (the ALB's
# LoadBalancerName matches the Name tag here).
ALB_ARN=$(aws resourcegroupstaggingapi get-resources \
  --region "$AWS_REGION" \
  --resource-type-filters "elasticloadbalancing:loadbalancer" \
  --tag-filters "Key=Name,Values=${ALB_NAME_TAG}" \
  --query 'ResourceTagMappingList[0].ResourceARN' --output text 2>/dev/null) || ALB_ARN=""
if [ -z "$ALB_ARN" ] || [ "$ALB_ARN" = "None" ]; then
  ALB_ARN=$(aws elbv2 describe-load-balancers --region "$AWS_REGION" \
    --names "$ALB_NAME_TAG" \
    --query 'LoadBalancers[0].LoadBalancerArn' --output text 2>/dev/null) || ALB_ARN=""
fi
if [ -z "$ALB_ARN" ] || [ "$ALB_ARN" = "None" ]; then
  echo -e "${RED}Error: No load balancer found named/tagged ${ALB_NAME_TAG}.${NC}"; exit 1
fi

read -r SG_ID ALB_VPC <<<"$(aws elbv2 describe-load-balancers \
  --load-balancer-arns "$ALB_ARN" --region "$AWS_REGION" \
  --query 'LoadBalancers[0].[SecurityGroups[0],VpcId]' --output text)"

# A private IP of the ALB (its ENIs live in the VPC subnets)
ALB_IP=$(aws ec2 describe-network-interfaces --region "$AWS_REGION" \
  --filters "Name=description,Values=*${ALB_NAME_TAG}*" \
  --query 'NetworkInterfaces[0].PrivateIpAddress' --output text 2>/dev/null) || ALB_IP=""
if [ -z "$ALB_IP" ] || [ "$ALB_IP" = "None" ]; then
  echo -e "${RED}Error: Could not find a private IP for the ALB.${NC}"; exit 1
fi

echo "  ALB SG:   $SG_ID"
echo "  ALB VPC:  $ALB_VPC"
echo "  ALB IP:   $ALB_IP (private)"

# --- 2. Pick a jump host in the same VPC --------------------------------------
echo ""
echo "==> Selecting jump-host EC2 instance (same VPC)..."

# Prefer an ArangoDB instance in the ALB's VPC.
read -r INSTANCE_ID JUMP_IP <<<"$(aws ec2 describe-instances --region "$AWS_REGION" \
  --filters "Name=tag:Name,Values=${PROJECT_NAME}-*arangodb" \
            "Name=instance-state-name,Values=running" \
            "Name=vpc-id,Values=${ALB_VPC}" \
  --query 'Reservations[0].Instances[0].[InstanceId,PrivateIpAddress]' --output text 2>/dev/null)"

if [ -z "$INSTANCE_ID" ] || [ "$INSTANCE_ID" = "None" ]; then
  echo "  No ArangoDB instance found; falling back to any running instance in the VPC."
  read -r INSTANCE_ID JUMP_IP <<<"$(aws ec2 describe-instances --region "$AWS_REGION" \
    --filters "Name=instance-state-name,Values=running" \
              "Name=vpc-id,Values=${ALB_VPC}" \
    --query 'Reservations[0].Instances[0].[InstanceId,PrivateIpAddress]' --output text 2>/dev/null)"
fi

if [ -z "$INSTANCE_ID" ] || [ "$INSTANCE_ID" = "None" ]; then
  echo -e "${RED}Error: No running EC2 instance in VPC ${ALB_VPC} to use as a jump host.${NC}"; exit 1
fi
echo "  Jump host: $INSTANCE_ID ($JUMP_IP)"

# --- 3. Temporarily authorize the jump host on the ALB SG ---------------------
echo ""
echo "==> Authorizing ${JUMP_IP}/32 on ${SG_ID}:${REMOTE_PORT} (temporary)..."
if AUTH_ERR=$(aws ec2 authorize-security-group-ingress --region "$AWS_REGION" \
     --group-id "$SG_ID" \
     --ip-permissions "IpProtocol=tcp,FromPort=${REMOTE_PORT},ToPort=${REMOTE_PORT},IpRanges=[{CidrIp=${JUMP_IP}/32,Description=\"temp alb-tunnel.sh jump host\"}]" \
     2>&1 >/dev/null); then
  RULE_ADDED=1
  echo -e "${GREEN}    Added (will be revoked on exit).${NC}"
elif printf '%s' "$AUTH_ERR" | grep -q 'InvalidPermission.Duplicate'; then
  # Rule already exists (e.g. left over) -- proceed but DON'T revoke on exit.
  echo -e "${YELLOW}    Rule already present; proceeding without managing it.${NC}"
else
  # Any other error (auth failure, API error, bad input) is fatal: a tunnel
  # without the SG rule won't work, so fail with the actual AWS error.
  echo -e "${RED}Error: failed to authorize ${JUMP_IP}/32 on ${SG_ID}:${REMOTE_PORT}${NC}"
  echo -e "${RED}${AUTH_ERR}${NC}"
  exit 1
fi

# --- 4. Open the tunnel to the ALB private IP ---------------------------------
echo ""
echo -e "${GREEN}==> Tunnel info${NC}"
echo "  Jump host:  $INSTANCE_ID"
echo "  Forwarding: localhost:${LOCAL_PORT} → ${ALB_IP}:${REMOTE_PORT} (ALB private)"
echo ""
echo "  Open: https://localhost:${LOCAL_PORT}/   (use -k / accept the cert warning)"
echo ""
echo -e "${YELLOW}Starting SSM port-forwarding session... (Ctrl+C to stop & clean up)${NC}"
echo ""

# Run in the background and wait on it, so a Ctrl+C interrupts the wait and the
# cleanup trap fires immediately (a foreground session would defer the trap).
aws ssm start-session \
  --target "$INSTANCE_ID" \
  --region "$AWS_REGION" \
  --document-name AWS-StartPortForwardingSessionToRemoteHost \
  --parameters "{\"host\":[\"${ALB_IP}\"],\"portNumber\":[\"${REMOTE_PORT}\"],\"localPortNumber\":[\"${LOCAL_PORT}\"]}" &
SSM_PID=$!

# --- Optional: run the shared smoke test against the tunnelled localhost -------
if [ -n "$SMOKE" ]; then
  # Wait for the forwarded port to accept connections.
  for _ in $(seq 1 30); do
    nc -z localhost "$LOCAL_PORT" 2>/dev/null && break
    kill -0 "$SSM_PID" 2>/dev/null || break   # session died early
    sleep 0.5
  done
  echo ""
  echo -e "${GREEN}==> Smoke test (localhost via tunnel)${NC}"
  # Reuse the canonical probes; -k because the ALB cert won't match localhost.
  "$REPO_ROOT/scripts/ops/smoke-test.sh" "$ENVIRONMENT" \
    --url "https://localhost:${LOCAL_PORT}" --insecure || true
  echo ""
  echo -e "${YELLOW}Tunnel still open — Ctrl+C to stop & clean up.${NC}"
fi

wait "$SSM_PID"
