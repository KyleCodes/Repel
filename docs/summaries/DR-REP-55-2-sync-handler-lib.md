# DR-REP-55-2 — Sync loop lives in libs/sync; secret-free job + resolveTaskContext seam

**Status:** Accepted
**Date:** 2026-06-21
**Ticket:** REP-55

## Context

REP-55 first shipped the Gmail `ingest()` loop inline in the CLI sync handler with
throwaway in-memory job/task objects. The Syncer planning spike (REP-60 phase-4,
documented in REP-65) established the durable model: a `libs/sync` lib, an
`apps/sync/sync-worker`, `libs/queue`, and a sync handler that is the eventual
entrypoint of the queue stream consumer. PR review (#28) redirected REP-55 to start
building toward that target rather than leave throwaway POC code.

## Decision

1. **Extract the loop into `@repel/backend-sync`** (`packages/backend/libs/sync`),
   exposing `runSyncJob(job, deps)`. This is the future queue-consumer entrypoint;
   the CLI is one caller today. The lib is log-only — no DB, no persistence (that is
   REP-56).

2. **The job is the serializable, secret-free contract.** `SyncJob` carries
   `{ id, orgId, userId, tasks }`; `SyncTask` carries `{ id, providerAccountId, spec }`.
   No credentials on the job. `runSyncJob` iterates `job.tasks` even though the CLI
   provides exactly one today — the worker (REP-57) will iterate many.

3. **`resolveTaskContext` seam.** `deps.resolveTaskContext(task, job)` returns
   `{ adapter, ingestInput }`. The consumer resolves the adapter and reconstructs
   credentials at execution time: the CLI closes over an already-resolved account +
   decrypted credentials; the worker will decrypt from the encrypted credentials it
   loads per `providerAccountId`. Secrets are reconstructed at the edge, never carried
   on a job a queue would persist (ADR-014 spirit).

4. **Errors are lib-owned and exported.** `@repel/backend-sync/error` exposes
   `SyncError` (abstract), `SyncIncompleteError` (moved from the CLI), and
   `SyncNormalizationError` (new). `AccountCredentialsMissingError` stays in the CLI
   (raised during account resolution, a CLI concern).

5. **A `message` event with `normalized === null` throws `SyncNormalizationError`**
   — reverses the earlier log-and-skip. A message that fails to normalize is a real
   error, not a skippable event.

6. **`TokenSet` is imported from the generic adapters subpath**
   `@repel/backend-adapters/lib/oauth2/types` (added to the adapters `exports` map per
   ADR-015), not via a gmail-derived indexed-access alias.

## Consequences

- `runSyncJob` has no crypto/db imports; it is unit-testable with a fake adapter and
  needs no encryption fixtures.
- REP-57 reuses `runSyncJob` unchanged: its `resolveTaskContext` decrypts from the
  queue envelope's `providerAccountId`. No loop logic is re-implemented in the worker.
- The CLI shrank to: resolve account → reconstruct credentials → build a one-task job
  → call `runSyncJob` → write the stdout summary.

## Open items (not yet tickets)

- The lib models a multi-task job but the CLI only ever passes one. When REP-57 builds
  jobs from envelopes, confirm the task-list semantics (per-task cursor, partial
  failure across tasks) match the persistence rollup in REP-56.
