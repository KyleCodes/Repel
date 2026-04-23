# SQL Relational Structure

## Design Principles

- Surrogate UUID primary keys on all tables.
- `org_id` denormalized onto every table queried directly from the API or processing layer for row-level security (RLS).
- Tables only accessed via join (e.g., `message_raw`, `contact_handle`) omit `org_id` — isolation is inherited from the parent.
- `created_at` and `updated_at` timestamps on all mutable tables.
- Enums for constrained values (`channel`, `provider`, `auth_method`).
- JSONB for polymorphic/provider-specific data (`sync_cursor`, `payload`).

## Row-Level Security

Every tenant-scoped table has RLS enabled. Policies filter on `org_id` matched against a session variable set at the start of every transaction:

```sql
SET LOCAL app.current_org_id = '<uuid>';
```

```sql
ALTER TABLE <table> ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON <table>
  USING (org_id = current_setting('app.current_org_id')::uuid);
```

Per ADR-010 (rewritten 2026-04-18), `app.current_org_id` is set inside the `runInOrgTx` decorator using `SET LOCAL`, so the value is scoped to the transaction and auto-cleared on commit or rollback. Application code never calls `SET` directly.

## Layer 1: Tenancy

```sql
CREATE TABLE org (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE "user" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES org(id),
  email text NOT NULL,
  name text,
  role text NOT NULL DEFAULT 'admin' CHECK (role IN ('admin', 'member', 'viewer')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (org_id, email)
);
```

Every user belongs to an org. B2C users are the sole member of their org. The `role` column exists for future B2B use — no enforcement logic is built initially.

`UNIQUE (org_id, email)` rather than a global `UNIQUE (email)` — the same person can legitimately be a user in multiple orgs (B2B operator + their own personal org).

## Layer 2: Provider Accounts

Per ADR-005:

```sql
CREATE TYPE channel AS ENUM ('email', 'sms', 'dm', 'chat_room');
CREATE TYPE provider AS ENUM ('gmail', 'icloud', 'generic_imap');
CREATE TYPE auth_method AS ENUM ('oauth2', 'app_password', 'api_key');

CREATE TABLE provider_account (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES org(id),
  user_id uuid NOT NULL REFERENCES "user"(id),

  provider provider NOT NULL,
  channel channel NOT NULL,           -- denormalized from the TS provider definition
  auth_method auth_method NOT NULL,   -- denormalized from the TS provider definition

  external_account_id text NOT NULL,  -- gmail address, Apple ID, IMAP user@host
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

`sync_cursor` is JSONB because its shape varies by provider: Gmail stores `{ "historyId": "..." }`, IMAP stores `{ "uidvalidity": ..., "last_uid": ... }`.

`credentials_encrypted` holds a JSON blob encrypted with `pgp_sym_encrypt` in production, plaintext in development. Shape varies by `auth_method`.

## Layer 3: Threads and Messages

```sql
CREATE TABLE thread (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES org(id),
  channel channel NOT NULL,
  external_thread_id text,
  subject text,
  last_message_at timestamptz,
  message_count int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (org_id, channel, external_thread_id)
);

CREATE TABLE message (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES org(id),
  thread_id uuid REFERENCES thread(id),
  provider_account_id uuid NOT NULL REFERENCES provider_account(id),
  channel channel NOT NULL,

  external_message_id text NOT NULL,

  sender_address text NOT NULL,
  sender_name text,
  recipient_addresses text[] NOT NULL DEFAULT '{}',
  cc_addresses text[] DEFAULT '{}',
  bcc_addresses text[] DEFAULT '{}',

  subject text,
  body_text text,
  body_html text,

  direction text NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  sent_at timestamptz NOT NULL,
  received_at timestamptz,

  is_read boolean NOT NULL DEFAULT false,
  is_starred boolean NOT NULL DEFAULT false,
  is_archived boolean NOT NULL DEFAULT false,
  is_deleted boolean NOT NULL DEFAULT false,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (provider_account_id, external_message_id)
);

CREATE TABLE message_raw (
  message_id uuid PRIMARY KEY REFERENCES message(id),
  payload jsonb NOT NULL,
  content_type text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
```

`message` contains normalized, channel-agnostic fields. `body_text` is used for LLM processing, `body_html` for frontend rendering. Both are nullable because some channels only provide one format.

`message_raw` stores the original provider payload. Separated from `message` to keep the hot table lean. No `org_id` — accessed only via join from `message`.

`cc_addresses` and `bcc_addresses` are email-specific but stored as empty arrays for other channels rather than split into a channel-specific metadata table.

Thread scoping: threads belong to a single channel. Cross-channel threading (email conversation continues on Slack) is out of scope.

## Layer 4: Derived Data (AI Outputs)

**Deferred.** All per-feature derived-fact tables (`message_classification`, `message_summary`, `message_importance`, `message_tag`, `draft_reply`, `classifier_config`) have been removed from v0. Sync, raw storage, and processing-pipeline scaffolding land first; the derived-fact model is revisited once we have a real message corpus to design against.

See [`docs/design_ideas/derived-fact-model.md`](design_ideas/derived-fact-model.md) for the design space and open questions.

## Layer 5: Contacts

```sql
CREATE TABLE contact (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES org(id),
  name text,
  is_blocked boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE contact_handle (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id uuid NOT NULL REFERENCES contact(id),
  channel channel NOT NULL,
  handle text NOT NULL,
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (contact_id, channel, handle)
);
```

A `contact` is a person identity scoped to an org. A `contact_handle` is a channel-specific identifier (email address, phone number, username). One contact can have multiple handles across channels, enabling cross-channel identity resolution.

`contact_handle` has no `org_id` — isolation is inherited via `contact_id`. The unique constraint is `(contact_id, channel, handle)` so the same handle can legitimately appear on multiple contacts (and across orgs).

## Layer 6: Attachments

```sql
CREATE TABLE attachment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES org(id),
  message_id uuid NOT NULL REFERENCES message(id),
  filename text NOT NULL,
  content_type text,
  size_bytes bigint,
  storage_path text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
```

`storage_path` is relative to `BLOB_STORAGE_ROOT`. File layout: `{org_id}/{message_id}/{filename}`. The table stores metadata; the filesystem stores bytes.

## Layer 7: Processing Queue

```sql
CREATE TABLE job_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  queue text NOT NULL DEFAULT 'default',
  payload jsonb NOT NULL,
  dedup_key text,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'dead')),
  attempts int NOT NULL DEFAULT 0,
  max_attempts int NOT NULL DEFAULT 3,
  last_error text,
  locked_at timestamptz,
  locked_by text,
  scheduled_for timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_job_queue_poll
  ON job_queue (queue, scheduled_for)
  WHERE status = 'pending';

CREATE UNIQUE INDEX idx_job_queue_dedup
  ON job_queue (queue, dedup_key)
  WHERE status IN ('pending', 'processing') AND dedup_key IS NOT NULL;
```

Worker dequeue query:

```sql
UPDATE job_queue
SET status = 'processing', locked_at = now(), locked_by = $1, attempts = attempts + 1
WHERE id = (
  SELECT id FROM job_queue
  WHERE queue = $2 AND status = 'pending' AND scheduled_for <= now()
  ORDER BY scheduled_for
  LIMIT 1
  FOR UPDATE SKIP LOCKED
)
RETURNING *;
```

Transactional enqueueing: insert into `job_queue` in the same transaction as the `message` insert during ingress, guaranteeing no message is ingested without a corresponding processing job.

`dedup_key` is an optional caller-supplied key used to prevent duplicate enqueues. The partial unique index `idx_job_queue_dedup` enforces uniqueness only over `(queue, dedup_key)` while a job is still `pending` or `processing` — once a job completes (or fails into a terminal state), a new job with the same key may be enqueued.

`job_queue` is not directly tenant-scoped. RLS is enabled with `USING (true)` (permissive) at v0; tenancy of a job is carried in `payload`. Worker isolation uses application-layer enforcement when reading the payload.

## Layer 8: Reference Vertical (`acme`)

```sql
CREATE TABLE acme (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES org(id),
  note text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
```

`acme` is a **reference vertical** — it exists to demonstrate the canonical shape of a tenant-scoped bounded context against the rewritten primitives (ADR-009 amendment 2026-04-18, ADR-010 rewrite 2026-04-18). It has no dependents and stores no production data. The matching code lives at `apps/server/src/core/acme/`.

Both this table and `core/acme/` are deleted in a future ticket once a real Repel vertical is well-exercised enough to serve as the in-tree reference.

## Indexes (Beyond PKs and Uniques)

```sql
-- message queries by org, time, account, channel
CREATE INDEX idx_message_org_sent ON message (org_id, sent_at DESC);
CREATE INDEX idx_message_account ON message (provider_account_id, sent_at DESC);
CREATE INDEX idx_message_thread ON message (thread_id, sent_at ASC);

-- contact handle resolution
CREATE INDEX idx_contact_handle_lookup ON contact_handle (channel, handle);

-- thread listing
CREATE INDEX idx_thread_org_last ON thread (org_id, last_message_at DESC);
```
