-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "auth_method" AS ENUM ('oauth2', 'app_password', 'api_key');

-- CreateEnum
CREATE TYPE "channel" AS ENUM ('email', 'sms', 'dm', 'chat_room');

-- CreateEnum
CREATE TYPE "job_status" AS ENUM ('pending', 'processing', 'completed', 'failed', 'dead');

-- CreateEnum
CREATE TYPE "provider" AS ENUM ('gmail', 'icloud', 'generic_imap');

-- CreateEnum
CREATE TYPE "sync_event_type" AS ENUM ('enqueued', 'started', 'auth', 'progress', 'message', 'completed', 'failed');

-- CreateTable
CREATE TABLE "org" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "org_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "role" TEXT NOT NULL DEFAULT 'admin',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_account" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "provider" "provider" NOT NULL,
    "channel" "channel" NOT NULL,
    "auth_method" "auth_method" NOT NULL,
    "external_account_id" TEXT NOT NULL,
    "alias" TEXT,
    "credentials_encrypted" BYTEA,
    "last_synced_at" TIMESTAMPTZ,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "provider_account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "name" TEXT,
    "is_blocked" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "user_id" UUID NOT NULL,

    CONSTRAINT "contact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_handle" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "contact_id" UUID NOT NULL,
    "channel" "channel" NOT NULL,
    "handle" TEXT NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "org_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,

    CONSTRAINT "contact_handle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "thread" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "channel" "channel" NOT NULL,
    "external_thread_id" TEXT,
    "subject" TEXT,
    "last_message_at" TIMESTAMPTZ,
    "message_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "user_id" UUID NOT NULL,
    "provider_account_id" UUID NOT NULL,

    CONSTRAINT "thread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "thread_id" UUID,
    "provider_account_id" UUID NOT NULL,
    "channel" "channel" NOT NULL,
    "external_message_id" TEXT NOT NULL,
    "subject" TEXT,
    "body_text" TEXT,
    "body_html" TEXT,
    "direction" TEXT NOT NULL,
    "sent_at" TIMESTAMPTZ NOT NULL,
    "received_at" TIMESTAMPTZ,
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "is_starred" BOOLEAN NOT NULL DEFAULT false,
    "is_archived" BOOLEAN NOT NULL DEFAULT false,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "user_id" UUID NOT NULL,
    "raw_message_id" UUID NOT NULL,
    "in_reply_to" TEXT,
    "references" TEXT[],
    "message_id_header" TEXT,
    "snippet" TEXT,

    CONSTRAINT "message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_raw" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "provider_account_id" UUID NOT NULL,
    "sync_task_id" UUID NOT NULL,
    "channel" "channel" NOT NULL,
    "external_message_id" TEXT NOT NULL,
    "payload_schema" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "message_raw_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_participant" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "message_id" UUID NOT NULL,
    "contact_id" UUID,
    "handle" TEXT NOT NULL,
    "display_name" TEXT,
    "role" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "message_participant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attachment" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "message_id" UUID NOT NULL,
    "filename" TEXT NOT NULL,
    "content_type" TEXT,
    "size_bytes" BIGINT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "user_id" UUID NOT NULL,
    "external_attachment_id" TEXT,
    "content_id" TEXT,
    "disposition" TEXT,
    "bytes" BYTEA NOT NULL,

    CONSTRAINT "attachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_job" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "sync_job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_task" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "job_id" UUID NOT NULL,
    "provider_account_id" UUID NOT NULL,
    "spec" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "sync_task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_task_event" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "type" "sync_event_type" NOT NULL,
    "payload" JSONB,
    "raw_message_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "sync_task_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_queue" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "topic" TEXT NOT NULL DEFAULT 'default',
    "payload" JSONB NOT NULL,
    "dedup_key" TEXT,
    "status" "job_status" NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 3,
    "last_error" TEXT,
    "locked_at" TIMESTAMPTZ,
    "locked_by" TEXT,
    "scheduled_for" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "completed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "job_queue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
ALTER TABLE "user" ADD CONSTRAINT "user_uniq_org_id_email" UNIQUE ("org_id", "email");

-- CreateIndex
ALTER TABLE "provider_account" ADD CONSTRAINT "provider_account_uniq_org_id_provider_external_account_id" UNIQUE ("org_id", "provider", "external_account_id");

-- CreateIndex
ALTER TABLE "contact_handle" ADD CONSTRAINT "contact_handle_uniq_user_channel_handle" UNIQUE ("user_id", "channel", "handle");

-- CreateIndex
CREATE INDEX "idx_thread_user" ON "thread"("user_id");

-- CreateIndex
ALTER TABLE "thread" ADD CONSTRAINT "thread_uniq_provider_account_external_thread" UNIQUE ("provider_account_id", "external_thread_id");

-- CreateIndex
ALTER TABLE "message" ADD CONSTRAINT "message_raw_message_id_key" UNIQUE ("raw_message_id");

-- CreateIndex
CREATE INDEX "idx_message_user" ON "message"("user_id");

-- CreateIndex
ALTER TABLE "message_raw" ADD CONSTRAINT "message_raw_uniq_provider_account_id_external_message_id" UNIQUE ("provider_account_id", "external_message_id");

-- CreateIndex
CREATE INDEX "idx_message_participant_message" ON "message_participant"("message_id");

-- CreateIndex
CREATE INDEX "idx_sync_task_job" ON "sync_task"("job_id");

-- CreateIndex
CREATE INDEX "idx_sync_task_provider_account" ON "sync_task"("provider_account_id");

-- CreateIndex
CREATE INDEX "idx_sync_task_event_task" ON "sync_task_event"("task_id");

-- AddForeignKey
ALTER TABLE "user" ADD CONSTRAINT "user_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "org"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "provider_account" ADD CONSTRAINT "provider_account_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "org"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "provider_account" ADD CONSTRAINT "provider_account_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "contact" ADD CONSTRAINT "contact_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "org"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "contact" ADD CONSTRAINT "contact_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "contact_handle" ADD CONSTRAINT "contact_handle_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contact"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "contact_handle" ADD CONSTRAINT "contact_handle_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "org"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "contact_handle" ADD CONSTRAINT "contact_handle_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "thread" ADD CONSTRAINT "thread_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "org"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "thread" ADD CONSTRAINT "thread_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "thread" ADD CONSTRAINT "thread_provider_account_id_fkey" FOREIGN KEY ("provider_account_id") REFERENCES "provider_account"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "message" ADD CONSTRAINT "message_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "org"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "message" ADD CONSTRAINT "message_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "thread"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "message" ADD CONSTRAINT "message_provider_account_id_fkey" FOREIGN KEY ("provider_account_id") REFERENCES "provider_account"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "message" ADD CONSTRAINT "message_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "message" ADD CONSTRAINT "message_raw_message_id_fkey" FOREIGN KEY ("raw_message_id") REFERENCES "message_raw"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "message_raw" ADD CONSTRAINT "message_raw_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "org"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "message_raw" ADD CONSTRAINT "message_raw_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "message_raw" ADD CONSTRAINT "message_raw_provider_account_id_fkey" FOREIGN KEY ("provider_account_id") REFERENCES "provider_account"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "message_raw" ADD CONSTRAINT "message_raw_sync_task_id_fkey" FOREIGN KEY ("sync_task_id") REFERENCES "sync_task"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "message_participant" ADD CONSTRAINT "message_participant_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "org"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "message_participant" ADD CONSTRAINT "message_participant_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "message_participant" ADD CONSTRAINT "message_participant_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "message"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "message_participant" ADD CONSTRAINT "message_participant_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contact"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "attachment" ADD CONSTRAINT "attachment_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "org"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "attachment" ADD CONSTRAINT "attachment_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "message"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "attachment" ADD CONSTRAINT "attachment_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "sync_job" ADD CONSTRAINT "sync_job_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "org"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "sync_job" ADD CONSTRAINT "sync_job_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "sync_task" ADD CONSTRAINT "sync_task_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "org"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "sync_task" ADD CONSTRAINT "sync_task_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "sync_task" ADD CONSTRAINT "sync_task_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "sync_job"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "sync_task" ADD CONSTRAINT "sync_task_provider_account_id_fkey" FOREIGN KEY ("provider_account_id") REFERENCES "provider_account"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "sync_task_event" ADD CONSTRAINT "sync_task_event_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "org"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "sync_task_event" ADD CONSTRAINT "sync_task_event_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "sync_task_event" ADD CONSTRAINT "sync_task_event_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "sync_task"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "sync_task_event" ADD CONSTRAINT "sync_task_event_raw_message_id_fkey" FOREIGN KEY ("raw_message_id") REFERENCES "message_raw"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;


-- ============================================================================
-- Hand-written DDL below this line — everything Prisma Schema Language cannot
-- express. Sourced verbatim from a pg_dump --schema-only of the fully migrated
-- pre-Prisma database. Prisma's differ never sees these objects (CHECKs, RLS)
-- so they survive future `migrate dev` runs untouched; the partial indexes are
-- kept out of PSL deliberately (see MIGRATION_NOTES.md §4).
-- ============================================================================

-- CHECK constraints
ALTER TABLE "user" ADD CONSTRAINT user_role_check CHECK (role = ANY (ARRAY['admin'::text, 'member'::text, 'viewer'::text]));
ALTER TABLE "message" ADD CONSTRAINT message_direction_check CHECK (direction = ANY (ARRAY['inbound'::text, 'outbound'::text]));
ALTER TABLE "message_participant" ADD CONSTRAINT message_participant_role_check CHECK (role = ANY (ARRAY['from'::text, 'to'::text, 'cc'::text, 'bcc'::text, 'reply_to'::text]));
ALTER TABLE "attachment" ADD CONSTRAINT attachment_disposition_check CHECK (disposition = ANY (ARRAY['inline'::text, 'attachment'::text]));

-- Partial indexes
CREATE UNIQUE INDEX idx_job_queue_dedup ON job_queue USING btree (topic, dedup_key) WHERE ((status = ANY (ARRAY['pending'::job_status, 'processing'::job_status])) AND (dedup_key IS NOT NULL));
CREATE INDEX idx_job_queue_poll ON job_queue USING btree (topic, scheduled_for) WHERE (status = 'pending'::job_status);
CREATE INDEX idx_message_participant_contact ON message_participant USING btree (contact_id) WHERE (contact_id IS NOT NULL);
CREATE INDEX idx_sync_task_event_raw_message ON sync_task_event USING btree (raw_message_id) WHERE (raw_message_id IS NOT NULL);

-- Row-level security
ALTER TABLE org ENABLE ROW LEVEL SECURITY;
ALTER TABLE "user" ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_account ENABLE ROW LEVEL SECURITY;
ALTER TABLE contact ENABLE ROW LEVEL SECURITY;
ALTER TABLE contact_handle ENABLE ROW LEVEL SECURITY;
ALTER TABLE thread ENABLE ROW LEVEL SECURITY;
ALTER TABLE message ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_raw ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_participant ENABLE ROW LEVEL SECURITY;
ALTER TABLE attachment ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_job ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_task ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_task_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON org USING ((id = (current_setting('app.current_org_id'::text))::uuid));
CREATE POLICY tenant_isolation ON "user" USING ((org_id = (current_setting('app.current_org_id'::text))::uuid));
CREATE POLICY tenant_isolation ON provider_account USING ((org_id = (current_setting('app.current_org_id'::text))::uuid));
CREATE POLICY tenant_isolation ON contact USING ((org_id = (current_setting('app.current_org_id'::text))::uuid));
CREATE POLICY tenant_isolation ON contact_handle USING ((org_id = (current_setting('app.current_org_id'::text))::uuid));
CREATE POLICY tenant_isolation ON thread USING ((org_id = (current_setting('app.current_org_id'::text))::uuid));
CREATE POLICY tenant_isolation ON message USING ((org_id = (current_setting('app.current_org_id'::text))::uuid));
CREATE POLICY tenant_isolation ON message_raw USING ((org_id = (current_setting('app.current_org_id'::text))::uuid));
CREATE POLICY tenant_isolation ON message_participant USING ((org_id = (current_setting('app.current_org_id'::text))::uuid));
CREATE POLICY tenant_isolation ON attachment USING ((org_id = (current_setting('app.current_org_id'::text))::uuid));
CREATE POLICY tenant_isolation ON sync_job USING ((org_id = (current_setting('app.current_org_id'::text))::uuid));
CREATE POLICY tenant_isolation ON sync_task USING ((org_id = (current_setting('app.current_org_id'::text))::uuid));
CREATE POLICY tenant_isolation ON sync_task_event USING ((org_id = (current_setting('app.current_org_id'::text))::uuid));
CREATE POLICY tenant_isolation ON job_queue USING (true);
