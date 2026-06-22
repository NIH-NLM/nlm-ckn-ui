# Sandbox scripts

Helpers for the NLM **sandbox** account (`206537881715`). It doesn't follow the
`cell-kn-<env>-*` CloudFormation conventions the standard `deploy-*.sh` scripts
assume, and its architecture differs (frontend served via ALB→S3 with no
CloudFront; backend runs as a plain docker container on EC2, not an ECS
service). Resource names are resolved from a stable exports/SSM contract in
[`resolve-env.sh`](resolve-env.sh).

All commands need AWS credentials for the account — locally, `AWS_PROFILE=nlmsandbox`.

## `deploy-sandbox.sh` — promote stage artifacts into sandbox

Sandbox does **not** build anything. It promotes already-built springbok
**stage** artifacts cross-account, the same way the ArangoDB dataset is pulled
from the springbok S3 bucket:

- **frontend** — `s3 sync` from the stage frontend bucket into the sandbox
  bucket (cross-account read granted in
  `cloudformation/environment/frontend.yaml`, `IsStage` condition).
- **backend** — the EC2 host pulls the requested image tag directly from the
  shared `cell-kn-backend` ECR repo (cross-account pull granted in
  `cloudformation/shared/shared-resources.yaml`), then the container is
  recreated in place via SSM, preserving its env / ports / restart policy.
- **dataset** — blue-green ArangoDB restore via SSM from the springbok dataset
  bucket (key selected by the repo-root `ETL_VERSION`).

Both app artifacts are environment-agnostic (frontend makes same-origin/relative
API calls; backend config is injected as host env vars at recreate time), so the
stage build runs unchanged in sandbox.

```bash
# Promote a specific stage image tag (required for backend / all):
AWS_PROFILE=nlmsandbox IMAGE_TAG=<stage-tag> ./scripts/sandbox/deploy-sandbox.sh [frontend|backend|dataset|all]
# default target: all
```

Notes:
- `IMAGE_TAG` is the stage image tag to promote and is **required** for
  `backend` and `all`; the script fails fast if it's missing.
- `FORCE=true` re-runs the dataset restore even if the host already reports the
  target version.
- The backend pre-flight tag check is best-effort: the deploy identity often
  lacks cross-account `ecr:DescribeImages`, so the host's `docker pull` is the
  authoritative gate. A genuinely missing tag still fails (on the host) with a
  clear `manifest unknown`.
- **Ordering:** the stage frontend bucket policy must be deployed (push the
  `cell-kn-stage-frontend` stack) before the first frontend promotion.

## `alb-tunnel.sh` — reach the sandbox app from your laptop

The sandbox ALB is internet-facing but its security group only trusts NLM
developer CIDRs and the subnet NACL blocks the proxy path, so it's not reachable
directly. This opens an SSM port-forward through an in-VPC jump host:

1. Looks up the ALB by tag (`Name=cell-kn-<env>-alb`) — its security group and a
   private (in-VPC) IP.
2. Picks a running EC2 instance in the same VPC as the ALB to use as the SSM
   jump host.
3. Temporarily authorizes the jump host's private IP on the ALB security group
   for the target port.
4. Opens an SSM port-forward to the ALB's **private** IP (source stays in-VPC,
   matching the SG rule).
5. On exit (Ctrl+C / error) **revokes** the SG rule it added.

```bash
AWS_PROFILE=nlmsandbox ./scripts/sandbox/alb-tunnel.sh [environment] \
    [--remote-port N] [--local-port N] [--no-smoke]
# environment:   dev|stage|sandbox|prod   (default: sandbox)
# --remote-port: ALB listener port        (default: 443)
# --local-port:  local bind port          (default: 8530)
```

Then open `https://localhost:<local-port>/` (use `-k` / accept the cert warning;
the ALB serves its default cert and routes by path).

Requires the AWS CLI + Session Manager plugin and permission to authorize/revoke
ingress on the ALB security group.

## Other files

- [`resolve-env.sh`](resolve-env.sh) — resolves resource names for an
  environment (run directly to print the resolved table).
- [`arango-restore-remote.sh.tmpl`](arango-restore-remote.sh.tmpl) — the
  blue-green restore script templated onto the Arango host by `deploy-sandbox.sh`.
