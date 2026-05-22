# Session Handoff: REP-20 — accounts provider-account CLI verbs

**Date:** 2026-05-22
**Session Duration:** ~1 session
**Session Focus:** Implement `accounts list/show/rm` + stubbed `accounts add` CLI verbs and the shared CLI resolver plumbing, against the `provider_account` table.
**Context Usage at Handoff:** moderate

## What Was Accomplished

1. Provider-account read/write feature code under `features/accounts/` — three views, one flow, one new error class, four new service methods.
2. Shared CLI plumbing under `cli/lib/` — `resolveOrgId`, `resolveUserId`, `resolveAccount`, `confirm`.
3. Four CLI verbs registered under the existing `accounts` namespace — `list`, `show`, `rm`, `add` (`add` stubbed).
4. Unit tests for all unit-testable units (resolvers, confirm, schemas, handler registration + add stub) — 100% func/line coverage on those.
5. Build clean (`tsc --build`), `bun test` green — 166 tests, 18 files (after removing the stale `dist/`).

## Exact State of Work in Progress

- Implementation + tests complete; working tree dirty (no commits yet — squash will be a single fresh commit).
- Next: handoff committed → squash → push → PR → code review → verifier.
- DB-bound feature code (`views/*`, `flows/deactivate-provider-account.ts`, the 4 `service.ts` methods) has 0% unit coverage by design — verified end-to-end against Postgres, not unit-tested.

## Decisions Made This Session

- **No `account` namespace; verbs go under existing `accounts`** BECAUSE REP-49 (`accounts`→`org` rename) is deferred — user instruction. STATUS: confirmed.
- **`accounts rm` prompts interactively** `[y/N]` on stdin when `--yes`/`-y` absent; EOF/non-TTY → declined BECAUSE the user wants a real prompt (the ticket cited `db nuke`, but `db nuke` hard-errors instead — user considers that a `db nuke` bug). STATUS: confirmed.
- **Credentials base64-encoded in `accounts show`** (not masked, not raw Buffer JSON) BECAUSE developer CLI; base64 is compact and round-trippable. STATUS: confirmed.
- **UUID detection via `z.string().uuid()`** in `resolveAccount` BECAUSE zod already does it. NOTE: zod v4's `.uuid()` is STRICT (validates version + variant nibbles), not the loose 8-4-4-4-12 match assumed during planning. Accepted as-is — Postgres `gen_random_uuid()` emits v4, so every real row passes. STATUS: confirmed.

## Key Numbers Generated or Discovered This Session

- Tests: 166 pass, 0 fail, 18 files (clean run, no `dist/`). A stale `dist/` doubles this to 332 — always `rm -rf apps/server/dist` before `bun test`.
- Coverage: 100% func/line on `resolve-org.ts`, `resolve-user.ts`, `resolve-account.ts`, `confirm.ts`, `cli/accounts/schemas/index.ts`.

## Conditional Logic Established

- IF a `<account>` token parses as a UUID (`z.string().uuid()`) THEN look up by id; ELSE IF it contains `:` and the prefix is a valid `Provider` enum value THEN `provider:externalAccountId` lookup; ELSE treat the whole token as an alias.
- IF `resolveAccount` finds 0 rows THEN throw not-found; IF >1 THEN throw ambiguity error listing every match; IF exactly 1 THEN return it.
- IF `accounts rm` is called without `--yes`/`-y` THEN prompt; IF stdin is EOF/non-TTY THEN treat as declined (abort, exit 0).

## Files Created or Modified

| File Path                                                                  | Action   | Description                                                          |
| -------------------------------------------------------------------------- | -------- | -------------------------------------------------------------------- |
| `apps/server/src/features/accounts/views/list-provider-accounts.ts`        | Created  | RLS-scoped read, `WHERE userId =` (ADR-013 user visibility)          |
| `apps/server/src/features/accounts/views/get-provider-account.ts`          | Created  | Single-row read by id                                                |
| `apps/server/src/features/accounts/views/find-provider-accounts-by-ref.ts` | Created  | Alias or `provider:externalAccountId` lookup; backs `resolveAccount` |
| `apps/server/src/features/accounts/flows/deactivate-provider-account.ts`   | Created  | `UPDATE ... SET is_active=false ... RETURNING`, one statement        |
| `apps/server/src/features/accounts/error.ts`                               | Modified | Added `ProviderAccountNotFoundError extends AccountsServiceError`    |
| `apps/server/src/features/accounts/service.ts`                             | Modified | Added 4 `runInOrgTx` methods                                         |
| `apps/server/src/cli/lib/resolve-org.ts`                                   | Created  | `--org` → `REPEL_ORG_ID` → throw                                     |
| `apps/server/src/cli/lib/resolve-user.ts`                                  | Created  | `--user` → `REPEL_USER_ID` → throw                                   |
| `apps/server/src/cli/lib/resolve-account.ts`                               | Created  | Token classification + dispatch; injectable `deps` for testing       |
| `apps/server/src/cli/lib/confirm.ts`                                       | Created  | One-line stdin prompt; EOF → false                                   |
| `apps/server/src/cli/accounts/schemas/index.ts`                            | Modified | Added 4 `*InputSchema`/`*Input`                                      |
| `apps/server/src/cli/accounts/handler.ts`                                  | Modified | Registered `list/show/rm/add` + 4 `runAccounts*` runners             |
| `apps/server/src/cli/lib/__tests__/*.test.ts`                              | Created  | resolver + confirm unit tests                                        |
| `apps/server/src/cli/accounts/__tests__/handler.test.ts`                   | Created  | registration + add-stub tests                                        |
| `apps/server/src/cli/accounts/schemas/__tests__/index.test.ts`             | Created  | schema parse/default/reject tests                                    |

## What the NEXT Session Should Do

1. **First**: Code review of the PR — see "Concerns for the code reviewer" below.
2. **Then**: End-to-end DB verification — the DB-bound code is unit-untested by design.
3. **Then**: Human PR review + merge. Ticket stays In Progress until merged.

## Open Questions Requiring User Input

- None blocking. (`db nuke` should arguably also prompt — out of scope for REP-20, not yet a Linear ticket.)

## Assumptions That Need Validation

- **ASSUMED:** strict zod v4 `.uuid()` is acceptable for `resolveAccount` token classification — validate by confirming no non-v4 UUIDs ever enter `provider_account.id` (true today: Postgres `gen_random_uuid()` is v4).
- **ASSUMED:** end-to-end run confirms RLS org-scoping + the explicit `WHERE userId =` filter on `listProviderAccounts`, and that a cross-tenant id in `deactivateProviderAccount` yields `ProviderAccountNotFoundError` — validate by the verifier's validation plan.

## Reviewer notes (flagged by backend-engineer)

- No `build` script in `apps/server/package.json`; `typecheck`/`build` live in root `package.json` (`tsc --build`). `tsc --build` emits a gitignored `dist/`; a stale `dist/` makes `bun test` run compiled `.test.js` copies too (doubles the count). `rm -rf apps/server/dist` before `bun test`.
- `AccountAddInputSchema.provider` is typed `string` (zod `z.enum` needs a literal tuple; `Object.values(Provider)` is `string[]`, cast to `[string, ...string[]]`). `runAccountsAdd` only interpolates it into a message — no narrowing lost in practice.
- Kysely table identifier is `'providerAccount'` (camelCase `DB` key; `CamelCasePlugin` rewrites to `provider_account` in SQL) — consistent with existing views.

## What NOT to Re-Read

- `docs/04-architecture-manifesto.md` — already applied; the implementation conforms to Rules 1a, 3, 5.

## Files to Load Next Session

- This handoff — for full state.
- The 15 changed files above — for code review.
