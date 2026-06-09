# Local Startup Guide

This guide is for restarting the NLM-CKN UI development environment after the
project has already been cloned and the ArangoDB data has already been loaded.

The normal local setup is:

- ArangoDB runs on the host machine at `http://127.0.0.1:8529`
- Django runs in Docker at `http://127.0.0.1:8000`
- React runs locally at `http://127.0.0.1:3000`
- React proxies `/api/*` and `/arango_api/*` requests to Django

Important local paths:

- UI repository root: `/Users/martinleach/PycharmProjects/TO47_kbase/CKN/nlm-ckn-ui`
- React app: `/Users/martinleach/PycharmProjects/TO47_kbase/CKN/nlm-ckn-ui/react`
- Local ArangoDB data directory: `/Users/martinleach/arangodata`
- Local environment file: `/Users/martinleach/PycharmProjects/TO47_kbase/CKN/nlm-ckn-ui/.env`

## One-Time Setup

### 1. Install frontend dependencies

From any terminal:

```bash
cd /Users/martinleach/PycharmProjects/TO47_kbase/CKN/nlm-ckn-ui/react
npm install
```

The React app uses Create React App. If `npm start` fails with
`react-scripts: command not found`, make sure `react/package.json` has a real
`react-scripts` dependency, for example:

```json
"react-scripts": "5.0.1"
```

Then run:

```bash
cd /Users/martinleach/PycharmProjects/TO47_kbase/CKN/nlm-ckn-ui/react
npm install
```

### 2. Create the local Django environment file

From any terminal:

```bash
cd /Users/martinleach/PycharmProjects/TO47_kbase/CKN/nlm-ckn-ui
cp .env.example .env
```

Edit `.env` for local development. When Django is running inside Docker and
ArangoDB is running on the host machine, use this Arango host:

```bash
ARANGO_DB_HOST=http://host.docker.internal:8529
ARANGO_DB_USER=root
ARANGO_DB_PASSWORD=<your-local-arango-password>
ARANGO_DB_NAME_ONTOLOGIES=Cell-KN-Ontologies
ARANGO_DB_NAME_PHENOTYPES=Cell-KN-Phenotypes
GRAPH_NAME_ONTOLOGIES=KN-Ontologies-v2.0
GRAPH_NAME_PHENOTYPES=KN-Phenotypes-v2.0
```

To enable OpenAI-powered natural-language AQL generation on the
`Ask a Question` page, add these optional values to the same `.env` file:

```bash
OPENAI_API_KEY=<your-openai-api-key>
OPENAI_AQL_MODEL=gpt-4.1-mini
UMLS_API_KEY=<your-umls-api-key>
```

If `OPENAI_API_KEY` is blank or missing, the page still works, but it falls
back to broad text search instead of generating custom AQL.

If `UMLS_API_KEY` is present, the backend also uses UMLS term search to normalize
phrases before matching local Arango labels.

Keep `.env` local only. It is intentionally ignored by git because it contains
secrets.

## Daily Startup

Use three terminals.

### Terminal 1: Start or verify ArangoDB

This terminal can be in any directory. The commands below do not depend on the
current working directory.

If your ArangoDB container already exists, start it:

```bash
docker ps -a
docker start <your-arangodb-container-name>
```

Verify ArangoDB is listening on port `8529`:

```bash
curl http://127.0.0.1:8529/_api/version
```

A `401 not authorized` response is fine. It means ArangoDB is running and
requires credentials.

If you need to create a local ArangoDB container from your existing data
directory, first set the password in your shell for this command, then mount
the local Arango data directory:

```bash
export ARANGO_DB_PASSWORD='<your-local-arango-password>'

docker run -d \
  --name nlm-ckn-arangodb \
  -p 8529:8529 \
  -e ARANGO_ROOT_PASSWORD="$ARANGO_DB_PASSWORD" \
  -v /Users/martinleach/arangodata:/var/lib/arangodb3 \
  arangodb:3.12
```

Do this only if you do not already have an ArangoDB container using port `8529`.

### Terminal 2: Start Django backend only

Because ArangoDB is already running separately on host port `8529`, do not run
plain `docker compose up`. That tries to start another ArangoDB container and
will collide with the existing one.

Start only the backend service:

```bash
cd /Users/martinleach/PycharmProjects/TO47_kbase/CKN/nlm-ckn-ui
docker compose up --no-deps backend
```

Expected signs of success:

- Logs show `Connecting to ArangoDB at http://host.docker.internal:8529`
- Logs show `Connected to databases: Cell-KN-Ontologies, Cell-KN-Phenotypes`
- Django starts at `http://0.0.0.0:8000/`

You can verify the backend from the host:

```bash
curl http://127.0.0.1:8000/arango_api/workflow_presets/
```

### Terminal 3: Start React UI

From any terminal:

```bash
cd /Users/martinleach/PycharmProjects/TO47_kbase/CKN/nlm-ckn-ui/react
HOST=127.0.0.1 DANGEROUSLY_DISABLE_HOST_CHECK=true npm start
```

Open:

```text
http://127.0.0.1:3000
```

The `DANGEROUSLY_DISABLE_HOST_CHECK=true` setting is a local Create React App
workaround for this project because the app has a proxy configured and the dev
server is pinned to `127.0.0.1`.

## Shutdown

Stop React and Django with `Ctrl+C` in their terminals.

If Django was started through Docker Compose, clean up the backend container and
network from the UI repository root:

```bash
cd /Users/martinleach/PycharmProjects/TO47_kbase/CKN/nlm-ckn-ui
docker compose down
```

If you want to stop ArangoDB too:

```bash
docker stop <your-arangodb-container-name>
```

## Full Docker Compose Mode

The repository also has a `docker-compose.yml` that can start both ArangoDB and
Django:

```bash
cd /Users/martinleach/PycharmProjects/TO47_kbase/CKN/nlm-ckn-ui
docker compose up --build
```

Use this only when port `8529` is free and the repo-local `data/arangodb`
directory contains the ArangoDB database files expected by the compose file.

For the current local setup, where ArangoDB is already loaded and running on
host port `8529`, prefer:

```bash
cd /Users/martinleach/PycharmProjects/TO47_kbase/CKN/nlm-ckn-ui
docker compose up --no-deps backend
```

## Troubleshooting

### `Bind for 0.0.0.0:8529 failed: port is already allocated`

Another ArangoDB container is already using port `8529`. That is expected if you
are using the preloaded local ArangoDB. Start only the backend:

```bash
cd /Users/martinleach/PycharmProjects/TO47_kbase/CKN/nlm-ckn-ui
docker compose up --no-deps backend
```

### `react-scripts: command not found`

The frontend dependency is missing or installed incorrectly. Run this from the
React app directory:

```bash
cd /Users/martinleach/PycharmProjects/TO47_kbase/CKN/nlm-ckn-ui/react
npm install
```

Then check:

```bash
cd /Users/martinleach/PycharmProjects/TO47_kbase/CKN/nlm-ckn-ui/react
npm ls react-scripts
```

### `Could not find an open port at 127.0.0.1` or `listen EPERM`

The development environment may be blocking local port binding. Start React with
the local host variables:

```bash
cd /Users/martinleach/PycharmProjects/TO47_kbase/CKN/nlm-ckn-ui/react
HOST=127.0.0.1 DANGEROUSLY_DISABLE_HOST_CHECK=true npm start
```

### Django cannot connect to ArangoDB

If Django is running in Docker, `.env` must use:

```bash
ARANGO_DB_HOST=http://host.docker.internal:8529
```

If Django is running directly on the host machine instead of Docker, use:

```bash
ARANGO_DB_HOST=http://127.0.0.1:8529
```
