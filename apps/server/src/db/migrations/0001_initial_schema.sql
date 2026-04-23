-- Up Migration

-- Layer 1: Tenancy

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

-- Layer 2: Provider Accounts

CREATE TYPE channel AS ENUM ('email', 'sms', 'dm', 'chat_room');
CREATE TYPE provider AS ENUM ('gmail', 'icloud', 'generic_imap');
CREATE TYPE auth_method AS ENUM ('oauth2', 'app_password', 'api_key');

CREATE TABLE provider_account (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES org(id),
  user_id uuid NOT NULL REFERENCES "user"(id),

  provider provider NOT NULL,
  channel channel NOT NULL,
  auth_method auth_method NOT NULL,

  external_account_id text NOT NULL,
  alias text,

  credentials_encrypted bytea,
  sync_cursor jsonb,
  last_synced_at timestamptz,
  is_active boolean NOT NULL DEFAULT true,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (org_id, provider, external_account_id)
);

-- Layer 3: Threads and Messages

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

-- Layer 5: Contacts

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

-- Layer 6: Attachments

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

-- Layer 7: Processing Queue

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

-- Layer 8: Reference Vertical (acme)
-- Reference table only — paired with apps/server/src/core/acme/. Deleted in a
-- future ticket once a real Repel vertical is well-exercised as the in-tree
-- reference. No production data lands here.

CREATE TABLE acme (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES org(id),
  note text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes
--
-- Only load-bearing indexes ship in v0:
--   * idx_job_queue_poll      — backs the FOR UPDATE SKIP LOCKED worker
--                               dequeue pattern (ADR-004).
--   * idx_job_queue_dedup     — unique constraint, NOT a perf index;
--                               enforces no-duplicate-enqueue-while-active.
--
-- Read-path indexes (message, thread, contact_handle, etc.) are added when
-- a real query needs them, informed by EXPLAIN ANALYZE against representative
-- data — not by ahead-of-time guessing.

CREATE INDEX idx_job_queue_poll
  ON job_queue (queue, scheduled_for)
  WHERE status = 'pending';

CREATE UNIQUE INDEX idx_job_queue_dedup
  ON job_queue (queue, dedup_key)
  WHERE status IN ('pending', 'processing') AND dedup_key IS NOT NULL;

-- Row-Level Security

-- RLS is ENABLEd but not FORCEd. By default Postgres exempts table owners
-- and superusers from RLS. The migration role typically owns these tables,
-- so RLS does not engage in dev/test sessions opened as that role; this is
-- accepted by ADR-002 (bootstrap runs under the BYPASSRLS-equivalent role).
-- Production should run application queries under a non-owner role for
-- defense in depth. Smoke tests should use a non-owner role to verify
-- isolation — RLS verification under the owner role is a no-op.
ALTER TABLE org ENABLE ROW LEVEL SECURITY;
ALTER TABLE "user" ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_account ENABLE ROW LEVEL SECURITY;
ALTER TABLE thread ENABLE ROW LEVEL SECURITY;
ALTER TABLE message ENABLE ROW LEVEL SECURITY;
ALTER TABLE contact ENABLE ROW LEVEL SECURITY;
ALTER TABLE attachment ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE acme ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON org
  USING (id = current_setting('app.current_org_id')::uuid);

CREATE POLICY tenant_isolation ON "user"
  USING (org_id = current_setting('app.current_org_id')::uuid);

CREATE POLICY tenant_isolation ON provider_account
  USING (org_id = current_setting('app.current_org_id')::uuid);

CREATE POLICY tenant_isolation ON thread
  USING (org_id = current_setting('app.current_org_id')::uuid);

CREATE POLICY tenant_isolation ON message
  USING (org_id = current_setting('app.current_org_id')::uuid);

CREATE POLICY tenant_isolation ON contact
  USING (org_id = current_setting('app.current_org_id')::uuid);

CREATE POLICY tenant_isolation ON attachment
  USING (org_id = current_setting('app.current_org_id')::uuid);

-- job_queue carries tenancy in payload, not as a column. Permissive RLS at v0.
CREATE POLICY tenant_isolation ON job_queue
  USING (true);

CREATE POLICY tenant_isolation ON acme
  USING (org_id = current_setting('app.current_org_id')::uuid);


-- Down Migration

DROP TABLE IF EXISTS acme CASCADE;
DROP TABLE IF EXISTS attachment CASCADE;
DROP TABLE IF EXISTS contact_handle CASCADE;
DROP TABLE IF EXISTS contact CASCADE;
DROP TABLE IF EXISTS job_queue CASCADE;
DROP TABLE IF EXISTS message_raw CASCADE;
DROP TABLE IF EXISTS message CASCADE;
DROP TABLE IF EXISTS thread CASCADE;
DROP TABLE IF EXISTS provider_account CASCADE;
DROP TABLE IF EXISTS "user" CASCADE;
DROP TABLE IF EXISTS org CASCADE;

DROP TYPE IF EXISTS auth_method;
DROP TYPE IF EXISTS provider;
DROP TYPE IF EXISTS channel;
