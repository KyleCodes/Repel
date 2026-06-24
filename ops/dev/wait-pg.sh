#!/usr/bin/env bash
set -euo pipefail

# Block until THIS worktree's Postgres container reports healthy, then exec the
# given command. Lets dependent tmux panes (db connect, services run) auto-run
# instead of staging — they wait on the real compose healthcheck rather than a
# fixed sleep. Exports the same per-worktree stack vars as ops/dev/compose.sh so
# `docker compose` resolves this worktree's project.
#
# Usage: ops/dev/wait-pg.sh <command...>
#   e.g. ops/dev/wait-pg.sh bun run cli db connect

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
env_local="$repo_root/packages/backend/.env.local"

if [[ -f "$env_local" ]]; then
  set -a
  # shellcheck disable=SC2046
  export $(grep -E '^(COMPOSE_PROJECT_NAME|PG_PORT|GRAFANA_PORT|API_PORT)=' "$env_local" | xargs)
  set +a
fi

echo "wait-pg: waiting for Postgres to be healthy…"
until [[ "$(cd "$repo_root" && docker compose ps postgres --format '{{.Health}}' 2>/dev/null)" == "healthy" ]]; do
  sleep 1
done
echo "wait-pg: Postgres healthy — running: $*"

exec "$@"
