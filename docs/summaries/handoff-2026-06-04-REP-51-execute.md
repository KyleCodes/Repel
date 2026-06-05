# Session Handoff: REP-51 Gmail adapter — interactive OAuth (promptUserAuthorization)

**Date:** 2026-06-04
**Session Duration:** ~1 session
**Session Focus:** Implement the Gmail adapter's interactive OAuth flow + adapter skeleton (REP-51, child 1 of REP-14).
**Context Usage at Handoff:** moderate

## What Was Accomplished

Implemented REP-51 end-to-end via TDD. Hand-rolled OAuth 2.1 authorization-code + PKCE (S256) loopback
flow against Google — no `google-auth-library`. Native `fetch` + `node:crypto` + `node:http`. Built
three layers bottom-up:

1. Generic typed fetch client → `apps/server/src/adapters/lib/http/{client,error}.ts`
2. Provider-agnostic OAuth2 lib → `apps/server/src/adapters/lib/oauth2/{pkce,types,flow,loopback,error}.ts`
3. Gmail adapter → `apps/server/src/adapters/gmail/{index,auth,oauth,profile,types,error}.ts` + `egress/send.ts`
4. Barrel wiring → `apps/server/src/adapters/index.ts` re-exports `gmailAdapter` + `gmailCapabilities`
5. Env template → `apps/server/.env.development` gains empty `REPEL_GMAIL_CLIENT_ID=` / `REPEL_GMAIL_CLIENT_SECRET=`

## Exact State of Work in Progress

Complete. All gates green. Branch has 3 WIP commits to be squashed by the orchestrator before PR.
`promptUserAuthorization` real round-trip is manual-verification only (needs REP-14 Google Cloud setup

- real `.env.local` credentials + human consent).

## Decisions Made This Session

- **Hand-rolled OAuth, no SDK** BECAUSE `google-auth-library` is the heaviest dep in the tree (~2-3MB
  - transitive), the CLI eager-imports all handlers (would tax every command's cold start), and the
    token lifecycle is three `fetch` POSTs. Matches REP-14's "hand-rolled REST client, native fetch" rule. — confirmed
- **Three-layer split** (`lib/http` generic client / `lib/oauth2` provider-agnostic protocol /
  `gmail/` provider config) BECAUSE the fetch client and OAuth2 flow are reusable by child 2's
  `ingest()` and a future iCloud adapter; gmail/oauth.ts is config-only. — confirmed
- **Loopback runner lives in `lib/oauth2`, not `gmail/auth.ts`** BECAUSE it's RFC 8252 OAuth machinery,
  provider-agnostic; `handleRedirect` is extracted as a pure function for testability. — confirmed
- **`runLoopbackFlow` returns `redirectUri`; caller rebuilds config with it** BECAUSE the ephemeral
  port is only known after `listen`, and the auth-URL redirect_uri must byte-match the exchange
  redirect_uri (Google rejects mismatches). — confirmed
- **ZodError propagates raw** (no HttpSchemaError wrapper) BECAUSE a contract violation is distinct
  from transport failure and never retried. — confirmed
- **Scope = `gmail.readonly` only** — corrected mid-session (see Key Numbers / the in-flight fix).
- **`composeAuthorization` internal pure fn extracted** in `gmail/auth.ts` so exchange+profile+
  lowercasing+shape is testable with stubs without real Google. Public `promptUserAuthorization`
  signature unchanged. — confirmed (reported deviation)

## Key Numbers Generated or Discovered This Session

- Tests: **432 pass / 0 fail** (664 expect() calls, 60 files). Baseline before this ticket: 151 pass / 19 files. Net +281 tests / +41 files.
- Files changed: 27 (1664 insertions, 3 deletions).
- Coverage: 100% lines on all pure modules (http client/error, oauth2 pkce/flow/types/error, gmail
  oauth/profile/types/index/error, egress/send, adapters/index). Below 100%: `lib/oauth2/loopback.ts`
  88.33% (uncovered: `realOpenBrowser` spawn, `server.on('error')` bind-failure, address null-guard —
  all I/O boundaries), `gmail/auth.ts` 42.86% (uncovered: `promptUserAuthorization` composition root —
  manual-only; the extracted `composeAuthorization` core is 100%).
- Loopback listener timeout: `LOOPBACK_TIMEOUT_MS = 120_000` (value-asserted, not waited on in tests).
- PKCE verifier: 32 random bytes → 43-char base64url; challenge = base64url(sha256(verifier)).

## Conditional Logic Established

- IF Google omits `access_type=offline` + `prompt=consent` THEN no refresh_token is returned — both are
  set in `loadGmailOAuthConfig`'s `extraAuthParams`.
- IF a token/profile response is non-2xx THEN `HttpResponseError` (status/url/body); IF `fetch` throws
  a TypeError THEN `HttpNetworkError` (.cause); IF the response body fails the zod schema THEN raw
  `ZodError` propagates.
- IF the OAuth `state` echoed back ≠ the generated state THEN `handleRedirect` returns
  `state_mismatch` and the flow rejects with `OAuth2StateMismatchError`, returning no credentials.

## Files Created or Modified

| File Path                                         | Action   | Description                                                                                                         |
| ------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------- |
| `apps/server/src/adapters/lib/http/client.ts`     | Created  | Typed fetch client, overloaded on optional zod schema; form/json encoding; fetchImpl seam; retry deferred (comment) |
| `apps/server/src/adapters/lib/http/error.ts`      | Created  | `HttpError`/`HttpResponseError`/`HttpNetworkError` extending `AppError`                                             |
| `apps/server/src/adapters/lib/oauth2/pkce.ts`     | Created  | `generatePkce` (S256), `generateState` via node:crypto                                                              |
| `apps/server/src/adapters/lib/oauth2/types.ts`    | Created  | `OAuth2Config`, `TokenSet`                                                                                          |
| `apps/server/src/adapters/lib/oauth2/flow.ts`     | Created  | `buildAuthUrl` (pure), `exchangeCode`, `refreshTokens`                                                              |
| `apps/server/src/adapters/lib/oauth2/loopback.ts` | Created  | `handleRedirect` (pure), `runLoopbackFlow` (impure, 127.0.0.1:0, 120s timeout)                                      |
| `apps/server/src/adapters/lib/oauth2/error.ts`    | Created  | `OAuth2Error` + State/Timeout/Denied subclasses                                                                     |
| `apps/server/src/adapters/gmail/oauth.ts`         | Created  | Gmail endpoints + `GMAIL_SCOPES` (gmail.readonly) + `loadGmailOAuthConfig` (env throw-if-missing)                   |
| `apps/server/src/adapters/gmail/profile.ts`       | Created  | `getGmailProfile` (users.getProfile, Bearer, zod)                                                                   |
| `apps/server/src/adapters/gmail/auth.ts`          | Created  | `promptUserAuthorization` composition root + internal `composeAuthorization`                                        |
| `apps/server/src/adapters/gmail/types.ts`         | Created  | `GmailCredentials = TokenSet`, `GmailProfileSchema`/`GmailProfile`                                                  |
| `apps/server/src/adapters/gmail/egress/send.ts`   | Created  | `send` throwing stub                                                                                                |
| `apps/server/src/adapters/gmail/error.ts`         | Created  | `GmailAdapterError` + `GmailNotImplementedError`                                                                    |
| `apps/server/src/adapters/gmail/index.ts`         | Created  | `gmailCapabilities` + `gmailAdapter` (real auth, stub ingest/normalize/send)                                        |
| `apps/server/src/adapters/index.ts`               | Modified | Re-export gmail adapter from the barrel                                                                             |
| `apps/server/.env.development`                    | Modified | Empty `REPEL_GMAIL_CLIENT_ID`/`_SECRET` template keys                                                               |
| `apps/server/src/adapters/**/__tests__/*.test.ts` | Created  | 13 test files covering pure logic + injected-fetch/openBrowser seams                                                |

## What the NEXT Session Should Do

1. **First**: Human reviews + merges the PR (ticket stays In Progress until merged — never auto-Done).
2. **Then**: Do the REP-14 Google Cloud developer-once setup (Desktop OAuth client, Gmail API enabled,
   consent screen In Production, test user added) and put real `REPEL_GMAIL_CLIENT_ID`/`_SECRET` in
   `apps/server/.env.local`. Manually verify `promptUserAuthorization` end-to-end against a real Gmail
   test account (browser opens → consent → 127.0.0.1 redirect → ProviderAuthorization with access +
   refresh tokens + lowercased email).
3. **Then**: Start REP-52 (child 2: `ingest` + `normalize`, capped full sync) — it consumes
   `refreshTokens` (defined here, not yet called) and the same http client.

## Open Questions Requiring User Input

- **OPEN:** None blocking. The real-Gmail manual verification is pending the Google Cloud setup, which
  is the user's to perform.

## Assumptions That Need Validation

- **ASSUMED:** `gmail.readonly` alone authorizes `users.getProfile` to resolve the authenticated
  address — validate during the manual end-to-end (research brief supports it; confirm against the
  live API).
- **ASSUMED:** Google "Desktop app" client accepts the loopback `127.0.0.1:<ephemeral>` redirect with
  no pre-registered port — validate during manual verification.

## Out of Scope (deferred)

`ingest`/`normalize` (REP-52), incremental/range sync (child 3), REP-27 public callback route, REP-22
CLI, functional `send()`, retry/backoff implementation (seam + comment only), `AuthExpiredError`
(lands with child 2's first refresh throw site).
