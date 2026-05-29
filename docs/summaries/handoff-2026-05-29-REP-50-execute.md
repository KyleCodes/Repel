# Session Handoff: REP-50 — Raw + Normalized Message Schema

**Date:** 2026-05-29
**Session Duration:** ~3 hours
**Session Focus:** Settle the per-message schema (raw + normalized + thread + participant + attachment + contact) that adapters write into; ship the migration, regenerate codegen, open PR.
**Context Usage at Handoff:** ~55%

## What Was Accomplished

1. Analyzed the literal current schema via `bun run cli db query` against `information_schema`, `pg_constraint`, `pg_indexes`, `pg_policies`, `pg_enum`. Identified structural problems with `message_raw` (dependent extension of `message`, no org/user scoping, no RLS, no sync provenance), `contact_handle` (no `org_id`, no RLS), `attachment` (`storage_path NOT NULL` blocked metadata-first ingest), and `message` (recipient/cc/bcc arrays lose identity, role, display name).
2. Iterated the design section-by-section with the user (5 sections). Each section locked before moving on.
3. Wrote the full plan to `/Users/kylemuldoon/.claude/plans/sequential-noodling-donut.md` and posted it as a comment on Linear REP-50 (comment id `4195b255-d00f-4858-839d-3926fda94f45`).
4. Created the migration via `bun run cli db migrations create rep-50-message-schema`. Renamed to drop the duplicated `rep-50-rep-50-` prefix the CLI emitted. Filled it in following `1777002187000_rep-9.ts` conventions.
5. Applied the migration via `bun run cli db migrations up`. Codegen regenerated automatically.
6. Verified the live schema via `bun run cli db query` — every column, FK, unique constraint, CHECK constraint, and RLS policy matches the plan.
7. Verified down→up round-trip clean. `bun run build` clean. `bun test` 302/302 pass.
8. Committed, pushed, opened PR #18 (https://github.com/KyleCodes/Repel/pull/18).
9. Posted summary comment on REP-50 (comment id `c88a96bd-e220-42b0-9360-82093781d920`).

## Exact State of Work in Progress

- Implementation complete. PR open, awaiting human review and merge.
- No code blocked on user input.

## Decisions Made This Session

All decisions are captured in the REP-50 Linear comment (`4195b255-d00f-4858-839d-3926fda94f45`). Highlights:

- **`message_raw` inverted to root**: own `id PK`, FKs to `org`, `user`, `provider_account`. `message` carries `raw_message_id UNIQUE NOT NULL` back-pointer. Raw can persist when normalize fails. BECAUSE the adapter contract (REP-13) emits raw + normalized in one tx and the re-normalization flow requires raw to outlive any single normalize attempt — STATUS: confirmed.
- **`sync_task_id NOT NULL` from day one** on `message_raw`, unconstrained until REP-21's migration adds the FK. BECAUSE every raw row in the system's life is produced by a task; nullable invites a test-fixture-without-a-task anti-pattern — STATUS: confirmed.
- **`payload_schema` (not `content_type`)** identifies the payload shape (`gmail.users.messages.v1`) so a future re-normalizer dispatches correctly — STATUS: confirmed.
- **`created_at` only** on `message_raw` (no `fetched_at`). Processing-time / delay metrics are infra-layer (`sync_event` timestamps), not data-layer — STATUS: confirmed.
- **`thread` stays a table** (not a view over `message`). Non-reducible columns (drafts, per-thread archived/snoozed/category) require a stable row id; pure-view forces a side table the moment any of these arrives — STATUS: confirmed.
- **Thread unique re-scoped** from `(org_id, channel, external_thread_id)` to `(provider_account_id, external_thread_id)`. Gmail's `threadId` is per-mailbox; the org-scoped constraint would collapse two users' threads in the same org — STATUS: confirmed.
- **Thread derived columns maintained on row** (`subject`, `last_message_at`, `message_count`). Single-user-scale contention is theoretical; fast reads outweigh — STATUS: confirmed.
- **One `message` table with superset columns** (not per-channel tables). Cross-channel reads (inbox, search, thread fetch) are first-class; per-channel tables would UNION every query and break FK integrity for `attachment`/`message_participant` — STATUS: confirmed.
- **`channel_metadata jsonb` deferred.** Gmail's `normalize()` produces only fields covered by top-level columns. JSONB without concrete need is premature — STATUS: confirmed.
- **`message_participant` ships in REP-50** (not deferred). Adapter writes participants on day one; arrays are the smell that gets ripped out within a ticket otherwise — STATUS: confirmed.
- **Sender dropped from `message`** — `sender_address` and `sender_name` were initially planned as a denormalized cache, then revisited. Single source of truth lives in `message_participant.role='from'`. The inbox-row join was deemed acceptable and removes a write-time consistency obligation between `message` and `message_participant` — STATUS: confirmed.
- **`thread_participant` deferred.** View over `message_participant` covers reads at single-user volume. Add the table when drafts arrive or per-thread per-participant state arrives — STATUS: confirmed.
- **Attachment `bytes bytea NOT NULL`; `storage_path` dropped**. Bytes-in-PG is the only path today; carrying `storage_path NOT NULL` would force REP-14 to invent a fake value for every insert. Future blob-storage migration re-adds `storage_path` (nullable) and flips `bytes` to nullable then — STATUS: confirmed.
- **Contact split (`contact` + `contact_handle`) kept**. One person, many addresses; block-the-person cascades; cross-channel identity forward-compatible — STATUS: confirmed.
- **Contacts scoped per-user-within-org** (`contact.user_id`, `contact_handle.user_id`). No implicit cross-user sharing at the DB level; application can implement explicit sharing later — STATUS: confirmed.
- **`contact_handle` unique re-keyed** from `(contact_id, channel, handle)` to `(user_id, channel, handle)`. Same handle can map to a different contact for a different user — STATUS: confirmed.
- **Contact reconciliation happens downstream of `normalize()`**, not inside it (REP-13 says `normalize()` is pure and synchronous; DB lookup makes it impure). Adapter emits `{handle, display_name, role}` with `contact_id NULL`; reconciler runs later — STATUS: confirmed.

## Key Numbers Generated or Discovered This Session

- Migration timestamp: `1780033705786`.
- Migration file: `apps/server/src/infra/db/migrations/1780033705786_rep-50-message-schema.ts`.
- Migration diff: `+368 / -5` lines (migration + codegen).
- Tests after migration: 302 pass, 0 fail, 386 expect() calls, 38 files, 207ms.
- Codegen change: `+44 / -18` lines in `apps/server/src/infra/db/generated.ts` (most are formatter/whitespace; semantic adds are the new `MessageRaw`/`MessageParticipant`/`Thread.providerAccountId`/`Message.{rawMessageId,inReplyTo,references,messageIdHeader,snippet}`/`Attachment.{userId,bytes,...}` fields).
- Tables after migration: 12 (was 11). Added: `message_participant`. `message_raw` re-created with new shape.
- PR number: #18.
- PR URL: https://github.com/KyleCodes/Repel/pull/18.

## Conditional Logic Established

- IF a future re-normalizer wants to re-derive `message` rows from stored raw without re-fetching, THEN it dispatches on `message_raw.payload_schema` and overwrites the `message` row pointed to by `message.raw_message_id`, BECAUSE the schema deliberately allows raw to outlive any single normalize attempt.
- IF REP-21's migration adds `sync_task` and the FK from `message_raw.sync_task_id`, THEN it must NOT alter the nullability or type of `message_raw.sync_task_id` (already `NOT NULL`), BECAUSE the column was deliberately constrained from day one — no backfill ever.
- IF a non-email channel (SMS, DM) arrives with metadata that doesn't fit the current `message` superset, THEN add `channel_metadata jsonb` as a new column at that point, BECAUSE adding JSONB now is premature schema.
- IF drafts (threads without messages) or per-thread per-participant state (mute, snooze) arrives, THEN add `thread_participant` table at that point. Until then, derive participants from `message_participant` via view.
- IF the adapter's `normalize()` ever needs to populate `message_participant.contact_id`, THEN refactor — `normalize()` is pure and synchronous per REP-13. Reconciliation lives in a downstream worker.

## Files Created or Modified

| File Path                                                                    | Action   | Description                                                                                                                                                                         |
| ---------------------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/server/src/infra/db/migrations/1780033705786_rep-50-message-schema.ts` | Created  | REP-50 migration: drop+recreate `message_raw` as root, delta `message`/`thread`/`attachment`/`contact`/`contact_handle`, create `message_participant`, RLS policies. With `down()`. |
| `apps/server/src/infra/db/generated.ts`                                      | Modified | Auto-regenerated by `repel db codegen` post-migration. New `MessageRaw`, `MessageParticipant` interfaces; deltas on `Message`, `Thread`, `Attachment`, `Contact`, `ContactHandle`.  |
| Linear REP-50 (comment `4195b255-...`)                                       | Created  | Full working plan posted as comment.                                                                                                                                                |
| Linear REP-50 (comment `c88a96bd-...`)                                       | Created  | Implementation summary posted as comment.                                                                                                                                           |
| GitHub PR #18                                                                | Created  | https://github.com/KyleCodes/Repel/pull/18                                                                                                                                          |
| `docs/summaries/handoff-2026-05-29-REP-50-execute.md`                        | Created  | This handoff.                                                                                                                                                                       |

## What the NEXT Session Should Do

The natural next ticket is **REP-13** (abstract `IProviderAdapter` contract). Order from the REP-13 handoff still stands:

1. **First**: REP-13 — implement `IProviderAdapter` types in TypeScript at `apps/server/src/adapters/types.ts` (or `processing-pipeline/types.ts` — settle that open question during implementation). Land the ESLint rule (or convention check) for the features/adapters import barrier per manifesto Rule 6. Write a DR.
2. **Then**: REP-14 — implement `adapters/gmail/` end-to-end. The `NormalizedMessage` type it produces must align with the column set this migration shipped: `(sender_address, sender_name, subject, body_text, body_html, in_reply_to, references[], message_id_header, snippet, external_message_id, external_thread_id, sent_at, received_at)` plus participant records `[{handle, display_name, role}]` for the `message_participant` rows. Stub `send()`.
3. **Then**: REP-22 — wire `repel accounts add gmail` to `gmailAdapter.promptUserAuthorization()`.
4. **Then**: REP-21 — break into sub-tickets. Its migration adds `sync_task` and the FK from `message_raw.sync_task_id`. Confirm it also handles the `sync_event.phase` discriminant alignment with REP-13's `AdapterEvent.phase`.

Reconciler that populates `message_participant.contact_id` is a follow-up ticket after REP-21's runner exists — not yet ticketed.

## Open Questions Requiring User Input

None blocking. PR awaits human merge.

## Assumptions That Need Validation

- **ASSUMED:** No production data exists in `message`, `message_raw`, `thread`, `attachment`, `contact`, `contact_handle`. `NOT NULL` adds with no backfill are safe — validated by reading rep-48 / ADR-013, which made the same claim for `message` and `thread` ("both tables are currently empty"), and by reading the live schema before the migration ran. No data loss observed in the down/up round-trip on the local DB.
- **ASSUMED:** Prettier formatter churn in `apps/server/src/infra/db/generated.ts` (quote style, line wrapping) is acceptable — it has happened on every prior migration in this repo and is part of the existing post-commit hook flow.

## What NOT to Re-Read

- `docs/04-architecture-manifesto.md` — referenced fully this session for Rules 1a, 1b, 2, 6, ADR-002, ADR-013 implications. Don't re-read end-to-end next session.
- `docs/summaries/handoff-2026-05-22-REP-13-plan.md` — fully internalized; the "what to do next" list above supersedes its ordering for REP-50, but everything else remains accurate.
- `apps/server/src/infra/db/migrations/1777002187000_rep-9.ts` — read this session for conventions (RLS policy syntax, FK style, enum sourcing from `@repel/shared`).
- `apps/server/src/infra/db/migrations/1779426926780_rep-48-user-id-message-thread.ts` — read this session as the most recent migration template; conventions match.

## Files to Load Next Session

- `apps/server/src/infra/db/migrations/1780033705786_rep-50-message-schema.ts` — the schema next sessions write code against.
- `apps/server/src/infra/db/generated.ts` — the Kysely `DB` interface (source of truth for inferred types).
- Linear REP-13 — the next ticket.
- `docs/context/adr/ADR-013-user-scoped-feeds-org-rls.md` — already-known but worth re-loading when adapter code starts writing user_id on every insert.
- This handoff.
