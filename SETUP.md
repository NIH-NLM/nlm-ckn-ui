# Local Setup Guide

A step-by-step walkthrough for getting the NLM-CKN UI running on your machine for
local development. For a broader overview of the project, deployment, and AWS
architecture, see [`README.md`](README.md).

## Prerequisites

Install these before you start:

- **Node.js 20.x** (22.x also works) and a matching npm
- **Docker & Docker Compose**
- **Python 3.13.3** — to run the Django backend. This version is pinned: it's what
  `requirements.txt`, the committed `venv`, and the `Dockerfile`
  (`python:3.13.3-slim`) all use, and the project is untested on other versions.
  Confirm with `python3 --version` before creating the venv. If you don't have it:
  - **pyenv** (matches the exact version cleanly): `pyenv install 3.13.3` — the
    repo's `.python-version` file then selects it automatically in this directory
  - **macOS Homebrew**: `brew install python@3.13`, then use `python3.13` below
  - **Direct download** from [python.org](https://www.python.org/downloads/)
- **AWS CLI + `jq` + read access to the dataset S3 bucket** — required to load the
  ArangoDB data. The database is not a generic Arango install; it's a pre-built
  "golden dump" produced by the [`nlm-ckn-etl`](https://github.com/NIH-NLM/nlm-ckn-etl)
  pipeline and stored in S3. You need AWS credentials with read access to
  `s3://cell-kn-arangodb-data-952291113202`. **Sort this out first** — without it
  you can't load the data and the app has nothing to serve.

## Steps

### 1. Clone the repository

```bash
git clone https://github.com/NIH-NLM/nlm-ckn-ui.git
cd nlm-ckn-ui
```

### 2. Create and configure `.env`

```bash
cp .env.example .env
```

Then edit `.env`:

- **`SECRET_KEY`** — generate one (uses only the Python standard library, so it
  works on a clean checkout before dependencies are installed):
  ```bash
  python3 -c "import secrets; print(secrets.token_urlsafe(64))"
  ```
- **`ARANGO_DB_PASSWORD`** — pick a password. The loader script (step 4) uses it
  to initialize the ArangoDB container.
- **`ARANGO_DB_HOST`** — change the default `http://arango_db:8529` to
  **`http://127.0.0.1:8529`**. The default value only works inside Docker Compose;
  with the local loader script it must point at `127.0.0.1`.

The other defaults in `.env.example` are fine for local development.

### 3. Install frontend dependencies

```bash
cd react
npm install
cd ..
```

### 4. Load the ArangoDB data

Run this from the repo root (the script reads `ETL_VERSION` and `.env` from here):

```bash
./scripts/dev/load-dump-local.sh
```

This downloads the dataset version pinned in [`ETL_VERSION`](ETL_VERSION) from S3
and restores it — including the named graphs and analyzers the workflow
traversals depend on — into a Docker container named `arango-current` on port
8529. The script starts ArangoDB for you, so you do **not** also need the
`arangodb` service from `docker-compose.yml`.

To use a different dataset version or run a side-by-side container on another
port:

```bash
./scripts/dev/load-dump-local.sh v1.4.6-alpha.36         # explicit version on :8529
./scripts/dev/load-dump-local.sh v1.4.6-alpha.36 8540    # side-by-side on :8540
```

List available dataset versions:

```bash
aws s3 ls s3://cell-kn-arangodb-data-952291113202/runs/ --recursive | grep golden
```

### 5. Build the frontend

```bash
cd react
npm run build
cd ..
```

`npm run build` runs both the React build and Django's `collectstatic`, so Django
can serve the built bundle. (Use `npm start` instead during active frontend work —
see [Frontend Development](#frontend-development) below.)

### 6. Run the backend

```bash
python3.13 -m venv venv && source venv/bin/activate
pip install -r requirements.txt
python manage.py migrate
python manage.py runserver
```

Create the venv with `python3.13` explicitly so it doesn't pick up another
interpreter (unless pyenv has already activated `.python-version` for you). Once
the venv is activated, the `python`/`pip` below correctly resolve to it.

`python manage.py migrate` sets up the local SQLite database (`db.sqlite3`) and
loads the predefined queries the app depends on — don't skip it on a fresh clone.

The site is now available at **http://127.0.0.1:8000/**.

## Frontend Development

For frontend work with hot-reloading, skip the `npm run build` step and run the
React dev server alongside the backend:

```bash
cd react
npm run watch
```



## Troubleshooting

- **Loader fails with an AWS/S3 error** — confirm your AWS credentials are active
  (`aws sts get-caller-identity`) and that you have read access to the dataset
  bucket. This is the most common blocker.
- **Backend can't reach the database** — check that `ARANGO_DB_HOST` in `.env` is
  `http://127.0.0.1:8529` (not `http://arango_db:8529`) when using the loader, and
  that the `arango-current` container is running (`docker ps`).
- **UI changes don't appear** — the built bundle is stale. Re-run `npm run build`
  and hard-refresh, or use `npm run watch` for hot-reloading during development.
- **Environment variable reference** — see the table in
  [`README.md`](README.md#environment-configuration).
