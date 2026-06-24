# ops/

Deploy and configuration for **provisioned operational tooling** — third-party
services we stand up and point at the platform, not code we write and import.

## What belongs here

- Config for provisioned tools: Grafana (today), and later Prometheus/Loki/etc.
- docker-compose fragments and operational scripts for those tools.

Everything here is non-buildable config (YAML/JSON/shell). It is intentionally
**outside** the Nx workspace (`packages/`), so it never enters the project graph
and needs no `project.json` or tags. This mirrors the architecture manifesto: a
top-level config dir is the same category as `docs/`, and the manifesto governs
`packages/` only (it disclaims operational concerns).

## What does NOT belong here

- **Integration code we write** (Slack/Linear/GitHub clients, alert handlers,
  anything the running platform calls). That is TypeScript — it lives in
  `packages/backend` as an adapter or domain lib under the existing tag rules.
- The Linear "Operations" project (REP-29/30/31) is one-time manual account and
  connector setup (create the GitHub org, the Slack workspace, wire Linear). It
  is a runbook, not code, and has no home in this directory.

## Per-worktree dev stacks (REP-69)

Each git worktree runs its **own** docker stack — its own Postgres and its own
Grafana — instead of sharing one root Postgres. `data/pg` and `data/grafana` are
relative bind mounts, so each worktree dir already owns its data; the only thing
that has to differ per worktree is the published **host ports** and the
**compose project name**, both derived from the branch's Linear ticket number.

`repel env provision <branch>` (the `env` CLI namespace) computes them and writes
`packages/backend/.env.local`:

```
DATABASE_URL=postgres://repel:dev@localhost:<PG_PORT>/repel
PG_PORT=16000+ticket        # e.g. REP-69 -> 16069
GRAFANA_PORT=12000+ticket   #          -> 12069
API_PORT=14000+ticket       #          -> 14069
COMPOSE_PROJECT_NAME=repel_<branch-slug>
```

Bands are spaced 2000 apart (disjoint for ticket numbers < 2000). A branch with
no ticket gets a stable hash-derived offset in the same range.

### grafana/

A Grafana service (`grafana` in the repo-root `docker-compose.yml`, profiles
`dev`/`full`, host port `${GRAFANA_PORT}`) provisioned entirely from
`grafana/provisioning/`:

- `provisioning/datasources/repel-postgres.yaml` — Postgres datasource, reached
  over THIS stack's compose network at `postgres:5432`, database `repel`, user
  `repel`. One DB per stack, so no per-worktree DB selection is needed.
- `provisioning/dashboards/provider.yaml` — loads dashboard models as code
  (`allowUiUpdates: false` — the committed JSON is authoritative).
- `provisioning/dashboards/repel-operational.json` — the starter dashboard.

### Seeding a worktree's database

The seed is a persisted **artifact** restored by the Postgres container itself —
no host postgres tooling, no ordering races. The `postgres:16` image runs
`/docker-entrypoint-initdb.d/` scripts exactly once, on a fresh data dir;
`ops/postgres/initdb/10-restore-seed.sh` restores `data/seed.dump` if present (and
non-empty), else starts empty. So whoever runs `docker compose up` (the tmux pane)
gets a seeded, healthy DB on a new worktree; on resume (existing `data/pg`) the
hook is skipped and data persists.

Producing the seed (runs `pg_dump` INSIDE the source stack's container, so the
host needs no client tools):

```
repel db dump --out data/seed.dump      # docker compose exec postgres pg_dump -Fc repel
```

`devctl workon` copies `data/seed.dump` into the new worktree before its first
boot (until that's wired, copy it by hand). To re-seed an already-running stack
(the manual escape hatch — the init hook only fires on a fresh volume):

```
repel db restore --from-file data/seed.dump   # docker compose exec postgres pg_restore
```

### Running it

1. `repel env provision <branch>` — writes the stack vars to `.env.local`
   (`on_start` does this automatically).
2. Bring up the stack — the tmux `docker compose up` pane does this; manually:
   `export $(grep -E '^(COMPOSE_PROJECT_NAME|PG_PORT|GRAFANA_PORT|API_PORT)=' packages/backend/.env.local | xargs) && docker compose --profile dev up`
3. Open `http://localhost:<GRAFANA_PORT>`, log in as `admin` /
   `GF_SECURITY_ADMIN_PASSWORD` (from `.env.development`, default `admin`).

### Secrets

`GF_SECURITY_ADMIN_PASSWORD` lives in `packages/backend/.env.development` (the
existing backend env file; its real value is gitignored). The datasource DB
password is the local `dev` credential, matching the compose `POSTGRES_PASSWORD`
— not a real secret. No secret is committed. A dedicated `ops/.env` will be
introduced only when an ops-only secret (e.g. a Grafana Cloud token or an alert
webhook) first appears.

## devctl/ — host-config reference

`ops/devctl/repo.conf.reference` is a documentation-only copy of the host devctl
config (`~/.devctl-config/repos/Repel/repo.conf`), which lives OUTSIDE the repo
and is **never sourced from here**. It is committed so the per-worktree
`on_start`/`on_teardown` orchestration (provision env → compose up → restore
seed; teardown → `compose down -v`) is reviewable alongside the compose changes.
The real file must be edited by hand to match.

## Deferred (needs instrumentation — REP-68 phase 2)

Some requested metrics are not derivable from Postgres and are intentionally
absent from the v1 dashboard:

- **Outbound requests** — no request-count column exists; needs a metrics sink.
- **Inbound bytes** — no transfer-byte counters are persisted; needs
  instrumentation.

These await the push-vs-pull metrics decision on the observability epic (REP-68).
