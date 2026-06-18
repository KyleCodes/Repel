# Session Handoff: REP-21 sync vertical — scoping & sub-ticket breakdown

**Date:** 2026-06-18
**Session Duration:** ~1.5h
**Session Focus:** Break the oversized REP-21 parent into executable sub-tickets and de-fluff its description. Scoping only — no code.
**Context Usage at Handoff:** ~55%

## What Was Accomplished

1. Read the last 5 merged PRs (#19/20/21/22/23 = REP-13/51/22/chore/52) and the live code on `main` to confirm all REP-21 blockers are merged and to ground the breakdown.
2. Resolved scope with the user (3 rounds of decisions) and split REP-21 into three Linear sub-tickets:
   - **REP-55** — `[CLI] sync run POC: drive Gmail ingest() in-process, log only` (no DB writes).
   - **REP-56** — `[Sync] Schema + synchronous persistence + sync status`.
   - **REP-57** — `[Sync] Async runner: job_queue enqueue + worker` (blockedBy REP-56).
3. Rewrote the REP-21 parent description in place — stripped placeholder/disclaimer sections and resolved open questions; kept the data model as the REP-56 spec; folded the post-REP-50 corrections inline.
4. Plan file written at `/Users/kylemuldoon/.claude/plans/1-yes-we-decided-zippy-church.md`.

## Exact State of Work in Progress

- Scoping is **complete**. All three sub-tickets created in Linear (Backlog), parent updated.
- Next is **execution of REP-55** in a fresh worktree (user is spinning it up).
- **Not done:** this handoff is being committed directly to `main` (no PR) per user instruction.

## Decisions Made This Session

- **Three-ticket cut: POC → (schema + synchronous persistence) → async runner.** BECAUSE persistence and async execution are orthogonal; the synchronous in-process driver does the full DB write, and the async ticket only swaps how the same `features/sync` persistence service is invoked. STATUS: confirmed.
- **POC (REP-55) does zero DB writes.** BECAUSE `message_raw.sync_task_id` is NOT NULL with no `sync_task` table yet — a message cannot be persisted until REP-56's schema lands. So the POC's job is purely to prove `ingest()` runs without throwing. STATUS: confirmed.
- **`sync_job`/`sync_task` are in-memory plain objects in REP-55**, real rows in REP-56. STATUS: confirmed.
- **Event vocabulary identical across app + storage.** `sync_event.type` = `AdapterEvent.type` slugs + caller-authored `enqueued`. The ticket's original "need not be identical" line is REJECTED. STATUS: confirmed.
- **Adapter yields `started`; caller writes `enqueued`.** No `cancelled` event, no `sync cancel` command. STATUS: confirmed.
- **`sync status` is JSON-only** (no table, no `--watch`, no `--json` flag). STATUS: confirmed.
- **Attachments persisted in REP-56** (folded into the message-write tx), not a separate ticket. STATUS: confirmed.
- **`message_raw.provider_account_id` keep-vs-drop deferred to REP-56's migration + DR.** STATUS: provisional (decide at REP-56 execution).
- **Sync-vs-async: synchronous now (REP-56), async later (REP-57).** Record in the REP-56 DR. STATUS: confirmed.

## Key Numbers / Facts Discovered This Session

- Adapter event discriminant is already **`type`** (not `phase`), set = `started | auth | progress | message | completed | failed`, no `cancelled` — `apps/server/src/adapters/types.ts:266`.
- `ingest()` yield order = `started → auth → message* → completed`; `completed` carries `{ historyId }` cursor + `processed` — `apps/server/src/adapters/gmail/ingress/ingest.ts:52-91`.
- `message` event payload = `{ raw, normalized, attachments: AttachmentContent[] }`; `attachment.bytes` is NOT NULL — `apps/server/src/infra/db/generated.ts:39`.
- `message_raw.sync_task_id` = `string` (uuid NOT NULL, **unconstrained**) — `generated.ts:138`. REP-56 adds only the FK constraint, not the column.
- `provider_account.syncCursor: Json | null` exists for cursor persistence — `generated.ts:167`.
- `sync_job`/`sync_task`/`sync_event` tables do **not** exist yet (confirmed against `generated.ts` DB interface).
- RLS pattern: `pgm.sql()` + `CREATE POLICY tenant_isolation ON <t> USING (org_id = current_setting('app.current_org_id')::uuid)` — `apps/server/src/infra/db/migrations/1780033705786_rep-50-message-schema.ts:256-269`.
- Migration tooling: `bun cli db migrations create [name]` (node-pg-migrate); files in `apps/server/src/infra/db/migrations/`; codegen regenerates `apps/server/src/infra/db/generated.ts`.
- `runInOrgTx(fn)(input & {orgId})` sets `SET LOCAL app.current_org_id` — `apps/server/src/infra/db/tx.ts:50`. Mutations are one-statement-per-file (manifesto Rule 3).
- CLI: commander; `register<X>Commands(program)` in `apps/server/src/cli/index.ts:12-14`; zod + `parseOrExit`; JSON→stdout, diagnostics→stderr.
- **`accounts connect`** (`apps/server/src/cli/accounts/handler.ts:184`) is the precedent for "CLI synchronously resolves adapter, decrypts credentials, drives an adapter method." Helpers: `resolveAccount(ref,{orgId})`, `resolveProviderAdapter(provider)`, `decrypt(loadEncryptionKey(), credentialsEncrypted)`.
- Feature layout: `features/<name>/{mutations,views,handlers,service.ts,error.ts}`; `handlers/` is the manifesto home for handler #1 (the runner).
- Linear IDs: team `Repel Engineering` `e55cb4da-78cb-46c1-821a-497f5f4ee41c`; project CLI Everything `020c1be5-8ebb-49d2-956b-9ddaa02d7e3e`; milestone Sync & OAuth Verbs `db1e7be7-e8ee-4a3f-9a21-6bd51d64d4b0`.

## Conditional Logic Established

- IF persisting any message THEN the `sync_task` table must exist first BECAUSE `message_raw.sync_task_id` is a NOT NULL FK (forces REP-56 before any persistence; forces REP-55 to be write-free).
- IF REP-56 builds the persistence service THEN make it invocation-agnostic BECAUSE REP-57's worker must call it unchanged.
- IF normalizing into `message` THEN do NOT set `sender_address`/`sender_name` BECAUSE REP-50 dropped them (source of truth = `message_participant role='from'`).
- IF `--full` omits `--limit` THEN adapter caps at 100 (`DEFAULT_FULL_SYNC_CAP`, `ingest.ts:31`).

## Files Created or Modified

| File Path                                                           | Action   | Description                                       |
| ------------------------------------------------------------------- | -------- | ------------------------------------------------- |
| `/Users/kylemuldoon/.claude/plans/1-yes-we-decided-zippy-church.md` | Created  | Full scoping plan (outside repo; reference only). |
| `docs/summaries/handoff-2026-06-18-REP-21-plan.md`                  | Created  | This handoff.                                     |
| Linear REP-55 / REP-56 / REP-57                                     | Created  | Sub-tickets under REP-21.                         |
| Linear REP-21                                                       | Modified | De-fluffed parent description.                    |

No source code, migrations, or commits to app code this session.

## What the NEXT Session Should Do

1. **First**: Resolve the pre-flight FAIL before `/linear-execute` — missing `.claude/skills/ADR/SKILL.md`, `.claude/skills/ADR/Compliance.md`, `docs/context/index.md`. The execute-flow agents (codebase-explorer, architect, backend-engineer, code-reviewer) reference the ADR skill.
2. **Then**: In the new REP-55 worktree, run `/linear-execute REP-55`.
3. **Then**: REP-55 scope — new commander `sync` group in `apps/server/src/cli/index.ts`; `sync run <account-ref> --full [--limit N]`; resolve account/adapter, decrypt creds, build in-memory job/task, iterate `ingest()`, log each event, print JSON summary. **No DB writes.** Mirror `cli/accounts/` for schema + handler structure.
4. **Later**: REP-56 (schema + persistence + `sync status`), then REP-57 (async runner). REP-56 must write a DR capturing schema + event identity mapping + `provider_account_id` keep/drop + sync-vs-async.

## Open Questions Requiring User Input

- **OPEN:** Pre-flight required-file gaps (ADR skill + `docs/context/index.md`) — needs the user to decide stub vs. locate vs. proceed-degraded before REP-55 execution.
- **OPEN:** `message_raw.provider_account_id` keep-vs-drop — resolve during REP-56 implementation (fold into migration + DR).

## Assumptions That Need Validation

- **ASSUMED:** REP-55 can be executed solo without the schema (true given it does no DB writes) — validate by confirming the in-memory job/task satisfies `GmailIngestInput` without any FK.
- **ASSUMED:** `Feature` label is the right type for all three (no `spike` label exists in the team) — validate by user if a spike label is later added.

## What NOT to Re-Read

- PRs #19/20/21/22/23 — substance captured above and in the REP-21 description.
- `apps/server/src/adapters/types.ts`, `gmail/ingress/ingest.ts`, `infra/db/generated.ts`, `infra/db/tx.ts`, `cli/accounts/handler.ts`, the REP-50 migration — key facts extracted into "Key Numbers / Facts" above.

## Files to Load Next Session

- `docs/summaries/handoff-2026-06-18-REP-21-plan.md` — this file (start here).
- Linear REP-55 — the ticket to execute.
- `apps/server/src/cli/accounts/handler.ts` + `apps/server/src/cli/accounts/schemas/index.ts` — structural template for the `sync` command group.
- `apps/server/src/adapters/gmail/ingress/ingest.ts` + `apps/server/src/adapters/types.ts` — the event stream REP-55 drives.
