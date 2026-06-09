# ADR-014: Credential Encryption at Rest — App-Side AES-256-GCM

**Date:** 2026-06-08
**Status:** ACCEPTED
**Domain:** data-storage, infrastructure

## Context

`provider_account.credentials_encrypted` (a `bytea` column) holds the secret an adapter needs to act as a connected account — an OAuth token set today, an app password or API key later (ADR-005). These are bearer secrets: whoever holds the plaintext can read the user's mailbox. The column existed before any encryption did; `accounts add gmail` (REP-22) initially wrote plaintext JSON into it as a deliberate temporary measure, and the deployment doc separately proposed DB-side `pgcrypto`. Neither is acceptable as the standing design, and the two contradicted each other.

The deployment target shapes the decision: Repel is self-hosted, intended to run as a single Ubuntu Docker image with as few external dependencies as possible. There is no cloud KMS, no managed secrets service.

The threat model is explicit. Env-var-key encryption-at-rest does **not** defend against a compromised application process (it holds the key) or an operator/engineer with both database and environment access (they can decrypt). It **does** defend against the plausible, high-impact case for an email product: a database-only or backup/snapshot leak where the key was never in the leaked artifact — stolen `pg_dump`, an exposed replica, a mis-ACL'd backup, SQL injection that reads rows but not the filesystem. Decoupling "has the ciphertext" from "has the key" is the entire point; it reduces blast radius, it does not claim to prevent a full-host compromise.

## Decision

Credentials are encrypted **in the application** with **AES-256-GCM** before they reach Postgres, via `apps/server/src/lib/crypto/encryption.ts`. The database only ever stores ciphertext and never sees the key.

- `loadEncryptionKey(): Buffer` — reads `ENCRYPTION_KEY` from the environment as a 64-char hex string, decodes it to 32 raw bytes, and validates the length. Throws `EncryptionKeyError` (in `lib/crypto/error.ts`, an `AppError`) when unset, empty, or the wrong length. Hex (not base64) avoids `+/=` mangling in `.env` files.
- `encrypt(key: Buffer, plaintext: Buffer): Buffer` — generates a fresh random 12-byte IV per call and returns one self-contained blob: `iv(12) || authTag(16) || ciphertext`.
- `decrypt(key: Buffer, blob: Buffer): Buffer` — slices the IV and GCM auth tag, verifies the tag, and decrypts. Throws `DecryptionError` on a wrong key, a tampered/corrupt blob, or one too short to contain IV + tag.

The key is a single 32-byte value injected as the `ENCRYPTION_KEY` env var, the same in every environment, generated with `repel db encryption generate-key` (a guarded CLI verb under the new `db encryption` namespace — warns and prompts like `db nuke`, prints the key to stdout, writes no file). The key lives in the shared, gitignored `.env.development` (distributed privately between developers), never in the ephemeral per-worktree `.env.local`, and never committed; `apps/server/.env.development.example` is the committed template.

The crypto module is bytes-in/bytes-out and key-as-`Buffer`: it does not read the environment itself (callers pass the loaded key) and does not know it is encrypting JSON (the caller serializes). This keeps `loadEncryptionKey` the single seam where the key originates, so a future move to a KMS or secrets manager changes only that function.

GCM (authenticated encryption) is mandatory, not plain AES-CBC: the auth tag makes a tampered ciphertext fail closed (`decrypt` throws) rather than returning corrupted bytes.

## Alternatives Considered

| Option                                                                     | Reason Rejected                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DB-side `pgcrypto` / `pgp_sym_encrypt` (the prior deployment-doc proposal) | Defeats the core goal: the key and plaintext both pass through the Postgres process on every read/write, and can land in query logs / `pg_stat_statements` / error output — exactly the component encryption-at-rest is meant to protect. Also adds a Postgres-extension dependency that must be present and `CREATE EXTENSION`-enabled in the image and in every per-worktree cloned DB, burns DB CPU on a single-box deploy, and cannot be unit-tested without a live database. |
| Plaintext JSON in the column (the REP-22 interim)                          | Any DB or backup leak is immediate, total account takeover of every connected mailbox. Indefensible the moment a second user's tokens are stored; effectively required against by OAuth provider data-handling terms.                                                                                                                                                                                                                                                             |
| Plain AES-CBC (or any unauthenticated mode)                                | No tamper detection; a flipped byte decrypts to garbage silently. GCM's auth tag is the property we want for bearer secrets.                                                                                                                                                                                                                                                                                                                                                      |
| Cloud KMS / managed secrets service for the key                            | No external cloud dependency in the self-hosted single-image target. The `loadEncryptionKey` seam preserves the option later without touching `encrypt`/`decrypt` or any caller.                                                                                                                                                                                                                                                                                                  |
| Per-record data keys / envelope encryption                                 | Unnecessary complexity for the current scale (one app writes these rows, no compliance driver). Revisit if/when key rotation or multi-key isolation is required.                                                                                                                                                                                                                                                                                                                  |
| Salt + KDF on the key                                                      | KDFs are for low-entropy secrets (passwords). The key is already 32 bytes of CSPRNG output; deriving from it adds nothing.                                                                                                                                                                                                                                                                                                                                                        |

## Consequences

### Positive

- The database holds only ciphertext; a DB-only or backup leak yields no usable credentials without the separately-held key.
- Ciphertext is tamper-evident (GCM); a corrupted or altered row fails closed at `decrypt`.
- Zero external dependency — `node:crypto` is built in; nothing to install or enable in the image or per-worktree DBs.
- Crypto runs on app CPU, not the database (the scarcest resource on a single-box deploy).
- Pure, key-as-`Buffer` functions are unit-testable without a database or environment mutation.
- A single seam (`loadEncryptionKey`) localizes "where the key comes from" — a KMS swap is one function.

### Negative / Trade-offs

| Risk                                                                         | Mitigation                                                                                                                                                                                                                       |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| App-process compromise exposes the key                                       | Out of this layer's threat model by design; defense is host/process hardening, not at-rest encryption. Stated explicitly so the protection is not over-claimed.                                                                  |
| Operator with both DB + env access can decrypt                               | Accepted for the single-dev / self-hosted stage. The KMS seam (separate authz + audit for the key) is the future hardening, recorded as a Review Trigger.                                                                        |
| Losing / changing `ENCRYPTION_KEY` orphans every encrypted row (no recovery) | The key is a stable shared secret in `.env.development`, never regenerated after real data exists; `generate-key` warns that a new key does not re-encrypt existing data. Rotation is a deliberate future verb, not an accident. |
| IV reuse under one key would break GCM                                       | `encrypt` always generates a fresh random IV internally; callers cannot supply one.                                                                                                                                              |
| `accounts show` prints decrypted credentials to the terminal                 | The CLI operator is already trusted (they hold the key); it is an inspection aid. A row that will not decrypt throws through the normal CLI error boundary.                                                                      |

## Compliance

- MUST: Bearer credentials persisted to the database MUST be encrypted via `lib/crypto/encryption.ts` (`encrypt`) before the write; the column stores ciphertext only.
- MUST: Encryption MUST be authenticated (AES-256-GCM); a decrypt failure MUST surface as `DecryptionError`, never silently return corrupted bytes.
- MUST: The key MUST be loaded and validated through `loadEncryptionKey` (32 bytes, hex `ENCRYPTION_KEY`); a missing/invalid key MUST fail loudly with `EncryptionKeyError`.
- MUST: `ENCRYPTION_KEY` MUST live in the shared, gitignored `.env.development` (or a real secrets store), never in `.env.local`, and MUST NOT be committed.
- MUST NOT: Credentials be written as plaintext to the database in any environment.
- MUST NOT: DB-side encryption (`pgcrypto`) be used for credential storage.
- SHOULD: New credential-bearing storage reuse `lib/crypto`; the key passes as a `Buffer` from `loadEncryptionKey`, and callers handle serialization.

## Review Trigger

- A second user / any non-solo deployment, or a managed/cloud host — at which point migrate `ENCRYPTION_KEY` behind a KMS or secrets manager (changing only `loadEncryptionKey`) so reading the key and reading the DB become separate authz decisions with separate audit trails.
- A need to rotate the key (suspected compromise, policy) — add a `repel db encryption rotate-key` verb that decrypts-under-old / re-encrypts-under-new across all rows. The `db encryption` namespace exists for this.
- Credentials needing to be queried/compared by the database itself (they cannot be, while the app holds the key) — would force reconsidering app-side vs DB-side.

## Related

- SUPERSEDES: NONE
- RELATED TO: ADR-001 (Postgres), ADR-002 (org-scoped RLS), ADR-005 (provider-account vocabulary), ADR-012 (CLI structure — the `db encryption` namespace)
- REFERENCED BY: NONE
