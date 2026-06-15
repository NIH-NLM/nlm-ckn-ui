#!/bin/bash
# ==============================================================================
# put-dashboard.sh - Create/update a CloudWatch dashboard correlating the
#                    ALB, the backend ECS service, and the ArangoDB EC2 host.
# ==============================================================================
# One pane of glass for the recurring "Request failed: 504" investigations:
# ALB traffic/errors/latency on the same time axis as backend ECS usage/health
# and the ArangoDB host's CPU + burst credits + EBS + network.
#
# Resource IDs are resolved at run time (the ArangoDB instance id changes on
# every CloudFormation replacement, e.g. an instance-type resize), so just
# re-run this after any arango stack change to repoint the dashboard.
#
# USAGE:
#   AWS_PROFILE=springbok ./scripts/ops/put-dashboard.sh [env]   # default: stage
# ==============================================================================
set -euo pipefail

ENVIRONMENT="${1:-stage}"
P=cell-kn
export AWS_REGION="${AWS_REGION:-us-east-1}"
DASH="${P}-${ENVIRONMENT}-correlation"
CLUSTER="${P}-${ENVIRONMENT}-cluster"
SERVICE="${P}-${ENVIRONMENT}-backend"
BACKEND_LOG="/ecs/${P}-${ENVIRONMENT}-backend"

echo "Resolving resources for $ENVIRONMENT ..."
LB=$(aws elbv2 describe-load-balancers --names "${P}-${ENVIRONMENT}-alb" \
  --query 'LoadBalancers[0].LoadBalancerArn' --output text | sed 's#.*:loadbalancer/##')
BACKEND_TG=$(aws elbv2 describe-target-groups --names "${P}-${ENVIRONMENT}-backend-tg" \
  --query 'TargetGroups[0].TargetGroupArn' --output text | sed 's#.*:##')
ARANGO_TG=$(aws elbv2 describe-target-groups --names "${P}-${ENVIRONMENT}-arangodb-tg" \
  --query 'TargetGroups[0].TargetGroupArn' --output text | sed 's#.*:##')
INST=$(aws cloudformation describe-stacks --stack-name "${P}-${ENVIRONMENT}-arangodb" \
  --query "Stacks[0].Outputs[?OutputKey=='InstanceId'].OutputValue" --output text)
VOL=$(aws ec2 describe-volumes --filters Name=tag:Name,Values="${P}-${ENVIRONMENT}-arangodb-data" \
  --query 'Volumes[0].VolumeId' --output text)

for v in LB BACKEND_TG ARANGO_TG INST VOL; do
  [ -z "${!v}" ] || [ "${!v}" = "None" ] && { echo "ERROR: could not resolve $v"; exit 1; }
done
echo "  LB=$LB  inst=$INST  vol=$VOL"

# Build the dashboard body. Python keeps the JSON/quoting sane.
BODY=$(LB="$LB" BACKEND_TG="$BACKEND_TG" ARANGO_TG="$ARANGO_TG" INST="$INST" VOL="$VOL" \
  REGION="$AWS_REGION" CLUSTER="$CLUSTER" SERVICE="$SERVICE" BACKEND_LOG="$BACKEND_LOG" \
  ENV="$ENVIRONMENT" \
  python3 - <<'PY'
import json, os
R=os.environ["REGION"]; LB=os.environ["LB"]; BTG=os.environ["BACKEND_TG"]
ATG=os.environ["ARANGO_TG"]; INST=os.environ["INST"]; VOL=os.environ["VOL"]
CL=os.environ["CLUSTER"]; SVC=os.environ["SERVICE"]; LOG=os.environ["BACKEND_LOG"]
ENV=os.environ["ENV"]
AE="AWS/ApplicationELB"

def w(x,y,wd,h,props):
    props["region"]=R
    return {"type":props.pop("_t","metric"),"x":x,"y":y,"width":wd,"height":h,"properties":props}

widgets=[
  # Row 1 -- ALB traffic/errors  |  ALB latency
  w(0,0,12,6,{"title":"ALB: traffic & errors","view":"timeSeries","stat":"Sum","period":300,"metrics":[
      [AE,"RequestCount","LoadBalancer",LB,{"label":"Requests"}],
      [AE,"HTTPCode_Target_5XX_Count","LoadBalancer",LB,{"label":"Target 5XX"}],
      [AE,"HTTPCode_ELB_5XX_Count","LoadBalancer",LB,{"label":"ELB 5XX"}],
      [AE,"HTTPCode_ELB_504_Count","LoadBalancer",LB,{"label":"ELB 504"}]]}),
  w(12,0,12,6,{"title":"ALB: target response time","view":"timeSeries","period":300,"metrics":[
      [AE,"TargetResponseTime","LoadBalancer",LB,{"stat":"Average","label":"avg"}],
      [AE,"TargetResponseTime","LoadBalancer",LB,{"stat":"p90","label":"p90"}],
      [AE,"TargetResponseTime","LoadBalancer",LB,{"stat":"Maximum","label":"max"}]],
      "yAxis":{"left":{"label":"seconds","showUnits":False}}}),

  # Row 2 -- backend ECS usage  |  backend target health
  w(0,6,12,6,{"title":"Backend ECS: CPU & memory %","view":"timeSeries","stat":"Average","period":300,"metrics":[
      ["AWS/ECS","CPUUtilization","ClusterName",CL,"ServiceName",SVC,{"label":"CPU %"}],
      ["AWS/ECS","MemoryUtilization","ClusterName",CL,"ServiceName",SVC,{"label":"Mem %"}]],
      "yAxis":{"left":{"min":0,"max":100}}}),
  w(12,6,12,6,{"title":"Backend targets: health","view":"timeSeries","period":300,"metrics":[
      [AE,"HealthyHostCount","TargetGroup",BTG,"LoadBalancer",LB,{"stat":"Average","label":"healthy"}],
      [AE,"UnHealthyHostCount","TargetGroup",BTG,"LoadBalancer",LB,{"stat":"Maximum","label":"unhealthy"}]]}),

  # Row 3 -- DB host CPU + burst credits  |  DB EBS + network
  w(0,12,12,6,{"title":"ArangoDB EC2: CPU % & burst credits","view":"timeSeries","stat":"Average","period":300,"metrics":[
      ["AWS/EC2","CPUUtilization","InstanceId",INST,{"label":"CPU %"}],
      ["CWAgent","mem_used_percent","InstanceId",INST,{"label":"Mem %"}],
      ["AWS/EC2","CPUCreditBalance","InstanceId",INST,{"label":"credit balance","yAxis":"right"}],
      ["AWS/EC2","CPUSurplusCreditBalance","InstanceId",INST,{"label":"surplus (billed)","yAxis":"right"}]],
      "yAxis":{"left":{"label":"CPU / Mem %","min":0,"max":100},"right":{"label":"credits","showUnits":False}}}),
  w(12,12,12,6,{"title":"ArangoDB EBS + network","view":"timeSeries","period":300,"metrics":[
      ["AWS/EBS","VolumeReadOps","VolumeId",VOL,{"stat":"Sum","label":"read ops"}],
      ["AWS/EBS","VolumeWriteOps","VolumeId",VOL,{"stat":"Sum","label":"write ops"}],
      ["AWS/EBS","VolumeQueueLength","VolumeId",VOL,{"stat":"Average","label":"queue len","yAxis":"right"}],
      ["AWS/EC2","NetworkOut","InstanceId",INST,{"stat":"Average","label":"net out","yAxis":"right"}]],
      "yAxis":{"right":{"showUnits":False}}}),

  # Row 4 -- arango target-group state  |  gunicorn worker timeouts (logs)
  w(0,18,8,6,{"title":"ArangoDB target-group health (orphaned check)","view":"timeSeries","period":300,"metrics":[
      [AE,"HealthyHostCount","TargetGroup",ATG,"LoadBalancer",LB,{"stat":"Average","label":"healthy"}],
      [AE,"UnHealthyHostCount","TargetGroup",ATG,"LoadBalancer",LB,{"stat":"Maximum","label":"unhealthy"}]]}),
  w(8,18,16,6,{"_t":"log","title":"Backend: gunicorn WORKER TIMEOUTs","view":"table",
      "query":"SOURCE '%s' | fields @timestamp, @message | filter @message like /WORKER TIMEOUT/ | sort @timestamp desc | limit 50" % LOG}),

  # Row 5 -- ArangoDB RocksDB cache (leading signals)  |  host wedge detection
  # Custom metrics pushed by the monitoring stack (cell-kn-<env>-monitoring):
  #   CellKN/ArangoDB  scraped from /_admin/metrics/v2
  #   CellKN/Monitoring  SSM/EC2 wedge-signature check
  # A sustained drop in recent hit rate is the early "cold/slow DB" warning;
  # WedgeSuspected=1 is the 2026-06-15 outage signature (SSM lost + EC2 ok/ok).
  w(0,24,12,6,{"title":"ArangoDB RocksDB cache (leading signal)","view":"timeSeries","period":60,"metrics":[
      ["CellKN/ArangoDB","rocksdb_cache_hit_rate_recent","Environment",ENV,{"stat":"Average","label":"recent hit rate"}],
      ["CellKN/ArangoDB","rocksdb_block_cache_fill_ratio","Environment",ENV,{"stat":"Average","label":"block cache fill"}],
      ["CellKN/ArangoDB","arangodb_search_columns_cache_size","Environment",ENV,{"stat":"Average","label":"search cols cache (bytes)","yAxis":"right"}]],
      "yAxis":{"left":{"label":"ratio","min":0,"max":1},"right":{"label":"bytes","showUnits":False}}}),
  w(12,24,12,6,{"title":"ArangoDB host wedge detection","view":"timeSeries","period":60,"metrics":[
      ["CellKN/Monitoring","WedgeSuspected","Environment",ENV,{"stat":"Maximum","label":"wedge suspected"}],
      ["CellKN/Monitoring","SsmConnectionLost","Environment",ENV,{"stat":"Maximum","label":"SSM ConnectionLost"}],
      ["CellKN/Monitoring","Ec2StatusOk","Environment",ENV,{"stat":"Minimum","label":"EC2 ok/ok"}]],
      "yAxis":{"left":{"min":0,"max":1}}}),
]
print(json.dumps({"widgets":widgets}))
PY
)

echo "Putting dashboard '$DASH' ..."
aws cloudwatch put-dashboard --dashboard-name "$DASH" --dashboard-body "$BODY" \
  --query 'DashboardValidationMessages' --output table

echo "Done: https://${AWS_REGION}.console.aws.amazon.com/cloudwatch/home?region=${AWS_REGION}#dashboards/dashboard/${DASH}"
