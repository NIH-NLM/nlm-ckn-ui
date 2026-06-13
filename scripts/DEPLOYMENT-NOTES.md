# Deployment Notes

A mental model for how `scripts/` and the GitHub workflows fit together, plus
the procedure for deploying an ArangoDB golden dump. For per-script usage detail
see [`README.md`](./README.md).

## Architecture in one paragraph

Everything keys off two constants — `PROJECT_NAME="cell-kn"` and
`AWS_REGION=us-east-1` — and a strict stack-naming convention
(`cell-kn-<env>`, `cell-kn-<env>-frontend`, `cell-kn-<env>-arangodb`,
`cell-kn-<env>-backend`). Scripts discover everything else at runtime from
CloudFormation outputs/exports, SSM parameters, and Secrets Manager rather than
hardcoding ARNs, so the same script works across `dev` / `stage` / `sandbox` /
`prod`. Scripts are split into **infra** (provision/change AWS resources, run
rarely) and **app** (ship code to existing resources, run every release), with
standalone ops scripts at the top level.

## Script map

| Script | Layer | Purpose |
|---|---|---|
| `infra/deploy-account-setup.sh` | infra | One-time per account: bootstrap stack (S3 template bucket, GitHub OIDC role, IAM) + shared stack (ECR repo, ArangoDB S3 bucket). Writes `ecr-url` and `arangodb-bucket-name` to SSM. |
| `infra/deploy-environment.sh <env>` | infra | Provisions one environment via changesets (diff preview, replacement warnings, confirmation prompt). Phase 1: `cell-kn-<env>`. Phase 2: frontend → arangodb → backend. |
| `app/push-backend-image.sh` | app | Build + push backend image only (bootstrap before first env deploy; also tags `latest`). |
| `app/deploy-backend.sh <env>` | app | Build → push (immutable git-SHA tag) → register ECS task def → update service → wait stable. |
| `app/deploy-frontend.sh <env>` | app | `npm ci` + build → `s3 sync --delete` → CloudFront invalidation. |
| `app/deploy-dataset.sh [--force] <env>` | app | Deploy the dataset named in `ETL_VERSION` via a blue-green `arangorestore` on the EC2 instance (see below). |
| `app/deploy-all.sh` | app | Runs backend then frontend in sequence. |
| `arango-tunnel.sh [env]` | ops | SSM port-forward `localhost:8530 → instance:8529` (no SSH / public IP). |
| `backup-arangodb.sh <env>` | ops | ECS-Exec tar of the data dirs to `s3://.../backups/`. **Note: appears stale** — rejects `stage`, assumes the old ECS-container ArangoDB layout. |

## Workflow map

All deploy workflows authenticate via **GitHub OIDC** (assume
`role/cell-kn-github-actions`, created by the bootstrap stack) — no stored AWS keys.

| Workflow | Trigger | What it runs |
|---|---|---|
| `ci.yml` | PR + push to `main` | Change-gated test matrix (frontend lint/unit/E2E, backend unit/integration/Docker). On **push to `main`**, deploys changed components to `dev` via `deploy-frontend.sh` / `deploy-backend.sh`. |
| `deploy-dataset.yml` | push to `main` changing `ETL_VERSION`, or manual dispatch | `deploy-dataset.sh dev`. 110-min timeout; `cancel-in-progress: false` so a restore is never interrupted mid-swap. |
| `deploy-stage.yml` | `v*.*.*` tag | All three app scripts against `stage` (backend with `IMAGE_TAG=<tag>`, frontend, dataset). |
| `promote-to-upstream.yml` | push to `main` (fork only) | Fast-forwards / admin-merges `Springbok-LLC` → `NIH-NLM` upstream. Not AWS-related. |

## Deploying a golden dump

**Key fact: no script uploads the dump.** `deploy-dataset.sh` assumes the dump
already exists in S3 at a version-derived key and only flips a pointer + triggers
the restore. The expected key is hard-coded as:

```
runs/<ETL_VERSION>/06-golden-dump.tar.gz
```

in the shared bucket (name in SSM at `/cell-kn/shared/arangodb-bucket-name`).

**1. Upload your dump to the exact key** (`ETL_VERSION` here is `v1.4.6-alpha.34`):

```bash
BUCKET=$(aws ssm get-parameter \
  --name /cell-kn/shared/arangodb-bucket-name \
  --query Parameter.Value --output text --region us-east-1)

aws s3 cp /path/to/your-golden-dump.tar.gz \
  "s3://$BUCKET/runs/v1.4.6-alpha.34/06-golden-dump.tar.gz" \
  --region us-east-1
```

**2. Deploy**, either:

- **Via CI** — merge the `ETL_VERSION` change to `main`; `deploy-dataset.yml`
  runs `deploy-dataset.sh dev` automatically.
- **Locally** — `./scripts/app/deploy-dataset.sh dev` (add `--force` to
  re-restore an unchanged version).

### What the on-instance restore expects of the dump

The restore script (the `RESTORE_SCRIPT` heredoc) ships to the EC2 instance via
SSM Run Command and runs a blue-green swap with automatic rollback. Your dump
must satisfy:

- **Layout** — single-db (`MANIFEST.json` at root) vs. multi-db (no top-level
  manifest → `--all-databases true`) is auto-detected. A standard
  `arangodump --all-databases` then `tar -czf` is detected as multi-db. One
  wrapper directory inside the tarball is tolerated.
- **Expected databases** — after restore it verifies these exist and **rolls
  back** if any are missing: `Cell-KN-Ontologies`, `Cell-KN-Phenotypes`.
  Override with `EXPECTED_DBS="DB1 DB2" ./scripts/app/deploy-dataset.sh dev`.
- **Sidecar files (optional)** — named graphs and analyzers are *not* restored
  by `arangorestore`; they're imported from `<DB>/ckn-graphs.ndjson` and
  `<DB>/ckn-analyzers.ndjson` if present. Absent → silent no-op (graphs/analyzers
  won't come across).

## Re-running a failed dataset deploy

Safe to re-run. The S3 existence check runs **before** any state change (SSM
pointer write, restore dispatch), so a "file not there yet" failure leaves
everything untouched. After uploading the dump:

- **Re-run all jobs** on the failed run (pinned to that commit's SHA → still
  `v1.4.6-alpha.34`), or
- Use the **Run workflow** button (`workflow_dispatch`) — note this checks out
  the *current tip of `main`*, so it deploys whatever `ETL_VERSION` is there now.

The restore is idempotent regardless: without `--force` it no-ops if the target
version already matches the instance's `.dataset-version`, and the blue-green
swap rolls back on any failure — so a re-run can't corrupt the live database.
