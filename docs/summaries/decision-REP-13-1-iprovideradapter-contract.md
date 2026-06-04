# Decision Record: DR-REP-13-1 — IProviderAdapter Contract

**Ticket:** REP-13 — Adapters: abstract IProviderAdapter contract
**Date:** 2026-06-01 (revised 2026-06-03 after PR #19 review)
**Status:** Accepted
**Depends on:** REP-50 (raw + normalized message schema — merged, PR #18)
**Blocks:** REP-14 (Gmail adapter), REP-21 (sync vertical)

> **Revised after review (PR #19).** Renamed `AuthPromptInput` →
> `ProviderAuthContext` (now carries a `provider` slug) and `AuthorizedCredentials`
> → `ProviderAuthorization`. Replaced the bare `cursor` on `IngestInput` with an
> `AdapterSyncSpec` discriminated union (`incremental | range | full`). Changed
> every discriminant field name from `phase` to `type`. Switched the message
> projection types from `Pick` to `Omit`. Added an `AdapterError` abstract base
> and typed the failed event on it. Dropped the `adapters/index.ts` barrel.
> Stripped all ticket/DR/manifesto citations from the source files (kept here, in
> the DR, where they are institutional memory). Sections below reflect the
> revised shapes.

## Context

The platform must sync, send, ingest, and interactively authorize across many
providers in one uniform shape. Without a contract each adapter invents its own
surface and the calling code fragments (manifesto §8, Rule 6). This DR settles
the abstract `IProviderAdapter` contract, its supporting types, the
`AdapterEvent` state-machine model, where the types physically live, and how the
features↔adapters import barrier is enforced. No concrete adapter is built here
(REP-14 is Gmail).

## Decisions

### D1 — Contract surface

`IProviderAdapter` has exactly five members, matching the directional contract in
the ticket:

- `readonly capabilities: Capabilities`
- `promptUserAuthorization(input: ProviderAuthContext): Promise<ProviderAuthorization>`
- `ingest(input: IngestInput): AsyncIterable<AdapterEvent>`
- `send(input: SendInput): Promise<{ providerMessageId: string }>`
- `normalize(raw: RawMessage): NormalizedMessage` — pure, synchronous

**Why:** This is the minimum that lets platform code drive every provider
identically. Everything not needed before the second adapter exists is deferred
(see Deferred).

`ProviderAuthContext` carries `{ provider: ProviderSlug, orgId, userId }`. The
slug is on the context (even though each adapter instance already knows its own
provider) so the onboarding dispatcher — `accounts add <provider>`, REP-22 — can
construct the context generically. `ProviderAuthorization` is
`{ externalAccountId, authMethod, credentials: unknown }`; `credentials` is opaque
and stored encrypted on the `provider_account`.

### D2 — Types live in `adapters/types.ts`, not `processing-pipeline/types.ts`

Resolves the ticket's first OPEN question.

**Why:** The processing pipeline owns no business logic and knows nothing about a
provider payload beyond the envelope wrapper (manifesto Rule 7). The adapter
contract is provider-facing business vocabulary (auth, ingest, send, normalize) —
it belongs to the adapters layer. The pipeline's `Envelope`/`NodeId` types remain
separate and land in `processing-pipeline/types.ts` when the second handler
creates a real orchestration need (manifesto §7 — that directory stays
shape-only until then). Consumers import the contract from
`adapters/types.ts` directly (see D8 — no barrel).

### D3 — `AdapterEvent` is a `type`-keyed discriminated union; `ingest` streams it

`ingest` returns `AsyncIterable<AdapterEvent>`. The union members, keyed on a
`type` field, are: `started | auth | progress | message | completed | failed`.

- `started` — opens the run; optional `estimatedTotal`.
- `auth` — records that a refresh-on-use happened (`refreshed: boolean`); makes
  token rotation observable without exposing the credential.
- `progress` — running `processed` count (advisory).
- `message` — one observed message carrying BOTH `raw: RawMessage` and
  `normalized: NormalizedMessage | null`. `normalized` is null when normalize
  failed but raw is still worth persisting.
- `completed` — terminal success; carries the `cursor` to store for next sync and
  the final `processed` count.
- `failed` — terminal failure; carries `error: AdapterError` (see D7).

A well-formed stream ends with exactly one of `completed`/`failed`.

**Why:** A sync is a long-running, unbounded state machine (a backfill is tens of
thousands of messages). Streaming events lets the runner persist each
raw+normalized pair in its own short transaction, report progress, and checkpoint
a cursor mid-sync — none of which a returned batch allows.

**Discriminant field name (`type`).** Changed from `phase` to `type` in review.
There was no pre-existing discriminated-union convention in the repo; `type` is
the common TS idiom. (The manifesto's `Envelope` uses `kind`, but that is a
different layer — the transport envelope, not the adapter event.)

**Discriminant value set is REP-13's, not REP-21's.** REP-21 publishes a richer
`sync_event.phase` set (`auth-started`/`auth-completed`/`auth-failed`,
`raw-message`, `cancelled`, …) and declares itself the authority for it. That set
is itself placeholder, and some of its members (`started`, `cancelled`) are
runner-authored, not adapter-emitted — so `AdapterEvent` is a subset, not an
identical match. Decision: keep REP-13's minimal set as-is; REP-21 reconciles the
two when it implements the runner. No cross-ticket "MUST match" coupling is
asserted in code.

### D3b — `AdapterSyncSpec` discriminated union on `IngestInput`

`IngestInput` carries `spec: AdapterSyncSpec` instead of a bare `cursor`. The
union (discriminant `type`) has three lo-fi variants:

- `{ type: 'incremental'; cursor: unknown }` — resume from an opaque provider
  cursor.
- `{ type: 'range'; from?: Date; to?: Date }` — bounded historical window.
- `{ type: 'full' }` — everything, no bounds.

**Why:** A flat `{ cursor?, since?, until? }` lets the caller construct nonsense
(cursor + until together). A union makes only the valid modes representable and
forces adapters to handle each via an exhaustive `switch`. The variant names
mirror REP-21's `sync_job.sync_kind CHECK ('full','incremental','range')`, so the
runner builds an `AdapterSyncSpec` directly from a `sync_task` + job. This
supersedes REP-21's own sketch, which passed a flat `{ range, cursor }` bag.
`range`/`full` cursor computation and which mode is the default are REP-21's to
decide.

### D4 — `NormalizedMessage` / `RawMessage` are `Omit`-derived from the REP-50 schema

The contract types are `Omit`s over the Kysely-generated row interfaces in
`infra/db/generated.ts`, so they cannot drift from the persisted schema:

- `RawMessage = Omit<MessageRaw, 'id' | 'createdAt' | 'syncTaskId'>` — the
  remaining columns are the adapter-supplied subset; the omitted three are
  runner-assigned.
- `NormalizedMessage = Omit<Message, 'id' | 'createdAt' | 'updatedAt' | 'orgId' |
'userId' | 'providerAccountId' | 'rawMessageId' | 'threadId' | 'direction' |
'isRead' | 'isArchived' | 'isStarred' | 'isDeleted'> & Pick<Thread,
'externalThreadId'> & { participants: NormalizedParticipant[] }`.
- `NormalizedParticipant = Omit<MessageParticipant, 'id' | 'createdAt' |
'messageId' | 'orgId' | 'userId' | 'contactId'>` — leaves `handle | displayName |
role`.

**Why Omit not Pick (changed in review):** `Omit` fails safer for a type meant to
track a schema. With `Pick`, a new schema column is silently excluded until
someone updates the allowlist; with `Omit`, a new column is included by default
and only excluded if the runner explicitly owns it. The `Omit` list also doubles
as the documentation of exactly what the adapter does NOT produce.

**Why derive at all:** deriving from `generated.ts` (the single source of truth
for shapes) guarantees the contract aligns column-for-column with the schema, and
a future schema change surfaces as a compile error here.

Two non-obvious sourcing choices:

- `externalThreadId` is taken from `Thread`, not `Message`. The message row
  stores a resolved `thread_id` FK; `normalize()` is pure and cannot resolve a
  thread (that is a DB lookup). The adapter emits the provider's own thread id;
  the runner resolves/creates the thread row and sets `message.thread_id`.
- `NormalizedParticipant` deliberately omits `contact_id`. Contact reconciliation
  is a DB lookup and `normalize()` is pure/synchronous (per ticket and REP-50
  DR). The adapter emits `{handle, displayName, role}` with no `contact_id`; a
  downstream reconciler populates `message_participant.contact_id` later.

### D5 — Refresh-on-use is internal; no `refresh()` on the interface

`promptUserAuthorization` is the only credential-producing entry point. Token
refresh lives inside `ingest()` and `send()` (they read stored credentials and
refresh transparently). The platform never calls refresh directly. On terminal
refresh failure the adapter throws a "needs re-auth" error and the caller
re-runs `promptUserAuthorization`.

**Why:** Matches the ticket's explicit out-of-scope ("token refresh as a public
method"). Keeps the platform ignorant of credential lifecycle mechanics.

### D7 — `AdapterError` abstract base; `failed` event typed on it

`adapters/error.ts` declares `abstract class AdapterError extends AppError`
(matching the repo's `features/*/error.ts` pattern). `AdapterFailedEvent.error`
is typed `AdapterError`, not bare `Error`.

**Why:** Typing the field on a domain base forces adapter authors to wrap provider
failures in a domain error instead of leaking a raw fetch/client error into the
event stream — the same discipline the rest of the codebase follows. Only the
abstract base ships now; concrete subclasses (e.g. `AuthExpiredError` for the
re-auth case) are added by REP-14, the first adapter with a real throw site. This
addressed the review suggestion for an "AdapterEventError" domain type.

### D6 — Import barrier enforced by ESLint (`no-restricted-imports`)

The repo was previously lint-free (Prettier + tsc only). REP-13 introduces a
minimal ESLint flat config (`eslint.config.mjs`) whose sole job is the manifesto
import barriers:

- **Rule 6** — `features/* ✗→ adapters/*` and `adapters/* ✗→ features/*`.
- **Rule 1a** — `features/* ✗→ api/` and `features/* ✗→ cli/`.

Tooling footprint is intentionally minimal: `eslint` + `@typescript-eslint/parser`
only (no `typescript-eslint` plugin, no type-aware rules, no recommended ruleset).
Wired into the existing husky `lint-staged` pre-commit (scoped to
`apps/server/src/**/*.ts`) and a `bun run lint` script. Verified: clean on the
current tree; all three barrier directions error with manifesto-referenced
messages when a violating import is injected.

**Why:** The AC allowed "ESLint rule OR documented convention if lint cost is too
high." A real machine-checkable gate was chosen over a convention so the
channel-agnostic claim (Rule 6) cannot silently erode. The minimal footprint
avoids dragging a recommended ruleset (and a triage backlog) into a repo that
deliberately runs lint-free.

### D8 — No barrel export in `adapters/index.ts`

`adapters/index.ts` is a shape-only stub, not a re-export barrel. The original
barrel re-exported the contract types from a sibling file in the same directory —
no abstraction, no external consumer (verified: nothing imports from
`adapters/index` or `adapters/types` outside the directory). A barrel earns its
place once there is a concrete adapter _instance_ to export (`adapters/gmail`
exporting `gmailAdapter`); until then it is ceremony. Consumers import from
`./types.ts` directly.

## Deferred (explicitly out of scope)

- **OPEN → REP-22 (onboarding):** Pending-auth lifecycle (a `provider_account`
  row created before credentials exist), multi-account semantics, and any
  `provider_account.status` column. These are onboarding-flow + schema decisions
  that belong to REP-22, not to the adapter contract. (`credentials_encrypted` is
  already nullable, so a pending row is representable without a schema change.)
- **OPEN → REP-21:** `AdapterEvent` value-set reconciliation, `range`/`full`
  cursor computation, the default sync mode, and cancellation observation.
- **OPEN → REP-14:** The "needs re-auth" error — a concrete `AdapterError`
  subclass (e.g. `AuthExpiredError`) thrown by `ingest()`/`send()` on terminal
  refresh failure, distinguishable from a transient error. Only the abstract
  `AdapterError` base ships in REP-13.
- **OPEN (Rule 1b not encoded in lint):** Cross-feature reads-through-views is
  not enforced by `no-restricted-imports` — a feature importing its OWN siblings'
  `views/` is legal while importing their `flows`/`service` is not, which path
  globs express poorly. Stays a documented convention until a type-aware boundary
  plugin is justified.
- **DEFERRED:** Adapter/provider registry — adapters are imported directly by
  their caller until a second adapter justifies extraction.
- **DEFERRED:** Singleton-vs-factory for adapter instances — wait until a second
  adapter or per-account state reveals the right answer.
- **DEFERRED:** Per-account capability variance — `capabilities` stays a static
  `readonly` const; becomes a method when a real OAuth-scope-driven toggle case
  appears.
- **DEFERRED:** Webhook ingress — lives in `api/routes/webhooks/<provider>/`,
  translates HTTP into envelopes, does not implement `IProviderAdapter` (may
  share `normalize.ts`).

## Files

| File                                                            | Action   | Description                                                                              |
| --------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------- |
| `apps/server/src/adapters/types.ts`                             | Created  | The contract + all supporting types (`AdapterSyncSpec`, `AdapterEvent`, message shapes). |
| `apps/server/src/adapters/error.ts`                             | Created  | `abstract class AdapterError extends AppError`.                                          |
| `apps/server/src/adapters/index.ts`                             | Modified | Shape-only stub (no barrel).                                                             |
| `eslint.config.mjs`                                             | Created  | Minimal flat config enforcing manifesto Rules 6 and 1a.                                  |
| `package.json`                                                  | Modified | Added `eslint` + `@typescript-eslint/parser` dev deps, `lint` script, lint-staged entry. |
| `docs/summaries/decision-REP-13-1-iprovideradapter-contract.md` | Created  | This DR.                                                                                 |

## Verification

- `bun run lint` — clean (exit 0).
- Barrier negative test — all 3 directions error with the correct messages.
- `bun run typecheck` — passes; new types compile against REP-50's `generated.ts`.
- `bun test` — 302 pass, 0 fail.

Complies with manifesto §3 (adapters/ TLD), §4 (Adapter definition), §7
(pipeline owns no business logic — types stay out of it), §8 (adapter directory
convention), Rule 1a, Rule 6.
