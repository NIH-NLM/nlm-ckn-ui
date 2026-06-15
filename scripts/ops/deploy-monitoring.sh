#!/bin/bash
# ==============================================================================
# deploy-monitoring.sh - Deploy the ArangoDB monitoring / wedge-detection stack
# ==============================================================================
# Deploys cloudformation/environment/monitoring.yaml as the standalone stack
#   cell-kn-<env>-monitoring
# resolving the private subnets and ArangoDB security group from the infra stack
# exports (dev/stage) or SSM prereqs (sandbox/prod), the same way
# deploy-environment.sh resolves them for the service stacks.
#
# This is an OPERATOR script — it shows a changeset and prompts before applying.
# It does NOT run automatically and is not wired into main.yaml.
#
# AFTER deploying, run once:
#   ./scripts/ops/create-monitor-user.sh <env>     # create the RO arango user
#   ./scripts/ops/put-dashboard.sh <env>           # add cache/wedge widgets
#
# USAGE:
#   AWS_PROFILE=springbok ./scripts/ops/deploy-monitoring.sh [env]   # default: stage
#   AUTO_REMEDIATE=true ALARM_EMAIL=you@example.com ... ./deploy-monitoring.sh stage
# ==============================================================================
set -euo pipefail

ENVIRONMENT="${1:-stage}"
PROJECT_NAME="cell-kn"
export AWS_REGION="${AWS_REGION:-us-east-1}"
STACK_NAME="${PROJECT_NAME}-${ENVIRONMENT}-monitoring"
TEMPLATE="cloudformation/environment/monitoring.yaml"
AUTO_REMEDIATE="${AUTO_REMEDIATE:-false}"
ALARM_EMAIL="${ALARM_EMAIL:-}"
SCHEDULE_EXPRESSION="${SCHEDULE_EXPRESSION:-rate(1 minute)}"

if [[ ! "$ENVIRONMENT" =~ ^(dev|stage|sandbox|prod)$ ]]; then
  echo "Error: environment must be dev, stage, sandbox, or prod" >&2
  exit 1
fi

# Resolve private subnets + arango SG (export in dev/stage, SSM in sandbox/prod)
echo "==> Resolving network inputs for ${ENVIRONMENT}..."
SUBNETS=$(aws cloudformation list-exports --region "$AWS_REGION" \
  --query "Exports[?Name=='${PROJECT_NAME}-${ENVIRONMENT}-private-subnet-ids'].Value" --output text)
ARANGO_SG=$(aws cloudformation list-exports --region "$AWS_REGION" \
  --query "Exports[?Name=='${PROJECT_NAME}-${ENVIRONMENT}-arangodb-sg-id'].Value" --output text)

if [ -z "$ARANGO_SG" ] || [ "$ARANGO_SG" = "None" ]; then
  echo "  (no export; falling back to SSM prereqs — sandbox/prod)"
  ARANGO_SG=$(aws ssm get-parameter --name "/${PROJECT_NAME}/${ENVIRONMENT}/prereqs/sg-arangodb" \
    --query 'Parameter.Value' --output text --region "$AWS_REGION")
  SUBNETS=$(aws ssm get-parameter --name "/${PROJECT_NAME}/${ENVIRONMENT}/prereqs/private-subnet-ids" \
    --query 'Parameter.Value' --output text --region "$AWS_REGION" 2>/dev/null || echo "$SUBNETS")
fi
[ -n "$SUBNETS" ] && [ "$SUBNETS" != "None" ] || { echo "Error: could not resolve private subnets" >&2; exit 1; }
[ -n "$ARANGO_SG" ] && [ "$ARANGO_SG" != "None" ] || { echo "Error: could not resolve arango SG" >&2; exit 1; }

# ArangoDB instance id for the host CPU/memory alarms. The id changes on every
# instance replacement, so we re-resolve it here — re-run this script after any
# arango stack change to re-point the alarms. Empty -> alarms are skipped.
INSTANCE_ID=$(aws cloudformation describe-stacks \
  --stack-name "${PROJECT_NAME}-${ENVIRONMENT}-arangodb" --region "$AWS_REGION" \
  --query "Stacks[0].Outputs[?OutputKey=='InstanceId'].OutputValue" --output text 2>/dev/null || echo '')
[ "$INSTANCE_ID" = "None" ] && INSTANCE_ID=''

# ALB dimension (app/<name>/<hash>) for the ALB error/latency alarms. Stable
# across deploys. Empty -> ALB alarms are skipped (e.g. environments w/o an ALB).
ALB_DIM=$(aws elbv2 describe-load-balancers --names "${PROJECT_NAME}-${ENVIRONMENT}-alb" \
  --region "$AWS_REGION" --query 'LoadBalancers[0].LoadBalancerArn' --output text 2>/dev/null \
  | sed 's#.*:loadbalancer/##')
{ [ "$ALB_DIM" = "None" ] || [ "$ALB_DIM" = "null" ]; } && ALB_DIM=''

echo "  Subnets:  $SUBNETS"
echo "  ArangoSG: $ARANGO_SG"
echo "  Instance: ${INSTANCE_ID:-<none; host CPU/memory alarms skipped>}"
echo "  ALB dim:  ${ALB_DIM:-<none; ALB alarms skipped>}"
echo "  AutoRemediate: $AUTO_REMEDIATE   Schedule: $SCHEDULE_EXPRESSION"

echo "==> Creating changeset for ${STACK_NAME}..."
aws cloudformation deploy \
  --stack-name "$STACK_NAME" \
  --template-file "$TEMPLATE" \
  --capabilities CAPABILITY_NAMED_IAM \
  --region "$AWS_REGION" \
  --no-execute-changeset \
  --parameter-overrides \
    ProjectName="$PROJECT_NAME" \
    Environment="$ENVIRONMENT" \
    PrivateSubnetIds="$SUBNETS" \
    ArangoDbSecurityGroupId="$ARANGO_SG" \
    ArangoDbInstanceId="$INSTANCE_ID" \
    AlbDimension="$ALB_DIM" \
    ScheduleExpression="$SCHEDULE_EXPRESSION" \
    AutoRemediate="$AUTO_REMEDIATE" \
    AlarmEmail="$ALARM_EMAIL"

echo ""
echo "Review the changeset above in the CloudFormation console, then execute it,"
echo "or re-run without --no-execute-changeset by running:"
echo ""
echo "  aws cloudformation deploy --stack-name $STACK_NAME --template-file $TEMPLATE \\"
echo "    --capabilities CAPABILITY_NAMED_IAM --region $AWS_REGION \\"
echo "    --parameter-overrides ProjectName=$PROJECT_NAME Environment=$ENVIRONMENT \\"
echo "      PrivateSubnetIds=\"$SUBNETS\" ArangoDbSecurityGroupId=$ARANGO_SG \\"
echo "      ScheduleExpression=\"$SCHEDULE_EXPRESSION\" AutoRemediate=$AUTO_REMEDIATE AlarmEmail=\"$ALARM_EMAIL\""
