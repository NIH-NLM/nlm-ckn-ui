# Deployment Notes

A mental model for how `scripts/` and the GitHub workflows fit together, plus
the procedure for deploying an ArangoDB golden dump. For per-script usage detail
see [`README.md`](./README.md).

## Architecture in one paragraph

Everything keys off two constants — `PROJECT_NAME="nlm-ckn"` (defined once in
[`common.sh`](./common.sh), sourced by the app + ops scripts) and
`AWS_REGION=us-east-1` — and a strict
stack-naming convention (`nlm-ckn-<env>`, `nlm-ckn-<env>-frontend`,
`nlm-ckn-<env>-arangodb`, `nlm-ckn-<env>-backend`). Scripts discover everything
else at runtime from CloudFormation outputs/exports, SSM parameters, and Secrets
Manager rather than hardcoding ARNs, so the same script works across `dev` /
`stage` / `prod`. Infrastructure provisioning (the CloudFormation stacks above)
lives in the [`nlm-ckn-iac`](https://github.com/Springbok-LLC/nlm-ckn-iac) repo;
the scripts here are **app** scripts (ship code to existing resources, run every
release) plus a few standalone ops scripts at the top level.

## Script map

Infrastructure provisioning (account setup, environment stacks) now lives in the
[`nlm-ckn-iac`](https://github.com/Springbok-LLC/nlm-ckn-iac) repo
(`deploy/01-deploy-account-setup.sh`, `deploy/02-deploy-environment.sh`). The
scripts in this repo:

| Script | Layer | Purpose |
|---|---|---|
| `app/push-backend-image.sh` | app | Build + push backend image only (bootstrap before first env deploy; also tags `latest`). |
| `app/deploy-backend.sh <env>` | app | Build → push (immutable git-SHA tag) → register ECS task def → update service → wait stable. |
| `app/deploy-frontend.sh <env>` | app | `npm ci` + build → `s3 sync --delete --exclude 'plots/*'` → CloudFront invalidation. The exclusion is load-bearing: without it `--delete` wipes the plot assets. |
| `app/deploy-dataset.sh [--force] <env>` | app | Deploy the dataset named in `ETL_VERSION` via a blue-green `arangorestore` on the EC2 instance (see below). |
| `app/deploy-assets.sh [--tag T] [--force] [--prune [N]] <env>` | app | Copy one nlm-ckn release's plot assets from the shared static-assets bucket into the environment's frontend bucket (see below). |
| `app/deploy-all.sh <env>` | app | Runs backend → frontend → assets → dataset in sequence. |
| `arango-tunnel.sh [env]` | ops | SSM port-forward `localhost:8530 → instance:8529` (no SSH / public IP). |
| `backup-arangodb.sh <env>` | ops | ECS-Exec tar of the data dirs to `s3://.../backups/`. **Note: appears stale** — rejects `stage`, assumes the old ECS-container ArangoDB layout. |

## Environments in other accounts (`int`, ...)

`deploy-dataset.sh` and `deploy-assets.sh` also deploy to environments that live
in other AWS accounts, without assuming anything about those accounts' stacks or
exports. Each is described by a file, `scripts/envs/<env>.conf`; adding an
environment means adding a file. See [`env-config.sh`](./env-config.sh) for the
loader and [`envs/int.conf`](./envs/int.conf) for the full key list.

- **Values** are fixed names or `ssm:<parameter>`, read in the target account.
  Any key already set in your shell wins over the file
  (`CKN_ARANGO_INSTANCE_ID=i-... ./scripts/app/deploy-dataset.sh int`). Each
  script resolves only the keys it uses.
- **Access:** run with your normal springbok credentials. The scripts assume
  `arn:aws:iam::<CKN_ACCOUNT_ID>:role/<CKN_ROLE_NAME>` (`nlm_aws_devops` for int)
  and do everything under it. If you are already in the target account, no role
  is assumed. The 90-minute restore re-assumes the role before its one-hour
  session expires.
- **Sources stay in springbok** and are read cross-account: the dataset bucket
  (dumps and `release.json`) and the static-assets bucket. Their names are fixed
  in the env file, because springbok's SSM is not readable from another account.
- **CloudFront and the public URL are optional.** With no `CKN_CF_DIST_ID`,
  the invalidation is skipped. With no `CKN_FRONTEND_URL`, the edge check and
  the post-restore smoke test are skipped.

Grants the target account needs (set up in IaC, not by these scripts):

| Who | Needs |
|---|---|
| `nlm_aws_devops` (target account) | read on both springbok buckets (bucket policy there + IAM here); write on the frontend bucket; `ssm:SendCommand`/`GetCommandInvocation` on the ArangoDB instance; read/write on the dataset-version parameter; CloudFront invalidation if configured |
| ArangoDB instance role (target account) | read on the springbok dataset bucket (it downloads the dump itself); its own root secret, and the read-only user's parameter and secret if configured |

## Workflow map

All deploy workflows authenticate via **GitHub OIDC** (assume
`role/nlm-ckn-github-actions`, created by the `nlm-ckn-iac` account-setup) — no
stored AWS keys.

| Workflow | Trigger | What it runs |
|---|---|---|
| `ci.yml` | PR + push to `main` | Change-gated test matrix (frontend lint/unit/E2E, backend unit/integration/Docker). On **push to `main`**, deploys changed components to `dev` via `deploy-frontend.sh` / `deploy-backend.sh`. Untouched by the asset work — it only needed the `--exclude`. |
| `deploy-dataset.yml` | push to `main` changing `ETL_VERSION`, or manual dispatch | Two jobs: `deploy-assets` (`deploy-assets.sh dev`), then `deploy-dataset` (`deploy-dataset.sh dev`) which `needs:` it. 110-min timeout on the restore; `cancel-in-progress: false` so a restore is never interrupted mid-swap. |
| `deploy-stage.yml` | `v*.*.*` tag | All four app scripts against `stage` (backend with `IMAGE_TAG=<tag>`, frontend, assets, dataset). |
| `promote-to-upstream.yml` | push to `main` (fork only) | Fast-forwards / admin-merges `Springbok-LLC` → `NIH-NLM` upstream. Not AWS-related. |
| `sync-collection-maps.yml` | change to `nlm-ckn-collection-maps.json` | Opens a PR against `nlm-ckn-etl` to keep the shared collection maps in step. Not AWS-related. |

## Deploying a golden dump

**Key fact: no script uploads the dump.** `deploy-dataset.sh` assumes the dump
already exists in S3 at a version-derived key and only flips a pointer + triggers
the restore. The expected key is hard-coded as:

```
runs/<ETL_VERSION>/06-golden-dump.tar.gz
```

in the shared bucket (name in SSM at `/nlm-ckn/shared/arangodb-bucket-name`).

**1. Upload your dump to the exact key** (`ETL_VERSION` here is `v1.4.6-alpha.34`):

```bash
BUCKET=$(aws ssm get-parameter \
  --name /nlm-ckn/shared/arangodb-bucket-name \
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

## Deploying plot assets

Each dataset release has a matching set of static plots — ~2,850 objects
(`.svg`, `.html`, one vendored `plotly-<ver>.min.js`), ~500 MB stored. They are
published **once per `nlm-ckn` release tag** by that repo's
`publish-plot-assets.yml` into a shared bucket, then copied into each
environment's frontend bucket by `app/deploy-assets.sh`.

### Where the version comes from

There is no new pin. `ETL_VERSION` already resolves to exactly one `nlm-ckn`
tag, via the `release.json` the ETL publishes for every run:

```
ETL_VERSION                                        # e.g. v1.6.0-rc.5
  -> s3://<arangodb bucket>/runs/<ETL_VERSION>/release.json
       -> .nlm_ckn_tag                             # e.g. v1.0.0-rc.10
            -> s3://<static assets bucket>/plots/<nlm_ckn_tag>/
```

The script prints the resolved `ETL_VERSION -> nlm_ckn_tag` mapping before it
copies anything. Every hop is fatal on failure — a wrong tag means a green
deploy with a bucket full of the wrong release's plots. `--tag` overrides the
lookup for ad-hoc runs; it has no default.

### Deploying

- **Via CI** — automatic. `deploy-dataset.yml` runs `deploy-assets` and then
  `deploy-dataset`, which `needs:` it; `deploy-stage.yml` runs the assets step
  between frontend and dataset. No separate trigger: `ETL_VERSION` is the pin
  for both.
- **Locally** — `./scripts/app/deploy-assets.sh dev`. Idempotent: it no-ops when
  the destination already holds the same object count for the tag (`--force`
  overrides). Runtime is 1–3 minutes.

### Two invariants that are easy to break

1. **Never add `--content-type`, `--cache-control` or `--metadata` to the
   copy.** Any of them flips the CLI to `MetadataDirective=REPLACE`, which
   silently drops the `Content-Encoding: gzip` the publisher set — every object
   then serves gzip bytes labelled as SVG/HTML and renders as nothing. Cache
   headers must be set at publish time in `nlm-ckn`. The script asserts the
   encoding survived, so a regression fails the deploy rather than shipping.
2. **Never drop `--exclude 'plots/*'`** from `deploy-frontend.sh` or
   `deploy-sandbox.sh`. Both sync with `--delete`; without the exclusion the
   next frontend-only deploy treats all ~2,850 objects as surplus and deletes
   them. `ci.yml` deploys the frontend on every frontend change to `main`, so
   the assets would survive until the next unrelated merge and then vanish.

### Ordering, retention, and rollback

Assets are copied **before** the dataset. Nothing references the new prefix
until the database swaps (the live database still returns the old URLs), so the
new URLs are backed by objects the moment they go live. The copy is
append-only per tag — no `--delete`, never overwriting a previous release — so
several tags coexist and a dataset rollback to any of them still has its plots.
Prune with `./scripts/app/deploy-assets.sh --prune 3 <env>`, not a bucket
lifecycle rule (which would silently expire the prefix a rollback depends on).

### Verifying

The script ends by fetching a sample SVG, a plotly page, and the page's own
relative plotly `src` over the public URL, then printing those URLs. Spot-check
by hand with:

```bash
curl -sI --compressed 'https://dev.nlm-ckn.org/plots/<tag>/<sample>.svg'
```

Expect `200`, `content-type: image/svg+xml`, `content-encoding: gzip`.
**`--compressed` is not optional** — CloudFront's CachingOptimized policy folds
`Accept-Encoding` into the cache key, so a bare `curl -I` uses a different cache
key than any browser and always reports `x-cache: Miss`, which reads like a
caching bug that isn't there.

Directory-style URLs (`/plots/<tag>/<dir>/`) return the SPA, because
`SpaRoutingFunction` rewrites any final path segment without a `.` to
`/index.html`. That is expected; just don't link to directories.

### Sandbox is deliberately blocked

`deploy-assets.sh` refuses `sandbox` outright, and `deploy-all.sh` skips the
step there. Sandbox serves its bucket through an ALB → Lambda target that drops
`Content-Encoding`, UTF-8-decodes `image/svg+xml` (corrupting the gzip bytes),
and 413s on objects over 700,000 bytes — which the ~1 MB plotly bundle exceeds.
Copying assets there yields blank plots and corrupted SVGs, not a partial
success. Lift the guard only after that handler is fixed in `nlm-ckn-iac`; see
[`docs/static-asset-copy-plan.md`](../docs/static-asset-copy-plan.md).

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
