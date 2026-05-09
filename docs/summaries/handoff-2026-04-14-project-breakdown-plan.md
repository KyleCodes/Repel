# Session Handoff: Project Breakdown Planning (Q1–Q4 of 6)

**Date:** 2026-04-14
**Session Duration:** single long planning conversation
**Session Focus:** Work through six architectural questions that must resolve before Repel's roadmap can be broken into Linear projects. Completed Q1, Q3, Q4. Deferred Q2 and part of Q5 to a design-ideas doc. Q6 (the actual project breakdown) is next.
**Context Usage at Handoff:** ~12% (124.7k / 1M tokens)

## What Was Accomplished

1. **Q1 — Provider / channel / account vocabulary resolved** → ADR written to `docs/context/adr/ADR-005-provider-account-vocabulary.md` (replaced the old ADR-005 about channel adapters in place). Status: ACCEPTED. Index updated.
2. **ADR-009 amended in place** to rename the directory `domains/` → `core/` (see Q3 below) → `docs/context/adr/ADR-009-vertical-domain-layout-repo-factories.md` has an `## Amendments` section dated 2026-04-14. Compliance rules unchanged; only the directory name and the "domain" vs "bounded context" terminology moved.
3. **Q2 — Derived fact model deliberately deferred** → full proposed model, six open sub-questions, and an event-sourcing alternative direction captured at `docs/design_ideas/derived-fact-model.md`. To be revisited after sync ships.
4. **Q3 — Non-message integrations layout resolved** → decisions captured in this handoff (no ADR written — it's a layout convention, not a cross-cutting architectural commitment). Key outputs: top-level `providers/`, `integrations/`, `api/`, `core/`, `jobs/`, plus `docs/design_ideas/future-surfaces.md` (MCP deferral) and `docs/design_ideas/scaffold-cleanup.md` (what stays/goes/moves).
5. **Q3 follow-up: `domains/` → `core/` rename filed as Linear ticket** → REP-5 (Backlog, no project). Executes as part of the first real implementation ticket that touches these directories.
6. **Q4 — Sync job contract + sync CLI verbs + worker entrypoint resolved** → decisions captured in this handoff (no ADR written — implementation-level). `apps/server/src/main.ts` cleaned up: the stub `sync` mode removed, modes are now `api | worker | all`, worker is the home for all queue consumers.
7. **Q4 follow-up: CLI profile/config system filed as Linear ticket** → REP-6 (Backlog, no project). Low priority. Blocked until v1 sync ships using the bootstrap-file org fallback.
8. **Raw-side of Q5 folded into Q4.** Replay-side of Q5 deferred alongside Q2 because replay UX depends on the derived-fact-model decision.

## Exact State of Work in Progress

- **Q6 (Linear project breakdown)**: not yet started. All preconditions now satisfied by the resolutions above. Next action is to draft the project list with scopes, dependency ordering, and ticket outlines, then scaffold in Linear.
- **REP-5 (domains → core rename)**: filed, Backlog, awaiting execution. Should be absorbed into whichever Q6 project first touches `apps/server/src/core/`.
- **REP-6 (CLI profile system)**: filed, Backlog, explicit dependency note says it blocks on v1 sync landing first.
- **ADR-005 old rules**: no `.claude/skills/ADR/Compliance.md` exists in this repo, so compliance rule extraction step from `/ratify-adr` was skipped. Not a blocker; flag here so a future session doesn't look for it.

## Decisions Made This Session

### Q1 — Provider account vocabulary (LOCKED — ADR-005)

- Three-level model in the database: **`channel`** (medium: email/sms/dm/chat_room) / **`provider`** (service: gmail/icloud/generic_imap) / **`provider_account`** (user's instance, one row per linked account). Protocol is code-only, not in the DB.
- **`channel` and `provider` are Postgres enums backed by a TypeScript provider registry** at `apps/server/src/providers/index.ts`. Unit test enforces parity between `Object.keys(registry)` and the Postgres enum values.
- **Protocols** (IMAP, SMTP, JMAP, Gmail REST) live in `apps/server/src/providers/lib/protocols/` as plain libraries imported by provider adapters. BECAUSE: protocol is always an implementation detail — adding a protocol always requires writing an adapter, so storing the name in a row gains nothing.
- **`channel` and `auth_method` denormalized onto `provider_account`** BECAUSE SQL UI queries ("list all email accounts", "list all OAuth-linked accounts") should not round-trip through TypeScript.
- **Multi-channel services split into multiple providers.** Google Mail and Google Chat are two provider entries, two adapters, two `provider_account` rows per user. BECAUSE: v1 is simpler and the eventual multi-provider-one-credential refactor can introduce a `provider_credential` sibling table without reshaping what exists.
- **Multiple instances per (user, provider) are first-class.** Three Gmails per user = three rows distinguished by `id`, `alias` (user-supplied, "Work"/"Personal"), and `external_account_id` (the provider's own identifier: Gmail address, Apple ID, `username@host`).
- **`UNIQUE (org_id, provider, external_account_id)`** prevents accidental duplicate links within an org. Two users in the same org CAN legitimately link the same shared account.
- **`external_account_id` is NOT NULL.** Rows are inserted only after credential exchange completes, never mid-OAuth.
- **Instance table naming**: `provider_account`. Rejected alternatives: `connected_account` (verbose without gain), `sync_authorization` (narrows the concept to credentials, but the row outlives any single sync and owns send/label/active), `provider_configuration` (collides with the TypeScript provider-definition layer), `linked_provider_account` (too long for a ubiquitous identifier), `mailbox` / `inbox` / `link` (email-biased or vague).
- **Add `normalizeExternalAccountId(raw) → string`** to each provider's `definition.ts` as a risk mitigation against case-sensitivity / format drift. Called before insert and lookup.
- **Supersede strategy**: old ADR-005 (Channel Abstraction via Adapter Pattern) was replaced **in place** rather than marked SUPERSEDED BY ADR-012. Kyle asked what standard practice was; I explained ADRs are normally preserved as historical record; Kyle's counter was "we're 2 commits in, no references, delete the junk." Agreed. Old file deleted. New file written with `Status: ACCEPTED`, `SUPERSEDES: NONE`. Index updated in place. ADR-012 slot stays unused.

### Q2 — Derived fact model (DEFERRED — `docs/design_ideas/derived-fact-model.md`)

- Locked direction regardless of implementation: one row per derived fact (not per-feature tables), user-customizable prompts per processing step, non-destructive replay, raw-vs-derived as a first-class distinction.
- **Proposed model on file** as a starting point: three tables — `processor` (org-scoped config), `processor_run` (per-message execution with cost/tokens/error), `derived_fact` (typed facts keyed by `processor_run_id`). The per-feature tables (`message_classification`, `message_summary`, `message_importance`, `draft_reply`, `message_tag`) all disappear or become views.
- **Event sourcing is an explicit alternative direction, promoted to equal status** BECAUSE Kyle observed that `processor_run` could be a materialized view over an append-only event log. The event-sourcing version is captured with its pros (pipeline history, multi-consumer fan-out, replay is a SELECT, audit log for free) and cons (event schema discipline, projection maintenance, retention policy) so whoever revisits has both options on the table.
- **Why deferred**: derived facts are a layer above raw sync. Sync can ship end-to-end without any of this. Revisit triggers: (1) sync is reliably populating `message` / `message_raw`, (2) a real message corpus exists to process, (3) the first processor is about to be written.
- Six sub-questions (A–F from the design-ideas doc, plus a G on directory naming for the processor entrypoint) are all left open for the future session.

### Q3 — Non-message integrations layout (LOCKED — no ADR, convention captured here + in REP-5)

- **Top-level directory split in `apps/server/src/`:**
  - `providers/` — upstream message integrations (ADR-005 territory). Gmail, iCloud, generic-imap, plus `lib/protocols/`.
  - `integrations/` — outbound, "Repel as client." Datadog, customer webhooks, future n8n bridge. BECAUSE: Kyle wanted the door open to bidirectional comms if needed; `integrations/` keeps that option without forcing a rename. Rejected `outbound/`, `exports/`, `sinks/`, `connectors/`.
  - `api/` — HTTP surface. Split into `api/rest/` (future), `api/webhooks/` (inbound HTTP: OAuth callbacks, Gmail Pub/Sub push), and later `api/mcp/` (deferred).
  - `core/` — bounded contexts with repo/service/mapper pattern (ADR-009 pattern, renamed from `domains/`).
  - `jobs/` — queue-driven workflows (Q4 territory).
- **OAuth callbacks: Option A chosen.** `api/webhooks/oauth-callbacks/<provider>.ts` owns the HTTP route and delegates to `providers/<provider>/oauth.ts` for token exchange. Rejected Option B (provider owns its own HTTP route) BECAUSE it would force the provider directory to import HTTP framework code.
- **`domains/` renamed to `core/`** BECAUSE the term was overloaded between (a) DDD bounded contexts (the ADR-009 meaning — implementation pattern) and (b) API verticals (first-segment URL paths — product surface). Collapsing them forced verb endpoints like `/send` and `/chat` into a fake entity shape. Chose "Option C" (two-layer split): bounded contexts under `core/`, API verticals under `api/rest/routes/`, routes import from cores. `core/` as the rename target, rejected `domain/` (still overloaded), `business/`, `model/`, `services/`, `entities/`, `modules/`.
- **`core/org/` and `core/user/` stay as separate subdirectories for now.** Kyle flagged that auth/session management is coupled to user and needs more discussion; the `core/tenancy/` grouping question is deferred until auth work lands.
- **`core/` is for tenant-scoped business entities only.** Providers and integrations have their own shape (definition + adapter + lib) and are peers of `core/`, not children of it. ADR-009's repo/service/mapper pattern applies to `core/` and only `core/`.
- **MCP server deferred** (Q3 discovery) → `docs/design_ideas/future-surfaces.md`. Product-spec-committed feature, depends on a stable internal API surface that doesn't exist yet, revisit after REST API is stable or if a user wants conversational mailbox access before the SPA ships. Open: direct service calls vs HTTP round-trip through REST (leaning former).
- **`domains/providers/` and `domains/account-setup/` are throwaway scaffolds** to be deleted as part of the first real implementation work, not a standalone cleanup ticket. BECAUSE: a bare "delete these files" ticket would leave the codebase worse off than the placeholders did. Captured in `docs/design_ideas/scaffold-cleanup.md`.
- **`domains/org/` and `domains/user/` are NOT throwaway** — they're real foundational entities backing the schema in `docs/03-sql-schema.md`. They survive the rename into `core/org/` and `core/user/`.

### Q4 — Sync job contract + CLI verbs + worker entrypoint (LOCKED)

**Job queue structure:**

- **Separate logical queues from day one** via the existing `job_queue.queue text` column. v1 values: `'sync'` only. Future: `'process'`, `'send'`, `'integration_export'`. BECAUSE different backoff semantics, different worker pool sizing, `FOR UPDATE SKIP LOCKED` polls stay cheap when filtered by queue name.
- **Three sync job types**: `sync.full`, `sync.incremental`, `sync.range`. Rejected a fourth `sync.single` type — collapse it into `sync.range` with a single-element `externalIds` array. BECAUSE: minimizes job-type surface, `sync.single` is an optimization that rarely pays off.
- **Hybrid payload shape**: generic `jsonb` column at rest, strict TypeScript discriminated union + Zod schema at the edges. Writer and reader both type-safe; database stays generic.
- **New `dedup_key text` column on `job_queue`** with a **partial unique index** `ON job_queue (queue, dedup_key) WHERE status IN ('pending', 'processing')`. BECAUSE: without it, back-to-back cron ticks enqueuing `sync.incremental` for the same account produce duplicate jobs. `dedup_key = 'sync.incremental:<provider_account_id>'` gives at-most-one in-flight per account.
- Canonical sync payload union:
  ```ts
  type SyncJobPayload =
    | { type: 'sync.full'; providerAccountId: string }
    | { type: 'sync.incremental'; providerAccountId: string }
    | {
        type: 'sync.range';
        providerAccountId: string;
        from: string;
        to?: string;
        externalIds?: string[];
      };
  ```

**Where sync code lives:**

- **Top-level `apps/server/src/jobs/`** for queue-driven workflows (peer of `core/`, `providers/`, `integrations/`, `api/`). BECAUSE sync is a workflow, not an entity — forcing it into `core/` would muddy `core/`'s meaning.
- **`jobs/sync/types.ts`** — SyncJobPayload discriminated union + Zod schemas.
- **`jobs/sync/enqueue.ts`** — `enqueueSyncJob(payload)`. Validates with Zod, computes `dedup_key`, issues INSERT. The CLI calls this; it does NOT write to `job_queue` directly.
- **`jobs/sync/handler.ts`** — `runSyncJob(job)`. Called by the worker dispatcher after claiming a row. Loads `provider_account`, loads the provider adapter from the registry, calls `adapter.sync(cursor, constraints)`, inserts `message` + `message_raw` in a TX, updates `last_synced_at` and `sync_cursor`, returns result. Categorizes errors transient vs permanent.
- **`jobs/sync/index.ts`** — registers with the worker dispatcher.
- **`jobs/lib/`** — shared enqueue/poll/retry/backoff helpers.
- **Provider adapters stay thin.** Pure `sync(cursor, constraints) → { messages, newCursor, errors }`. No orchestration, no retry logic, no cursor management beyond what the provider's own protocol dictates.
- **Dependency direction**: `jobs/` → `core/` → `db/`. Never reverse. If a core service needs to enqueue, it accepts `enqueueSyncJob` as a dependency rather than importing `jobs/` directly.

**Worker process architecture:**

- **One worker process with many in-process queue consumers**, started via `MODE=worker` (or `MODE=all`) in `apps/server/src/main.ts`. BECAUSE: simpler deploy, `FOR UPDATE SKIP LOCKED` already handles concurrency safely, per-queue tuning is a parameter (concurrency, poll interval) not an entrypoint.
- **When to split into separate worker processes (future)**: LLM processing queue starts eating CPU/memory, independent restart/deploy cycles desired, or horizontal scaling (N replicas of process worker, 1 replica of sync worker). At that point, `MODE=worker-sync` and `MODE=worker-process` become separate filter flags on the same binary. Still one repo, one binary, still ADR-003 (single monolith multiple entrypoints).
- **`main.ts` already supports this** via the existing `MODE` env var pattern. Confirmed and cleaned up: the stub `sync` mode removed; modes are now `api | worker | all`; `all` runs api + worker in-process via `Promise.all`. Inline comment explains why one worker process runs all logical queues.
- **Graceful shutdown**: worker.ts will install SIGTERM/SIGINT handlers that stop polling, drain in-flight jobs, then exit. Captured for the implementation ticket.

**CLI verb shape:**

- `repel sync run <account>` — enqueue `sync.incremental` (default)
- `repel sync run <account> --full` — enqueue `sync.full`
- `repel sync run <account> --from <date>` (`--to <date>` optional) — enqueue `sync.range`
- `repel sync status` / `repel sync status <account>` / `repel sync status --watch` — query recent job state
- `repel sync cancel <job-id>` — mark pending jobs cancelled; no-op on in-flight (cancel-in-flight deferred — needs cooperative worker, not v1)
- `repel account list` / `add <provider>` / `show <account>` / `rm <account>` (last is soft: `is_active = false`)
- **`sync run` enqueues by default, does NOT run synchronously in the CLI process.** BECAUSE: matches production behavior, avoids "CLI hangs for 20 minutes" UX. Kyle's affirmation: "I can tail-f a log file if I need."
- **No implicit `sync.full` on first run.** First-time account with a null cursor and no `--full` flag errors out telling the user to pass `--full` or `--from`. BECAUSE: prevents accidental 50K-message pulls.
- **`<account>` identifier resolver** accepts uuid, alias, or `provider:external_account_id`; errors on ambiguity. (Noted but not yet implemented.)

**Org resolution in v1 (interim):**

- **v1: single-org bootstrap file.** `repel bootstrap` writes the one org's uuid to `~/.repel/bootstrap` (or equivalent). Every CLI command reads it. No `--org` flag at v1. Matches single-tenant self-host reality. BECAUSE: less machinery now, and the v2 profile system is a non-breaking add.
- **v2: profile system (`~/.aws`-style)**, filed as REP-6. Blocked until v1 sync ships.
- **Resolution order at v2**: `--org` flag > `REPEL_PROFILE` env > active profile in `~/.repel/config` > bootstrap file fallback > error.

**Job queue schema change required (minor migration):**

- Add `dedup_key text` column to `job_queue`.
- Add partial unique index `CREATE UNIQUE INDEX ... ON job_queue (queue, dedup_key) WHERE status IN ('pending', 'processing')`.
- Absorbed into the first sync implementation ticket, not a standalone migration ticket.

### Q5 — Raw-side ergonomics (LOCKED, folded into Q4)

- All raw-side CLI and data-model questions resolved inside Q4 above.
- **Replay-side ergonomics (re-process with new processor versions, stale-fact detection via content hash) is deferred** alongside Q2. Specifically captured open items in `docs/design_ideas/derived-fact-model.md` section E: add `message.content_hash` and `derived_fact.message_content_hash`, fact is "fresh" when hashes match, replay verbs target stale facts (`process replay --stale --processor classify`).

### Schema review vs `docs/03-sql-schema.md`

Flagged during Q2 discussion, still outstanding — the existing schema has several things at odds with the direction this session locked in:

1. `channel` and `provider` treated as sibling flat enums with no nuance — Q1 fixes this.
2. No `protocol` concept — Q1 confirms this should stay code-only (no schema change needed).
3. Derived tables are per-feature, not per-processor — Q2 deferral addresses this.
4. `classifier_config` is singular (only the classifier is user-configurable) — Q2 deferral addresses this.
5. `job_queue.payload` is opaque with no link to message_id or processor_id — Q4 partially addresses (dedup_key, typed sync payloads).
6. `thread.channel` hardcodes single-channel threads — not addressed this session, flagged for future cross-channel work.

**Schema doc `docs/03-sql-schema.md` has NOT been updated this session.** It will need a significant rewrite when implementation begins, at minimum for the `provider_account` table (Q1) and the `job_queue` changes (Q4). Left untouched deliberately — updating a schema doc that isn't yet implemented is premature.

## Key Numbers Generated or Discovered This Session

- **Linear tickets created this session:** 2 (REP-5, REP-6).
- **ADRs written/replaced this session:** 1 (ADR-005 replaced in place; ADR-009 amended, not replaced).
- **Design-idea docs created:** 3 (`derived-fact-model.md`, `future-surfaces.md`, `scaffold-cleanup.md`).
- **Q resolved:** 4 of 6 (Q1, Q3, Q4 fully; Q5 folded into Q4; Q2 and Q5-replay deferred; Q6 pending).
- **Sync job types:** 3 (`sync.full`, `sync.incremental`, `sync.range`).
- **Logical queues at v1:** 1 (`sync`). Future additions expected: `process`, `send`, `integration_export`.
- **Worker processes at v1:** 1 (runs all logical queues in-process).
- **Provider enum values at v1:** 3 (`gmail`, `icloud`, `generic_imap`).
- **Channel enum values at v1:** 4 (`email`, `sms`, `dm`, `chat_room`).
- **Auth method enum values at v1:** 3 (`oauth2`, `app_password`, `api_key`).
- **Context used when handoff written:** 124.7k / 1M tokens (12%).

## Conditional Logic Established

- **IF** a new provider uses an existing protocol **THEN** create `providers/<name>/{definition.ts, adapter.ts}` + register in `providers/index.ts` + one-line provider enum migration. **NO** other changes required.
- **IF** a new wire protocol is added **THEN** create `providers/lib/protocols/<name>.ts` only. **NO** migration, **NO** enum change, **NO** database touch.
- **IF** a new logical queue is needed **THEN** add a new consumer to `worker.ts` and a new top-level `jobs/<name>/` directory. **NO** new process, **NO** new binary, **NO** `main.ts` mode change unless you want independent worker pool control.
- **IF** a core service needs to enqueue a job **THEN** inject `enqueueSyncJob` (or equivalent) as a dependency. **NEVER** import from `jobs/` into `core/`.
- **IF** REP-5 (`domains/` → `core/` rename) runs as a standalone ticket **THEN** recommend deferring until the first implementation ticket that touches these directories — standalone churn is worse than the placeholders.
- **IF** sync is running end-to-end in the CLI against the bootstrap-file org fallback **THEN** REP-6 (profile system) unblocks.
- **IF** Q2 is revisited **THEN** the decision to make is event-sourced-pipeline vs table-based (`processor` / `processor_run` / `derived_fact`). Do NOT implement one and switch later — live data migration will be painful.
- **IF** the first real processor is about to be written **THEN** Q2 MUST be resolved first.
- **IF** auth/session management work begins **THEN** revisit whether `core/org/` and `core/user/` should become `core/tenancy/` (currently deferred).
- **IF** a multi-channel provider (one upstream credential for two channels) actually ships **THEN** introduce a `provider_credential` sibling table and revisit ADR-005. Until then, model as two separate providers.
- **IF** the MCP surface is built before the REST API **THEN** decide whether it talks to services directly or calls the REST API internally (lean former).
- **IF** `message` content changes during re-sync **THEN** derived facts become stale but are NOT auto-invalidated — use content-hash comparison and let replay verbs target stale facts (deferred with Q2).

## Files Created or Modified

| File Path                                                           | Action                         | Description                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------ |
| `docs/context/adr/ADR-005-provider-account-vocabulary.md`           | Created (replaces old ADR-005) | Full three-level provider/channel/account vocabulary. ACCEPTED. Supersedes nothing (old ADR-005 deleted in place).                                                                                                                                                                                          |
| `docs/context/adr/ADR-005-channel-adapter-pattern.md`               | Deleted                        | Old ADR-005 removed in place — 2 commits in, no code references, decided to delete the junk rather than mark superseded.                                                                                                                                                                                    |
| `docs/context/adr/ADR-012-provider-account-vocabulary.md`           | Created then deleted           | Draft written as ADR-012 first; Kyle asked to replace in place; deleted after content moved to ADR-005.                                                                                                                                                                                                     |
| `docs/context/adr/ADR-009-vertical-domain-layout-repo-factories.md` | Modified                       | Added `## Amendments` section dated 2026-04-14 explaining the `domains/` → `core/` rename. Updated the Decision, Consequences, Risks, Compliance, and Review Trigger prose to say "bounded context" / "context" / "core/" instead of "domain" / "domains/". Pattern, rules, and factory contract unchanged. |
| `docs/context/adr/index.md`                                         | Modified                       | ADR-005 row retitled from "Channel Abstraction via Adapter Pattern" to "Provider Account Vocabulary", domain list expanded, filename updated.                                                                                                                                                               |
| `docs/design_ideas/derived-fact-model.md`                           | Created                        | Full deferred design for Q2: three-table model (`processor`, `processor_run`, `derived_fact`), mapping from old per-feature tables, six open sub-questions, event-sourcing alternative direction elevated to primary option, revisit triggers.                                                              |
| `docs/design_ideas/future-surfaces.md`                              | Created                        | MCP server deferral note. Product-spec-committed feature, open design questions, trigger for revisiting.                                                                                                                                                                                                    |
| `docs/design_ideas/scaffold-cleanup.md`                             | Created                        | What stays / what goes / what relocates in `apps/server/src/`. Notes that `domains/org/` and `domains/user/` are real and survive; `domains/providers/` and `domains/account-setup/` are throwaway. Deletion happens alongside first real implementation, not as standalone ticket.                         |
| `docs/summaries/handoff-2026-04-14-project-breakdown-plan.md`       | Created                        | This handoff.                                                                                                                                                                                                                                                                                               |
| `apps/server/src/main.ts`                                           | Modified                       | Removed stub `sync` mode. Modes now `api                                                                                                                                                                                                                                                                    | worker | all`. Inline comment explains worker runs all logical queues in-process. |
| Linear REP-5                                                        | Created                        | `domains/` → `core/` rename ticket. Backlog, Medium. No project.                                                                                                                                                                                                                                            |
| Linear REP-6                                                        | Created                        | CLI profile/config system. Backlog, Low. No project. Blocked until v1 sync ships.                                                                                                                                                                                                                           |

## What the NEXT Session Should Do

1. **First, read this handoff in full** (`docs/summaries/handoff-2026-04-14-project-breakdown-plan.md`).
2. **Then, execute Q6 — Linear project breakdown.** Propose a list of Linear projects with scopes, dependency ordering, and indicative ticket outlines. The goal is to have a concrete roadmap in Linear that REP-5 and REP-6 can be slotted into, and that the first implementation session can pick up from.
3. **Specifically, Q6 must answer:**
   - What are the distinct Linear projects? (Earlier working guess was six: CLI Foundation, Channel Adapters, Sync Engine, Processing Pipeline Core, Initial Processors, HTTP API + Frontend. That guess predates Q1–Q4 resolutions and may not hold.)
   - What is the dependency order and which are parallelizable?
   - Which project absorbs REP-5 (`domains/` → `core/` rename)?
   - Which project unblocks REP-6 (profile system)?
   - What's the first ticket in the first project (the "pick this up on Monday" answer)?
   - How do we handle the schema rewrite for `docs/03-sql-schema.md` — one ticket per project that touches schema, or one ticket at the top of the roadmap to rewrite it against locked decisions?
4. **Before creating projects in Linear, pause and confirm the project list with Kyle.** Do NOT spam the workspace with speculative projects.
5. **After project list is confirmed**, use `/linear-new` or `save_project` + `save_milestone` via the Linear MCP to scaffold. Use `ticket-breakdown` subagent only if the scope is large enough to justify it — single-project first-ticket breakdowns can be done inline.

## Open Questions Requiring User Input

- **OPEN:** Does `core/org/` + `core/user/` stay as two separate subdirectories or get grouped as `core/tenancy/`? Needs auth/session management discussion. Deferred until that work begins.
- **OPEN:** Should `docs/03-sql-schema.md` be rewritten as a Q6 preamble (one "schema v2 doc rewrite" ticket) or per-project as tables are actually implemented? Needs Kyle's call.
- **OPEN:** When Q2 is revisited, event-sourced pipeline vs table-based derived facts? Six sub-questions in `docs/design_ideas/derived-fact-model.md` (A–G).
- **OPEN:** REP-6 open items — credential storage in profiles (probably OS keychain), config file format (lean TOML), `repel config` vs `repel profile` noun (lean `config`).
- **OPEN:** Does the MCP server speak directly to services or call the REST API internally? Deferred with MCP.

## Assumptions That Need Validation

- **ASSUMED:** The `provider_account` table and its supporting enums will be introduced as part of the first Linear project (likely whichever ships the first provider adapter). Not yet confirmed — Q6 decides.
- **ASSUMED:** The `job_queue` schema change (`dedup_key` column + partial unique index) lands in the first sync ticket, not a standalone migration ticket. Not yet confirmed — Q6 may want a schema-migration ticket up front.
- **ASSUMED:** REP-5 (domains → core rename) executes inside the first ticket that touches those directories, not as standalone churn. Captured in `docs/design_ideas/scaffold-cleanup.md` as a suggestion, but Q6 can override.
- **ASSUMED:** The CLI bootstrap-file org resolution is acceptable for v1 because v1 is strictly single-tenant self-host. If Kyle wants multi-org from day one, the profile system needs to move forward and REP-6 becomes a blocker instead of a follow-up.
- **ASSUMED:** Gmail and iCloud are both in scope for the first provider-adapter project. The product spec says so ("Both channels are in scope for the initial build. Including two providers from the start validates the channel abstraction..."). Not yet confirmed as the Q6 project shape.
- **ASSUMED:** `docs/03-sql-schema.md` will need a rewrite at some point — not attempted this session. Validate by comparing the current doc against Q1 and Q4 decisions when Q6 runs.

## What NOT to Re-Read

- `docs/context/adr/ADR-005-channel-adapter-pattern.md` — DELETED. Do not look for it.
- `docs/context/adr/ADR-012-provider-account-vocabulary.md` — DELETED. Content lives at ADR-005.
- Old ADR-005 decisions — fully captured in this handoff and in the new ADR-005 file; no need to reconstruct from git history.
- The initial 6-project guess from early in the session — superseded by Q1–Q4 resolutions; Q6 should derive a fresh list, not revisit that guess.

## Files to Load Next Session

**Essential reading order for the Q6 session:**

1. `docs/summaries/handoff-2026-04-14-project-breakdown-plan.md` — this handoff. Load first.
2. `docs/context/adr/ADR-005-provider-account-vocabulary.md` — locked vocabulary for the provider layer.
3. `docs/context/adr/ADR-009-vertical-domain-layout-repo-factories.md` — core directory pattern (pay attention to the Amendments section).
4. `docs/context/adr/index.md` — the full ADR index, because Q6 needs awareness of every accepted ADR that might constrain a project.
5. `docs/design_ideas/derived-fact-model.md` — to understand what is _intentionally not in scope_ for the near-term projects.
6. `docs/design_ideas/scaffold-cleanup.md` — to understand which existing source files can be deleted, which are real, and which need to move.
7. `docs/design_ideas/future-surfaces.md` — to understand what's deferred and why.
8. `docs/01-product-spec.md` — to ground the project list in actual product commitments.
9. `docs/03-sql-schema.md` — to identify what in the current schema doc conflicts with Q1/Q4 decisions.
10. `apps/server/src/main.ts` — the current entrypoint shape that defines the mode surface.
11. The `apps/server/src/` file tree — to understand what physically exists vs. what needs to be created. Use Glob, not Read-all.

**DO NOT load at session start:**

- `docs/context/adr/ADR-001` through `ADR-004`, `ADR-006` through `ADR-008`, `ADR-010`, `ADR-011` — read them on demand only if a specific Q6 question lands on their turf. They're indexed; pick surgically.
- `docs/02-deployment-stack.md`, `docs/04-application-architecture.md`, `docs/05-code-conventions.md`, `docs/06-adrs.md` — load only if a project needs them.
- `docs/existing_market/companies.md` — irrelevant to Q6.

## Linear State At Handoff

- **REP-5** — Rename `apps/server/src/domains/` → `core/` and adopt Option C two-layer split. Backlog. Medium. No project. https://linear.app/repel/issue/REP-5/rename-appsserversrcdomains-core-and-adopt-option-c-two-layer-split
- **REP-6** — CLI profile/config system. Backlog. Low. No project. Blocked on v1 sync shipping with bootstrap-file org resolution. https://linear.app/repel/issue/REP-6/cli-profileconfig-system-repel-init-repelconfig-profile-selection
- **No projects exist yet in Linear.** Q6 will change that.
- **Team:** Repel (only team in the workspace).
