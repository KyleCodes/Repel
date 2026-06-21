# DR-REP-55-1 — Reconstruct in-memory GmailCredentials from stored bare TokenSet

**Status:** Accepted
**Date:** 2026-06-20
**Ticket:** REP-55

## Context

`gmailAdapter.ingest()` requires `credentials: GmailCredentials`, where
`GmailCredentials = { provider: 'gmail'; tokens: TokenSet }`.

What is persisted at rest in `provider_account.credentials_encrypted` is a **bare
`TokenSet`** — the connect path stores `JSON.stringify(authorization.credentials)`
where that value is the raw token set. The `provider: 'gmail'` discriminant is an
in-memory-only tag; it is not stored. (Confirmed via `accounts/handler.ts` connect
path and `gmail/types.ts`.)

So decrypting and parsing the stored blob yields a `TokenSet`, not a
`GmailCredentials`. The runner must bridge the gap.

## Decision

In `runSyncRun`, after decrypting:

```ts
const tokens: TokenSet = JSON.parse(
  decrypt(loadEncryptionKey(), account.credentialsEncrypted).toString('utf8')
);
const credentials: GmailCredentials = { provider: 'gmail', tokens };
```

The `provider` discriminant is stamped from the literal `'gmail'` (the runner is
v0 Gmail-only). When more providers exist, derive it from `account.provider`.

A `null` `credentialsEncrypted` is a typed error (`AccountCredentialsMissingError`)
— an account with no stored credentials cannot be synced.

The reconstructed `credentials` are carried on the `ingestInput` the CLI hands
to the sync handler via `deps.resolveTaskContext` (see DR-REP-55-2). The handler
never sees the stored blob or the encryption key — credential reconstruction is a
CLI/consumer concern, and the serializable `SyncJob` stays secret-free.

## Consequences

- The CLI (consumer) owns the stored-shape → runtime-shape bridge. If the stored
  shape ever becomes a full `GmailCredentials`, this stamping becomes redundant
  and should be removed.
- No validation of the parsed `TokenSet` shape beyond `JSON.parse` — a malformed
  blob surfaces as a parse error at the CLI boundary. Acceptable for a POC; a
  zod-validated parse is a follow-up if this graduates past POC.

## Open items (not yet tickets)

- The stored-vs-runtime credential shape mismatch is a latent footgun for every
  future adapter. When the durable sync platform (REP-23) lands, consider storing
  the tagged `ProviderCredentials` directly so adapters need no reconstruction.
