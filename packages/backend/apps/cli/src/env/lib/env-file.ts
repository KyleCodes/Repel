import type { WorktreeEnv } from './worktree-env';

// Serializes the per-worktree .env.local body written by `repel env provision`.
// DATABASE_URL is consumed by the CLI/migrations/pgcli; PG_PORT/GRAFANA_PORT/
// API_PORT and COMPOSE_PROJECT_NAME are exported by repo.conf before `docker
// compose` so each worktree's stack gets unique ports and a unique project.
export function renderEnvLocal(env: WorktreeEnv): string {
  return [
    `DATABASE_URL=${env.databaseUrl}`,
    `PG_PORT=${env.pgPort}`,
    `GRAFANA_PORT=${env.grafanaPort}`,
    `API_PORT=${env.apiPort}`,
    `COMPOSE_PROJECT_NAME=${env.projectName}`,
    '',
  ].join('\n');
}
