# DR-REP-40-1: `.env.local` is the sole source for `DATABASE_URL` in CLI commands

**Ticket:** REP-40 (T3 — Connect & query)

**Decision:** `db connect` and `db query` read `DATABASE_URL` exclusively from `.env.local` in the repo root via `readDatabaseUrlFromEnvLocal()` (in `cli/lib/env-local.ts`). No fallback to `process.env.DATABASE_URL`. If `.env.local` is missing or contains no `DATABASE_URL`, the command fails with a clear error.

**Why:**
- Per-worktree contract: `repel db clone` writes `.env.local` (mode 0o600) for each worktree, scoped to that worktree's branch DB. Reading from `.env.local` directly means the CLI always targets the *correct* DB for the current worktree, regardless of any stale `DATABASE_URL` in the user's shell environment.
- `process.env.DATABASE_URL` fallback would silently target the wrong DB if a user happens to have it exported globally (e.g., from a different worktree) — a class of bugs we want to design out, not document.
- Failure mode is intentional: missing `.env.local` means the worktree wasn't bootstrapped (or `db clone` was skipped). Better to fail loudly than connect to an unexpected DB.
- Existing `db clone` and `db drop` commands use a different env source (admin URL via `PG_ADMIN_URL` or derived from `DATABASE_URL` in env). Those are admin-tier commands; `connect` and `query` are runtime-tier and follow the worktree contract.
- Rejected alternative: `process.env` fallback. Documented in this DR specifically to record the rejection — it's the obvious thing to add and we don't want it.
- Rejected alternative: `--db-url <url>` override flag. Out of scope for T3; could be added later if needed.

**Satisfies AC:**
- "db connect reads DATABASE_URL from .env.local via readDatabaseUrlFromEnvLocal(); fails clearly if .env.local missing or no DATABASE_URL present."
