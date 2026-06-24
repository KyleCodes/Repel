import { sanitizeBranchToDbName } from '@repel/backend-db/admin-ops';
import { extractTicketSlug } from '../../db/lib/branch';

// Derives the per-worktree dev-stack environment: the host ports each worktree's
// own docker stack publishes, its compose project name, and the DATABASE_URL
// pointing at its own Postgres. Each worktree runs an independent stack, so the
// ports must be unique per worktree — they are derived from the Linear ticket
// number (monotonic, stable per branch). The DB inside every stack is `repel`.

export interface WorktreeEnv {
  pgPort: number;
  grafanaPort: number;
  apiPort: number;
  projectName: string;
  databaseUrl: string;
}

// Port bands are spaced 2000 apart so they stay disjoint for ticket numbers
// below 2000 (current ticket counts are ~2 orders of magnitude under that).
const GRAFANA_BASE = 12000;
const API_BASE = 14000;
const PG_BASE = 16000;
const MAX_OFFSET = 2000;

// Stable offset for a branch with no ticket slug: a bounded hash of the branch
// name. Collisions are possible but rare; the dev resolves them manually.
function hashOffset(branch: string): number {
  let h = 0;
  for (let i = 0; i < branch.length; i++) {
    h = (h * 31 + branch.charCodeAt(i)) % MAX_OFFSET;
  }
  // Avoid 0 so a band base is never reused verbatim.
  return h === 0 ? 1 : h;
}

function ticketOffset(branch: string): number {
  const slug = extractTicketSlug(branch); // e.g. "REP-69"
  if (slug) {
    const n = Number(slug.split('-')[1]);
    if (Number.isFinite(n) && n > 0 && n < MAX_OFFSET) return n;
  }
  return hashOffset(branch);
}

export function deriveWorktreeEnv(branch: string): WorktreeEnv {
  const projectName = sanitizeBranchToDbName(branch); // throws on empty branch
  const n = ticketOffset(branch);
  const pgPort = PG_BASE + n;
  return {
    pgPort,
    grafanaPort: GRAFANA_BASE + n,
    apiPort: API_BASE + n,
    projectName,
    databaseUrl: `postgres://repel:dev@localhost:${pgPort}/repel`,
  };
}
