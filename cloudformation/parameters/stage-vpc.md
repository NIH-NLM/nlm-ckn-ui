# Staging VPC Parameters

Parameter choices for `stage-vpc.json` / `cloudformation/network/vpc.yaml`.

## Deploy

```bash
aws cloudformation deploy \
  --stack-name cell-kn-stage-vpc \
  --template-file cloudformation/network/vpc.yaml \
  --parameter-overrides file://cloudformation/parameters/stage-vpc.json
```

After deploying, copy the stack outputs (`VpcId`, `PublicSubnetIds`, `PrivateSubnetIds`,
`VpcCidr`) into `cloudformation/parameters/stage.json` before running
`deploy-environment.sh stage`.

## Address space

| Parameter | Value | Notes |
|---|---|---|
| `VpcCidr` | `10.10.0.0/16` | 65,536 addresses. Non-overlapping with dev (`172.31.0.0/16`) and a conventional prod reservation (`10.0.0.0/16`). A `/16` costs nothing and avoids ever needing to resize the VPC. |
| `PublicSubnet1Cidr` | `10.10.0.0/24` | ALB, AZ-a. 251 usable IPs — well above ALB's typical 1–2, and its burst ceiling of ~8. |
| `PublicSubnet2Cidr` | `10.10.1.0/24` | ALB, AZ-b. ALB requires subnets in at least two AZs. |
| `PrivateSubnet1Cidr` | `10.10.10.0/24` | ECS + ArangoDB, AZ-a. Each Fargate task consumes one ENI/IP; 251 IPs per subnet is far above Staging's ceiling. |
| `PrivateSubnet2Cidr` | `10.10.11.0/24` | ECS, AZ-b. ECS distributes tasks across AZs automatically. |

## Layout rationale

```
10.10.0.0/16   Staging VPC
  10.10.0.0/24   public  AZ-a  (ALB)
  10.10.1.0/24   public  AZ-b  (ALB)
  10.10.2–9      reserved — future public subnets or third AZ
  10.10.10.0/24  private AZ-a  (ECS + ArangoDB)
  10.10.11.0/24  private AZ-b  (ECS)
  10.10.12–19    reserved — future private subnets or third AZ
  10.10.20.0+    available for isolated/DB tiers if needed
```

Public subnets start at `.0.x`/`.1.x` and private subnets at `.10.x`/`.11.x` so the
pattern is consistent per AZ (AZ-a always ends in `.0`/`.10`, AZ-b in `.1`/`.11`).
The deliberate gap between public and private ranges leaves room to add a third AZ or
a new subnet tier without renumbering anything that already exists.
