#!/usr/bin/env bash
set -euo pipefail

# Single entry point for this worktree's docker compose stack. Exports the
# per-worktree stack vars (COMPOSE_PROJECT_NAME + ports) that `repel env provision`
# wrote to packages/backend/.env.local, so `docker compose` always uses this
# worktree's project name and unique host ports — never the directory-name
# fallback on 5432/3001. Run from the repo root (npm script cwd) or anywhere; we
# resolve the repo root from this script's location.
#
# Usage: ops/dev/compose.sh up [-d] | down [-v] | <any docker compose args>
# package.json `dev:docker` / `dev:docker:down` and repo.conf both go through here.

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
env_local="$repo_root/packages/backend/.env.local"

if [[ -f "$env_local" ]]; then
  # Export only the compose-facing keys; ignore DATABASE_URL etc.
  set -a
  # shellcheck disable=SC2046
  export $(grep -E '^(COMPOSE_PROJECT_NAME|PG_PORT|GRAFANA_PORT|API_PORT)=' "$env_local" | xargs)
  set +a
else
  echo "compose.sh: no $env_local — run \`repel env provision <branch>\` first." >&2
  echo "compose.sh: falling back to compose defaults (project=dir name, ports 5432/3001)." >&2
fi

exec docker compose --profile dev "$@"
