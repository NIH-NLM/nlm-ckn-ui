# Troubleshooting

## Check Deployment Status

```bash
# Overall stack status
aws cloudformation describe-stacks \
  --stack-name cell-kn-dev \
  --query 'Stacks[0].StackStatus'

# List all stack events (useful when a deploy fails)
aws cloudformation describe-stack-events \
  --stack-name cell-kn-dev \
  --query 'StackEvents[?ResourceStatus==`CREATE_FAILED` || ResourceStatus==`UPDATE_FAILED`].[LogicalResourceId,ResourceStatusReason]' \
  --output table

# ECS service health
aws ecs describe-services \
  --cluster cell-kn-dev-cluster \
  --services cell-kn-dev-backend cell-kn-dev-arangodb \
  --query 'services[*].{Name:serviceName,Status:status,Desired:desiredCount,Running:runningCount}'

# Recent backend logs
aws logs tail /ecs/cell-kn-dev-backend --follow

# Recent ArangoDB logs
aws logs tail /ecs/cell-kn-dev-arangodb --follow
```

---

## Stack Creation Fails

**Security groups can't be created**
Verify the VPC ID is correct and you have EC2 permissions. In sandbox/prod, ensure all 9 SSM prereq parameters are populated before deploying — see [Pre-Requisites for Restricted Accounts](README.md#pre-requisites-for-restricted-accounts-sandboxprod).

**Subnets not found**
Verify subnet IDs exist in the specified VPC and belong to the correct region.

**ACM certificate validation timeout**
Verify the Route 53 hosted zone ID is correct and you have permission to create DNS records in it. Certificate validation can take up to 30 minutes if DNS propagation is slow.

**`{{resolve:ssm:...}}` parameter not found**
A required SSM prereq parameter is missing (sandbox/prod only). Check which one:
```bash
ENV=sandbox
PROJECT=cell-kn
for param in sg-alb sg-backend sg-arangodb sg-efs \
  iam-arangodb-exec-arn iam-arangodb-task-arn \
  iam-backend-exec-arn iam-backend-task-arn \
  iam-random-secret-fn-arn; do
  aws ssm get-parameter --name "/${PROJECT}/${ENV}/prereqs/${param}" \
    --query 'Parameter.Value' --output text 2>&1 | \
    grep -q "ParameterNotFound" && echo "MISSING: ${param}" || echo "OK: ${param}"
done
```

---

## ECS Tasks Not Starting

**Tasks fail to pull ECR image**
```bash
# Verify the ECR repository exists and has images
aws ecr describe-images \
  --repository-name cell-kn-backend \
  --query 'sort_by(imageDetails,&imagePushedAt)[-5:].imageTags' \
  --output table

# Push the backend image if empty
./scripts/deploy-backend.sh dev
```

**Tasks stuck in PENDING or fail immediately**
```bash
# Check stopped task details for the failure reason
aws ecs list-tasks \
  --cluster cell-kn-dev-cluster \
  --desired-status STOPPED \
  --family cell-kn-dev-backend

aws ecs describe-tasks \
  --cluster cell-kn-dev-cluster \
  --tasks TASK_ARN \
  --query 'tasks[0].containers[*].{Name:name,Reason:reason,ExitCode:exitCode}'
```

**Tasks fail with networking errors**
1. Verify private subnets have a route to a NAT Gateway
2. Check security group rules allow outbound traffic on all ports

---

## Backend Not Responding

**Check the active image tag**
```bash
aws ssm get-parameter \
  --name /cell-kn/dev/backend/image-tag \
  --query 'Parameter.Value' --output text
```

**Roll back to a previous image**
```bash
# List recent image tags
aws ecr describe-images \
  --repository-name cell-kn-backend \
  --query 'sort_by(imageDetails,&imagePushedAt)[-10:].imageTags[0]' \
  --output table

# Deploy a specific tag
IMAGE_TAG=abc1234 ./scripts/deploy-backend.sh dev
```

---

## CloudFront Not Serving Content

**CloudFront returns 403**
```bash
# Check the S3 bucket has content
aws s3 ls s3://cell-kn-dev-frontend/

# Deploy frontend assets and invalidate cache
cd react && npm run build
aws s3 sync build/ s3://cell-kn-dev-frontend/ --delete
aws cloudfront create-invalidation \
  --distribution-id $(aws cloudformation describe-stacks \
    --stack-name cell-kn-dev \
    --query 'Stacks[0].Outputs[?OutputKey==`CloudFrontDistributionId`].OutputValue' \
    --output text) \
  --paths "/*"
```

**Custom domain doesn't resolve**
1. Wait 5-10 minutes for DNS propagation
2. Verify the Route 53 record was created:
```bash
dig dev.cell-kn-mvp.org
aws route53 list-resource-record-sets \
  --hosted-zone-id Z018047920VCMG6465Q74 \
  --query 'ResourceRecordSets[?Name==`dev.cell-kn-mvp.org.`]'
```

---

## ArangoDB Issues

**Check dataset version**
```bash
aws ssm get-parameter \
  --name /cell-kn/dev/arango/dataset-version \
  --query 'Parameter.Value' --output text
```

**Force a dataset reload**
```bash
./scripts/deploy-dataset.sh dev datasets/your-file.tar.gz
```

**EFS mount issues — tasks start but ArangoDB fails immediately**
Check EFS mount target status:
```bash
EFS_ID=$(aws cloudformation describe-stacks \
  --stack-name cell-kn-dev \
  --query 'Stacks[0].Outputs[?OutputKey==`ArangoDbEfsId`].OutputValue' \
  --output text)

aws efs describe-mount-targets \
  --file-system-id "$EFS_ID" \
  --query 'MountTargets[*].{State:LifeCycleState,SubnetId:SubnetId}'
```
Mount targets must be in `available` state before ECS tasks start.
