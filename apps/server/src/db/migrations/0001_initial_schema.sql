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
  email text NOT NULL UNIQUE,
  name text,
  role text NOT NULL DEFAULT 'admin' CHECK (role IN ('admin', 'member', 'viewer')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Layer 2: Connected Accounts

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

-- Layer 4: Derived Data (AI Outputs)

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

  UNIQUE (channel, handle)
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

-- Layer 8: Classifier Configuration

CREATE TABLE classifier_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES org(id),
  version text NOT NULL,
  prompt_markdown text NOT NULL,
  is_active boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (org_id, version)
);

-- Indexes

CREATE INDEX idx_message_org_sent ON message (org_id, sent_at DESC);
CREATE INDEX idx_message_account ON message (connected_account_id, sent_at DESC);
CREATE INDEX idx_message_thread ON message (thread_id, sent_at ASC);

CREATE INDEX idx_classification_message ON message_classification (message_id);
CREATE INDEX idx_classification_category ON message_classification (org_id, category);

CREATE INDEX idx_tag_org ON message_tag (org_id, tag);

CREATE INDEX idx_importance_score ON message_importance (org_id, score DESC);

CREATE INDEX idx_contact_handle_lookup ON contact_handle (channel, handle);

CREATE INDEX idx_thread_org_last ON thread (org_id, last_message_at DESC);

-- Row-Level Security

ALTER TABLE org ENABLE ROW LEVEL SECURITY;
ALTER TABLE "user" ENABLE ROW LEVEL SECURITY;
ALTER TABLE connected_account ENABLE ROW LEVEL SECURITY;
ALTER TABLE thread ENABLE ROW LEVEL SECURITY;
ALTER TABLE message ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_classification ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_tag ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_summary ENABLE ROW LEVEL SECURITY;
ALTER TABLE draft_reply ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_importance ENABLE ROW LEVEL SECURITY;
ALTER TABLE contact ENABLE ROW LEVEL SECURITY;
ALTER TABLE attachment ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE classifier_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON org
  USING (id = current_setting('app.current_org_id')::uuid);

CREATE POLICY tenant_isolation ON "user"
  USING (org_id = current_setting('app.current_org_id')::uuid);

CREATE POLICY tenant_isolation ON connected_account
  USING (org_id = current_setting('app.current_org_id')::uuid);

CREATE POLICY tenant_isolation ON thread
  USING (org_id = current_setting('app.current_org_id')::uuid);

CREATE POLICY tenant_isolation ON message
  USING (org_id = current_setting('app.current_org_id')::uuid);

CREATE POLICY tenant_isolation ON message_classification
  USING (org_id = current_setting('app.current_org_id')::uuid);

CREATE POLICY tenant_isolation ON message_tag
  USING (org_id = current_setting('app.current_org_id')::uuid);

CREATE POLICY tenant_isolation ON message_summary
  USING (org_id = current_setting('app.current_org_id')::uuid);

CREATE POLICY tenant_isolation ON draft_reply
  USING (org_id = current_setting('app.current_org_id')::uuid);

CREATE POLICY tenant_isolation ON message_importance
  USING (org_id = current_setting('app.current_org_id')::uuid);

CREATE POLICY tenant_isolation ON contact
  USING (org_id = current_setting('app.current_org_id')::uuid);

CREATE POLICY tenant_isolation ON attachment
  USING (org_id = current_setting('app.current_org_id')::uuid);

CREATE POLICY tenant_isolation ON job_queue
  USING (true);

CREATE POLICY tenant_isolation ON classifier_config
  USING (org_id = current_setting('app.current_org_id')::uuid);
