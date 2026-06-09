# Session Handoff: REP-22 — review round 2 (PR #21 feedback)

**Date:** 2026-06-06
**Session Duration:** ~1 session
**Session Focus:** Address the 19 inline + 2 summary review comments left on PR #21; defer encryption and the Kysely-input-inference convention change to an end-of-PR spike.
**Context Usage at Handoff:** moderate
**Supersedes:** `docs/archive/handoffs/handoff-2026-06-05-REP-22-execute.md` (round 1).

## What Was Accomplished

All gates green after the changes: `bun run typecheck` · `bun run build` · `bun run lint` · `bun test` (534 pass / 0 fail).

1. **Removed the DR file** `docs/summaries/decision-REP-27-1-auth-contract-shape.md` — it belongs to the REP-27 worktree; was only copied in as planning context.
2. **`infra/db/errors.ts` → `infra/db/error.ts` (class-based).** Replaced the bare `isUniqueViolation` bool with `DBError extends AppError`, `DBUniqueViolationError extends DBError` (carries `.constraint`), and an `asUniqueViolation(err): DBUniqueViolationError | undefined` translator. Test renamed → `__tests__/error.test.ts`.
3. **`adapters/types.ts`** — dropped `capabilities.authMethod`; made `ProviderAuth` a real union (`OAuth2Auth | AppPasswordAuth | ApiKeyAuth`, the latter two single-step `authorize` stubs); renamed the OAuth primitives `begin`/`complete` → `authorize`/`exchange` (and `OAuthBegin`/`OAuthCompleteInput` → `OAuthAuthorize`/`OAuthExchangeInput`); removed the flagged comment.
4. **Renamed `begin`/`complete` → `authorize`/`exchange`** in `adapters/gmail/auth.ts` and the `runLoopbackFlow` composition (`adapters/lib/oauth2/loopback.ts`).
5. **Renamed `getProviderAdapter` → `resolveProviderAdapter`** and **`UnknownProviderError` → `ProviderNotFoundError`** (`adapters/registry.ts`, `adapters/error.ts`, `adapters/index.ts` barrel, `cli/accounts/handler.ts`, tests).
6. **`features/accounts/service.ts`** — duplicate detection now uses `asUniqueViolation(e)?.constraint === '<name>'`.
7. **`mutations/add-provider-account.ts`** — `.values(input)` directly (no field-by-field reshape).
8. **`cli/accounts/schemas/index.ts`** — `provider` now infers as `ProviderSlug` via a typed `PROVIDER_VALUES` tuple; the boundary cast lives here once.
9. **`cli/accounts/handler.ts`** — removed the `as ProviderSlug` cast (schema now types it); the non-oauth2 guard throws `UnsupportedAuthMethodError` (new `cli/accounts/error.ts`, `AppError`-rooted) instead of a plain `Error`. **Kept the `AccountsAddDeps` DI seam** (user-confirmed: the three injected functions are module imports that `spyOn` can't reach cleanly; the seam is justified).

## Decisions Made This Session

- **Drop `capabilities.authMethod`** — nothing read it at runtime (handler narrows on `auth.method`; persistence reads `authorization.authMethod`). Deviates from DR-REP-27-1's "three sites must agree" → now two sites. REP-27 owns the DR; note it there when that work resumes. STATUS: confirmed.
- **`authorize`/`exchange` naming** — verified against OAuth 2.1: the phases are the "Authorization Request" (§4.1.1) and "Token Request" (§3.2.2, the code→token exchange). `authorize`/`exchange` are the conventional verb forms. STATUS: confirmed.
- **Mutation input inference → DEFERRED.** The manifesto (§4 line 89) currently sanctions hand-written input types; switching to `Insertable<…>` is a convention change. Do it with the encryption spike, updating the manifesto + `bootstrap.ts`/`deactivate`/`add-provider-account.ts` together. STATUS: deferred.
- **Keep the DI seam** if `spyOn` is uglier — it is. STATUS: confirmed.
- **No PR comment replies** — the comments are the user's own. STATUS: confirmed.

## No-code-change items (answered, not actioned)

- **tx finally/close** — not needed; `getDb().transaction().execute(cb)` auto-commits on clean return, auto-rolls-back on any throw (incl. rethrown domain errors). Verified `infra/db/tx.ts:58-67`.
- **duplicate-translation as a universal pattern** — no; it's specific to constraint-hitting writes.
- **split handler into sub-handlers** — not warranted (4 flat verbs, no sub-namespace).

## Key Numbers / Facts

- Unique constraint name (unchanged from round 1, still load-bearing): `provider_account_uniq_org_id_provider_external_account_id`.
- Test suite: 534 pass / 0 fail, 70 files.
- Diff vs round-1 commit: ~22 files, +327 / -389.

## Files Created or Modified

| File Path                                                             | Action              | Description                                            |
| --------------------------------------------------------------------- | ------------------- | ------------------------------------------------------ |
| `apps/server/src/infra/db/error.ts`                                   | Renamed + rewritten | `DBError`/`DBUniqueViolationError`/`asUniqueViolation` |
| `apps/server/src/infra/db/__tests__/error.test.ts`                    | Renamed + rewritten | class-based tests                                      |
| `apps/server/src/cli/accounts/error.ts`                               | Created             | `AccountsCliError`/`UnsupportedAuthMethodError`        |
| `apps/server/src/adapters/types.ts`                                   | Modified            | drop authMethod; union; authorize/exchange             |
| `apps/server/src/adapters/gmail/{auth,index}.ts`                      | Modified            | authorize/exchange; drop capabilities.authMethod       |
| `apps/server/src/adapters/lib/oauth2/loopback.ts`                     | Modified            | authorize/exchange composition                         |
| `apps/server/src/adapters/{registry,error,index}.ts`                  | Modified            | resolveProviderAdapter / ProviderNotFoundError         |
| `apps/server/src/features/accounts/service.ts`                        | Modified            | asUniqueViolation translation                          |
| `apps/server/src/features/accounts/mutations/add-provider-account.ts` | Modified            | `.values(input)` directly                              |
| `apps/server/src/cli/accounts/{handler,schemas/index}.ts`             | Modified            | no cast; ProviderSlug schema; AppError guard           |
| co-located `__tests__` for the above                                  | Modified            | renames + dropped-field assertions                     |
| `docs/summaries/decision-REP-27-1-auth-contract-shape.md`             | Deleted             | belongs to REP-27 worktree                             |

## What the NEXT Session Should Do

1. **First**: amend round 2 into the existing REP-22 commit (one-commit-per-ticket), push, confirm PR #21 updates. No new PR.
2. **Then (deferred, end-of-PR, same commit, before first real account connection):**
   - **Encryption (Phase F)** — `lib/crypto.ts` (AES-256-GCM, `ENCRYPTION_KEY`) + test; swap the handler's `Buffer.from(JSON.stringify(...))` → `encrypt(...)`; fill `.env.local`.
   - **Kysely input-inference spike** — migrate mutation inputs to `Insertable<…>`; update `docs/04-architecture-manifesto.md` §4 line 89; migrate `bootstrap.ts`/`deactivate`.
3. **Validation**: confirm the live constraint name (`SELECT conname FROM pg_constraint WHERE conrelid='provider_account'::regclass AND contype='u';`) before connecting a real account.

## Open Questions Requiring User Input

- **OPEN:** When to schedule the deferred encryption + inference spike — same PR before merge (current plan), or split out. Needs user direction at the time.

## Assumptions That Need Validation

- **ASSUMED:** live constraint name matches `provider_account_uniq_org_id_provider_external_account_id` (verified against node-pg-migrate source; no live DB this session).

## Files to Load Next Session

- `/Users/kylemuldoon/.claude/plans/ignore-the-preflight-let-s-magical-koala.md` — Deferred section (Phase F + inference spike).
- `apps/server/src/cli/accounts/handler.ts` — the one-line encryption swap point.
