# SQL Relational Structure

## Design Principles

- Surrogate UUID primary keys on all tables.
- `org_id` denormalized onto every table queried directly from the API layer for row-level security (RLS).
- Tables only accessed via join (e.g., `message_raw`) omit `org_id` — isolation is inherited from the parent.
- `created_at` and `updated_at` timestamps on all mutable tables.
- Enums for constrained values (`channel`, `provider`, `auth_method`).
- JSONB for polymorphic/provider-specific data (`sync_cursor`, `payload`).

## Row-Level Security

Every tenant-scoped table has RLS enabled. Policies filter on `org_id` matched against a session variable set at connection checkout:

```sql
SET app.current_org_id = '<uuid>';
```

```sql
ALTER TABLE <table> ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON <table>
  USING (org_id = current_setting('app.current_org_id')::uuid);
```

The application sets `app.current_org_id` on every connection acquired from the pool, before executing any queries.

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
  email text NOT NULL UNIQUE,
  name text,
  role text NOT NULL DEFAULT 'admin' CHECK (role IN ('admin', 'member', 'viewer')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
```

Every user belongs to an org. B2C users are the sole member of their org. The `role` column exists for future B2B use — no enforcement logic is built initially.

## Layer 2: Connected Accounts

```sql
CREATE TYPE channel AS ENUM ('email', 'sms', 'linkedin', 'imessage', 'slack', 'discord', 'whatsapp');
CREATE TYPE provider AS ENUM ('gmail', 'icloud', 'outlook', 'linkedin', 'imessage');
CREATE TYPE auth_method AS ENUM ('oauth2', 'app_password', 'api_key');

CREATE TABLE connected_account (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES org(id),
  user_id uuid NOT NULL REFERENCES "user"(id),
  channel channel NOT NULL,
  provider provider NOT NULL,
  auth_method auth_method NOT NULL,
  label text,

  credentials_encrypted bytea,

  sync_cursor jsonb,
  last_synced_at timestamptz,
  is_active boolean NOT NULL DEFAULT true,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
```

`org_id` is denormalized from `user` for direct RLS and simpler queries.

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
  connected_account_id uuid NOT NULL REFERENCES connected_account(id),
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

  UNIQUE (connected_account_id, external_message_id)
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

```sql
CREATE TABLE message_classification (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES org(id),
  message_id uuid NOT NULL REFERENCES message(id),
  category text NOT NULL,
  subcategory text,
  confidence float,
  classifier_version text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE message_tag (
  message_id uuid NOT NULL REFERENCES message(id),
  org_id uuid NOT NULL REFERENCES org(id),
  tag text NOT NULL,
  source text NOT NULL DEFAULT 'auto' CHECK (source IN ('auto', 'manual')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, tag)
);

CREATE TABLE message_summary (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES org(id),
  message_id uuid NOT NULL REFERENCES message(id),
  summary text NOT NULL,
  model text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE draft_reply (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES org(id),
  message_id uuid NOT NULL REFERENCES message(id),
  body_text text NOT NULL,
  body_html text,
  model text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'discarded')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE message_importance (
  message_id uuid PRIMARY KEY REFERENCES message(id),
  org_id uuid NOT NULL REFERENCES org(id),
  score float NOT NULL,
  reasoning text,
  model text,
  created_at timestamptz NOT NULL DEFAULT now()
);
```

All derived data tables carry `org_id` for direct RLS queries. Classification history is preserved — reclassifying with a new `classifier_version` inserts new rows, it does not update in place.

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

  UNIQUE (channel, handle)
);
```

A `contact` is a person identity scoped to an org. A `contact_handle` is a channel-specific identifier (email address, phone number, username). One contact can have multiple handles across channels, enabling cross-channel identity resolution.

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

## Layer 8: Classifier Configuration

```sql
CREATE TABLE classifier_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES org(id),
  version text NOT NULL,
  prompt_markdown text NOT NULL,
  is_active boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (org_id, version)
);
```

The active classifier config for an org is the row where `is_active = true`. Only one row per org should be active at a time (enforced at the application layer or via a partial unique index). The `prompt_markdown` field contains the human-readable prompt that defines categories, tags, and filtering criteria.

## Indexes (Beyond PKs and Uniques)

```sql
-- message queries by org, time, account, channel
CREATE INDEX idx_message_org_sent ON message (org_id, sent_at DESC);
CREATE INDEX idx_message_account ON message (connected_account_id, sent_at DESC);
CREATE INDEX idx_message_thread ON message (thread_id, sent_at ASC);

-- classification lookups
CREATE INDEX idx_classification_message ON message_classification (message_id);
CREATE INDEX idx_classification_category ON message_classification (org_id, category);

-- tag lookups
CREATE INDEX idx_tag_org ON message_tag (org_id, tag);

-- importance score sorting
CREATE INDEX idx_importance_score ON message_importance (org_id, score DESC);

-- contact handle resolution
CREATE INDEX idx_contact_handle_lookup ON contact_handle (channel, handle);

-- thread listing
CREATE INDEX idx_thread_org_last ON thread (org_id, last_message_at DESC);
```
