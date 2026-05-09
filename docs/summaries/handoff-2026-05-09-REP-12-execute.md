# Handoff — REP-12 Execute

**Ticket:** [REP-12 — Implement core/message minimal (write + read for sync)](https://linear.app/repel/issue/REP-12)
**Parent:** REP-7
**Phase:** execute
**Date:** 2026-05-09
**Status:** Implementation complete, awaiting code review + verifier.

## What changed

### New bounded context: `core/message/`
- `apps/server/src/core/message/types.ts` — domain types (`Message`, `Thread`, `InsertMessageInput`, `MessageRawPayload`, list/cursor opts, `GetOrCreateThreadInput`). Uses `@repel/shared` enums (`ChannelSlug`, `ProviderSlug`, `MessageDirectionSlug`).
- `apps/server/src/core/message/mappers.ts` — `messageRowToMessage`, `threadRowToThread`. Pure projections (CamelCasePlugin already converts cases).
- `apps/server/src/core/message/repo.ts` — `makeMessageRepo(q: DbExecutor)` per ADR-009. Owns `message`, `message_raw`, and the `thread` helpers consumed by `messageService`. Methods: `insertMessage`, `insertMessageRaw`, `findMessageById`, `findMessageByExternalId`, `listMessagesByAccount` (keyset paginated newest-first via `(sent_at, id)` tuple compare), `findThreadByExternalId`, `insertThread`, `incrementThreadCounter` (uses `GREATEST(last_message_at, $1)`).
- `apps/server/src/core/message/service.ts` — `export const messageService = { ... }` per ADR-009 amendment. Five public methods, each wrapped in `runInOrgTx` (ADR-010). `insertMessageWithRaw` resolves/creates the thread inline using the repo helpers (NOT the public `getOrCreateThread`), inserts the message with `threadId`, inserts `message_raw`, then increments the thread counter — all inside the decorator's tx.

### Wiring + db type aliases
- `apps/server/src/db/types.ts` — added `MessageRawRow = Selectable<MessageRawTable>`, `NewMessageRaw = Insertable<MessageRawTable>`, `ThreadUpdate = Updateable<ThreadTable>`.
- `apps/server/src/db/repos.ts` — added `messages: makeMessageRepo(q)` to `makeRepos`.

### Locked decisions made during execution

- **Mappers filename plural** (`mappers.ts`) — codebase convention overrides ticket wording.
- **Repos key:** `messages` (matches `orgs`, `users`).
- **One repo for `message` + `message_raw` + `thread` helpers.** No separate `threadRepo`. `getOrCreateThread` is on `messageService` since it's the only caller for now.
- **No `*Impl` exports.** Match `acmeService` purity. Lift later if a flow context needs to compose under `runInTx`.
- **`externalThreadId` required.** Channels without thread coords are out of scope for REP-12.
- **`getMessageById` does not defensively filter `orgId`.** RLS owns isolation. Test #10 codifies the choice.
- **`message_raw` has no direct RLS** — inherits via FK to `message.org_id`. Known and accepted (see ADR-002 caveat). Will surface if a future ticket needs to query `message_raw` directly.
- **Test strategy: pure unit, `bun:test` only.** No DB integration harness exists in tree; introducing one was deemed out of scope. RLS isolation is verified at the application boundary via the `runInOrgTx` decorator's cross-org guard, parameterized across all five service methods.

## Tests

`apps/server/src/core/message/__tests__/service.test.ts` and `mappers.test.ts`. 34 tests covering:

- `insertMessageWithRaw`: new thread, existing thread, out-of-order `sentAt` (counter `GREATEST` semantic), duplicate-PK guard with no raw write or counter bump, raw-failure with no counter bump, side-effect ordering, enum pass-through.
- `getMessageById`: happy, not-found throws, cross-org row returned (RLS owns; service does not filter).
- `listMessagesByAccount`: happy, limit pass-through, cursor pass-through, empty.
- `getMessageByExternalId`: happy, null-on-missing, args forwarded.
- `getOrCreateThread` (standalone): existing, create-new, no counter side-effect, optional `subject`.
- RLS-guard / decorator: cross-org refusal, runInTx-only ambient refusal, same-org join — each parameterized across all five service methods (10 generated tests).
- `mappers`: `messageRowToMessage` full row, `threadRowToThread` with nulls.

`bun test apps/server/src/` — **70 pass / 0 fail**, no regressions.

## Coverage

| File | % Funcs | % Lines |
|---|---|---|
| `core/message/mappers.ts` | 100.00 | 100.00 |
| `core/message/service.ts` | 100.00 | 100.00 |
| `core/message/types.ts` | n/a (type-only) | n/a |
| `core/message/repo.ts` | 0.00 | 1.08 |

`repo.ts` is uncovered by design under the locked unit-only strategy: tests use a fake `Repos` via `withTxContext`, so the real repo's Kysely query bodies are never invoked. The keyset pagination tuple `(sent_at, id) < (cursor.sentAt, cursor.id)` and the `GREATEST(last_message_at, $1)` update both depend on Postgres semantics that no unit test exercises.

## Build

`bun run typecheck` (`tsc --build`) — clean.

## Deviations from TDD plan

1. **`InsertMessageInput.threadSubject` (optional)** added alongside `message.subject`, so callers can seed thread subject independently. Service falls back to `message.subject` when `threadSubject` is omitted. No new test was added for this branch — minor risk; covered functionally by the new-thread happy path.
2. Test 24 (same-org join executes body) was written as a discrete test, kept the parameterized fan-out for tests 22 and 23 across all five methods.

## Open items / follow-ups (NOT yet Linear tickets)

- **OPEN:** Repo SQL correctness is unverified at unit level. Recommend a follow-up ticket once a DB integration harness exists. The keyset pagination row-tuple compare and `GREATEST` clause are the two SQL fragments most likely to regress silently.
- **OPEN:** `message_raw` RLS posture. If a future caller queries `message_raw` directly (without joining through `message`), tenant isolation will not hold. Either keep all access mediated by `message` joins, or open a migration ticket to add `org_id` + RLS to `message_raw`.
- **OPEN:** `runInOrgTx` happy-path branch (`getDb().transaction()...`) remains uncovered in `tx.ts`. Same root cause as repo coverage gap. Pre-existing — not introduced by REP-12.

## ADRs referenced

Complies with ADR-002 (org-scoped RLS), ADR-009 + 2026-04-18 amendment (vertical layout, singleton service), ADR-010 + 2026-04-18 rewrite (`runInOrgTx` owns the tx), ADR-011 (CamelCasePlugin).

## Files changed

Created:
- `apps/server/src/core/message/types.ts`
- `apps/server/src/core/message/mappers.ts`
- `apps/server/src/core/message/repo.ts`
- `apps/server/src/core/message/service.ts`
- `apps/server/src/core/message/__tests__/service.test.ts`
- `apps/server/src/core/message/__tests__/mappers.test.ts`

Modified:
- `apps/server/src/db/types.ts`
- `apps/server/src/db/repos.ts`

## Next step

Squash → push → `/create-pr` → `code-reviewer` → `verifier`.
