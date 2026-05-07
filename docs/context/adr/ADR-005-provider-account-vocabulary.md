# ADR-005: Provider Account Vocabulary

**Date:** 2026-04-14
**Status:** ACCEPTED
**Domain:** architecture, extensibility, data-storage

## Context

The product spec commits to a multi-channel inbox (email, SMS, DM, chat rooms) served by many upstream providers. An earlier sketch conflated three distinct concepts under "channel": the communication medium (email, SMS, DM), the upstream service (Gmail, iCloud), and the user's specific instance of a connection. That conflation made it impossible to model a provider that serves multiple channels (e.g. Google Mail vs Google Chat under one corporate identity), forced provider-specific configuration into code constants, and left no clean place for the wire-protocol layer (IMAP, SMTP, JMAP, REST) to live. As we approach implementation of the Gmail and iCloud adapters and the CLI verbs that drive them, we need vocabulary that scales to the future channels named in the product spec without rewriting the data model.

## Decision

Model the connection layer as **three levels in the database** (`channel`, `provider`, `provider_account`) backed by a **TypeScript provider registry** that owns provider behavior, with **protocol implementations as code-only libraries** under `providers/lib/protocols/`.

**Database:**

- `channel` — Postgres enum. The communication medium. Values: `email`, `sms`, `dm`, `chat_room`. Defines the shape of a normalized message.
- `provider` — Postgres enum. A specific upstream service. Values at v1: `gmail`, `icloud`, `generic_imap`. Multi-channel services (e.g. Google Mail vs Google Chat) are modeled as separate provider entries.
- `provider_account` — Table. One row per linked instance: a specific user's specific connection to a specific provider, holding credentials, sync state, and an `external_account_id` identifying the upstream account (Gmail address, Apple ID, IMAP `username@host`).

**TypeScript:**

- A provider registry at `apps/server/src/providers/index.ts` is the source of truth for provider _behavior_: display name, OAuth config, auth method, channel binding, and the adapter implementing `sync()` and `send()`.
- Each provider lives in its own directory: `providers/<provider>/{definition.ts, adapter.ts}`.
- A unit test asserts `Object.keys(providerRegistry)` matches the values of the `provider` enum, preventing drift.

**Protocol layer:**

- Wire/API protocols (IMAP, SMTP, JMAP, Gmail REST) live in `providers/lib/protocols/` as plain libraries. Provider adapters import the protocols they need. Protocols are not represented in the database — adding a protocol is always a code change and gains nothing from being a row.

**Schema:**

```sql
CREATE TYPE channel AS ENUM ('email', 'sms', 'dm', 'chat_room');
CREATE TYPE provider AS ENUM ('gmail', 'icloud', 'generic_imap');
CREATE TYPE auth_method AS ENUM ('oauth2', 'app_password', 'api_key');

CREATE TABLE provider_account (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES org(id),
  user_id uuid NOT NULL REFERENCES "user"(id),

  provider provider NOT NULL,
  channel channel NOT NULL,           -- denormalized from TS provider definition
  auth_method auth_method NOT NULL,   -- denormalized from TS provider definition

  external_account_id text NOT NULL,  -- gmail address, Apple ID, imap user@host
  alias text,                         -- user-supplied: "Work", "Personal"

  credentials_encrypted bytea,
  sync_cursor jsonb,
  last_synced_at timestamptz,
  is_active boolean NOT NULL DEFAULT true,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (org_id, provider, external_account_id)
);
```

`channel` and `auth_method` are denormalized from the TypeScript provider definition onto each row so SQL queries like "list all email accounts" or "list all OAuth-linked accounts" do not need to round-trip through code.

`UNIQUE (org_id, provider, external_account_id)` prevents accidental duplicate links of the same upstream account within an org while permitting two users in the same org to legitimately link a shared account.

`external_account_id` is `NOT NULL`. Rows are inserted only after credential exchange completes — never mid-OAuth-flow.

## Alternatives Considered

| Option                                                                                         | Reason Rejected                                                                                                                                                                                                                                                                                       |
| ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Single `channel` concept conflating medium and provider                                        | Cannot model Google Mail vs Google Chat as distinct integrations under one upstream identity. Forces single-channel thinking into the schema.                                                                                                                                                         |
| Add a fourth level: `protocol` as a database enum or table                                     | Protocols are always implementation details. Adding IMAP support always requires writing an adapter; storing the protocol name in a row gains nothing and pollutes the schema.                                                                                                                        |
| Provider definitions in a database table from day one                                          | Premature flexibility. Self-hosted single-tenant deployment means the operator controls the codebase; provider config in TS is type-safe, version-controlled, and reviewable. Migration to a `provider_definition` table is straightforward later if/when provider plugins become a real requirement. |
| Single `connected_account` row per (user, provider) serving multiple channels via a join table | Over-engineered for v1. Gmail and iCloud are single-channel. When a multi-channel provider (Google Workspace) actually arrives, we can refactor; in the meantime the join would buy nothing.                                                                                                          |
| Free-form `text` column instead of `provider` enum                                             | Loses Kysely type safety. The flexibility is illusory because adding a provider always requires code anyway.                                                                                                                                                                                          |
| Name the instance table `connected_account`                                                    | Verbose without being more precise than `provider_account`, and leaves `provider_*` namespace fragmented.                                                                                                                                                                                             |
| Name the instance table `sync_authorization`                                                   | Narrows the concept to credentials/sync; the row also owns send, label, active flag, and outlives any single sync.                                                                                                                                                                                    |
| Name the instance table `provider_configuration`                                               | Collides with the TypeScript provider definition layer, which is itself "provider configuration."                                                                                                                                                                                                     |

## Consequences

### Positive

- Adding a new provider that uses an existing protocol = new directory under `providers/`, new entry in the registry, one-line enum migration. No pipeline, API, or UI changes.
- Adding a new wire protocol = new file under `providers/lib/protocols/`. Pure code, no migration, no enum churn.
- Multi-channel upstream services model cleanly as multiple provider entries that may incidentally share credentials later via a future `provider_credential` table.
- Multiple linked instances of the same provider per user are first-class (three Gmails, distinguished by `alias` and `external_account_id`).
- SQL UI queries (`is_active = true AND channel = 'email'`) work without joining through TypeScript.
- Compile-time type safety end-to-end via Kysely + the registry parity test.

### Negative / Trade-offs

- Two sources of truth for provider identifiers (Postgres enum + TS registry) require a parity test to stay in sync. Drift is caught at test time, not compile time.
- Denormalizing `channel` and `auth_method` onto `provider_account` means changing a provider's channel binding (rare, possibly never) requires a backfill, not just a TS edit.
- `provider_account` is 16 characters and will appear constantly in code. CLI aliases and short variable names mitigate but don't eliminate the verbosity.
- Adding a provider still requires a one-line enum migration even though the behavior lives in TS. Cannot ship a new provider via TS-only patch.

### Risks

- RISK: TS registry and `provider` enum drift in production if the parity test is skipped or removed | MITIGATION: parity test runs in the standard suite; CI failure blocks merge.
- RISK: `external_account_id` shape varies across providers in ways that complicate dedup or CLI ergonomics (e.g. case-sensitivity, format normalization) | MITIGATION: each provider's `definition.ts` exports a `normalizeExternalAccountId(raw: string): string` function called before insert and lookup.
- RISK: A future provider needs an auth method not in the enum (e.g. `device_code`, `cookie_jar`) | MITIGATION: one-line migration to extend the enum; expected and acceptable.

## Compliance

- MUST: All upstream connections are modeled as `provider_account` rows.
- MUST: Provider behavior (adapter, OAuth config, display name, channel binding, auth method) is defined in `apps/server/src/providers/<provider>/definition.ts` and registered in `apps/server/src/providers/index.ts`.
- MUST: Wire protocols (IMAP, SMTP, JMAP, REST clients) live in `apps/server/src/providers/lib/protocols/` and are imported by provider adapters. Protocols MUST NOT be referenced in the database schema.
- MUST: A unit test asserts that `Object.keys(providerRegistry)` matches the values of the `provider` Postgres enum.
- MUST: `provider_account` rows are inserted only after credential exchange completes; `external_account_id` is `NOT NULL`.
- MUST: Pipeline, API, and UI code operate on `channel`-agnostic normalized messages; they MUST NOT import from `providers/<provider>/` directly.
- MUST NOT: Add channel-specific or provider-specific columns to the normalized `message` table. Provider-specific data belongs in `message_raw` or in derived-fact tables (covered by a forthcoming ADR).
- MUST NOT: Introduce a `protocol` enum or table.
- SHOULD: Use the table name `provider_account` in code and CLI verbs, possibly aliased to `account` in CLI surface for ergonomics.

## Review Trigger

Revisit this ADR if any of the following occur:

- A real multi-channel provider (one upstream credential serving two distinct channels) ships and the duplicate-credential tax becomes painful — at which point a `provider_credential` sibling table is the natural extension.
- Provider plugins from third parties become a product requirement — at which point the registry moves from TS to a `provider_definition` table.
- The `channel` enum needs a value whose normalized message shape is fundamentally incompatible with the existing `message` schema (e.g. a channel with no concept of sender/recipient).

## Related

- SUPERSEDES: NONE
- RELATED TO: ADR-001, ADR-002, ADR-009
- REFERENCED BY: NONE
