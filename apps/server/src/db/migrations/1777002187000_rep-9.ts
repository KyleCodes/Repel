import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';
import { AuthMethod, Channel, Provider } from '@repel/shared';

// v0 schema. Enum values are sourced from @repel/shared so the Postgres enum
// and the TypeScript union are guaranteed to stay in sync — adding a value to
// the const automatically flows into the migration the next time it runs on
// a fresh database. node-pg-migrate APIs are used wherever possible; RLS
// policies fall through to pgm.sql() because there is no first-class API.

export const shorthands: ColumnDefinitions | undefined = undefined;

export async function up(pgm: MigrationBuilder): Promise<void> {
  // Enums — single source of truth lives in @repel/shared.
  pgm.createType('channel', Object.values(Channel));
  pgm.createType('provider', Object.values(Provider));
  pgm.createType('auth_method', Object.values(AuthMethod));

  // Layer 1: Tenancy

  pgm.createTable('org', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
    },
    name: { type: 'text', notNull: true },
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
    updated_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
  });

  pgm.createTable(
    'user',
    {
      id: {
        type: 'uuid',
        primaryKey: true,
        default: pgm.func('gen_random_uuid()'),
      },
      org_id: { type: 'uuid', notNull: true, references: 'org(id)' },
      email: { type: 'text', notNull: true },
      name: { type: 'text' },
      role: {
        type: 'text',
        notNull: true,
        default: 'admin',
        check: "role IN ('admin', 'member', 'viewer')",
      },
      created_at: {
        type: 'timestamptz',
        notNull: true,
        default: pgm.func('now()'),
      },
      updated_at: {
        type: 'timestamptz',
        notNull: true,
        default: pgm.func('now()'),
      },
    },
    {
      constraints: { unique: ['org_id', 'email'] },
    }
  );

  // Layer 2: Provider Accounts (per ADR-005)

  pgm.createTable(
    'provider_account',
    {
      id: {
        type: 'uuid',
        primaryKey: true,
        default: pgm.func('gen_random_uuid()'),
      },
      org_id: { type: 'uuid', notNull: true, references: 'org(id)' },
      user_id: { type: 'uuid', notNull: true, references: '"user"(id)' },

      provider: { type: 'provider', notNull: true },
      channel: { type: 'channel', notNull: true },
      auth_method: { type: 'auth_method', notNull: true },

      external_account_id: { type: 'text', notNull: true },
      alias: { type: 'text' },

      credentials_encrypted: { type: 'bytea' },
      sync_cursor: { type: 'jsonb' },
      last_synced_at: { type: 'timestamptz' },
      is_active: { type: 'boolean', notNull: true, default: true },

      created_at: {
        type: 'timestamptz',
        notNull: true,
        default: pgm.func('now()'),
      },
      updated_at: {
        type: 'timestamptz',
        notNull: true,
        default: pgm.func('now()'),
      },
    },
    {
      constraints: { unique: ['org_id', 'provider', 'external_account_id'] },
    }
  );

  // Layer 3: Threads and Messages

  pgm.createTable(
    'thread',
    {
      id: {
        type: 'uuid',
        primaryKey: true,
        default: pgm.func('gen_random_uuid()'),
      },
      org_id: { type: 'uuid', notNull: true, references: 'org(id)' },
      channel: { type: 'channel', notNull: true },
      external_thread_id: { type: 'text' },
      subject: { type: 'text' },
      last_message_at: { type: 'timestamptz' },
      message_count: { type: 'int', notNull: true, default: 0 },
      created_at: {
        type: 'timestamptz',
        notNull: true,
        default: pgm.func('now()'),
      },
      updated_at: {
        type: 'timestamptz',
        notNull: true,
        default: pgm.func('now()'),
      },
    },
    {
      constraints: { unique: ['org_id', 'channel', 'external_thread_id'] },
    }
  );

  pgm.createTable(
    'message',
    {
      id: {
        type: 'uuid',
        primaryKey: true,
        default: pgm.func('gen_random_uuid()'),
      },
      org_id: { type: 'uuid', notNull: true, references: 'org(id)' },
      thread_id: { type: 'uuid', references: 'thread(id)' },
      provider_account_id: {
        type: 'uuid',
        notNull: true,
        references: 'provider_account(id)',
      },
      channel: { type: 'channel', notNull: true },
      external_message_id: { type: 'text', notNull: true },
      sender_address: { type: 'text', notNull: true },
      sender_name: { type: 'text' },
      recipient_addresses: {
        type: 'text[]',
        notNull: true,
        default: pgm.func("'{}'"),
      },
      cc_addresses: { type: 'text[]', default: pgm.func("'{}'") },
      bcc_addresses: { type: 'text[]', default: pgm.func("'{}'") },
      subject: { type: 'text' },
      body_text: { type: 'text' },
      body_html: { type: 'text' },
      direction: {
        type: 'text',
        notNull: true,
        check: "direction IN ('inbound', 'outbound')",
      },
      sent_at: { type: 'timestamptz', notNull: true },
      received_at: { type: 'timestamptz' },
      is_read: { type: 'boolean', notNull: true, default: false },
      is_starred: { type: 'boolean', notNull: true, default: false },
      is_archived: { type: 'boolean', notNull: true, default: false },
      is_deleted: { type: 'boolean', notNull: true, default: false },
      created_at: {
        type: 'timestamptz',
        notNull: true,
        default: pgm.func('now()'),
      },
      updated_at: {
        type: 'timestamptz',
        notNull: true,
        default: pgm.func('now()'),
      },
    },
    {
      constraints: { unique: ['provider_account_id', 'external_message_id'] },
    }
  );

  pgm.createTable('message_raw', {
    message_id: { type: 'uuid', primaryKey: true, references: 'message(id)' },
    payload: { type: 'jsonb', notNull: true },
    content_type: { type: 'text', notNull: true },
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
  });

  // Layer 5: Contacts (Layer 4 — derived facts — is deferred. See
  // docs/design_ideas/derived-fact-model.md.)

  pgm.createTable('contact', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
    },
    org_id: { type: 'uuid', notNull: true, references: 'org(id)' },
    name: { type: 'text' },
    is_blocked: { type: 'boolean', notNull: true, default: false },
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
    updated_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
  });

  pgm.createTable(
    'contact_handle',
    {
      id: {
        type: 'uuid',
        primaryKey: true,
        default: pgm.func('gen_random_uuid()'),
      },
      contact_id: { type: 'uuid', notNull: true, references: 'contact(id)' },
      channel: { type: 'channel', notNull: true },
      handle: { type: 'text', notNull: true },
      is_primary: { type: 'boolean', notNull: true, default: false },
      created_at: {
        type: 'timestamptz',
        notNull: true,
        default: pgm.func('now()'),
      },
    },
    {
      constraints: { unique: ['contact_id', 'channel', 'handle'] },
    }
  );

  // Layer 6: Attachments

  pgm.createTable('attachment', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
    },
    org_id: { type: 'uuid', notNull: true, references: 'org(id)' },
    message_id: { type: 'uuid', notNull: true, references: 'message(id)' },
    filename: { type: 'text', notNull: true },
    content_type: { type: 'text' },
    size_bytes: { type: 'bigint' },
    storage_path: { type: 'text', notNull: true },
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
  });

  // Layer 7: Processing Queue

  pgm.createTable('job_queue', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
    },
    queue: { type: 'text', notNull: true, default: 'default' },
    payload: { type: 'jsonb', notNull: true },
    dedup_key: { type: 'text' },
    status: {
      type: 'text',
      notNull: true,
      default: 'pending',
      check:
        "status IN ('pending', 'processing', 'completed', 'failed', 'dead')",
    },
    attempts: { type: 'int', notNull: true, default: 0 },
    max_attempts: { type: 'int', notNull: true, default: 3 },
    last_error: { type: 'text' },
    locked_at: { type: 'timestamptz' },
    locked_by: { type: 'text' },
    scheduled_for: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
    completed_at: { type: 'timestamptz' },
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
  });

  // Layer 8: Reference vertical (acme). Paired with apps/server/src/core/acme/.
  // Deleted in a future ticket once a real Repel vertical is well-exercised
  // as the in-tree reference. No production data lands here.

  pgm.createTable('acme', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
    },
    org_id: { type: 'uuid', notNull: true, references: 'org(id)' },
    note: { type: 'text', notNull: true },
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
    updated_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
  });

  // Indexes
  //
  // Only load-bearing indexes ship in v0:
  //   * idx_job_queue_poll  — backs the FOR UPDATE SKIP LOCKED worker dequeue
  //                           pattern (ADR-004).
  //   * idx_job_queue_dedup — unique constraint, NOT a perf index; enforces
  //                           no-duplicate-enqueue-while-active.
  //
  // Read-path indexes (message, thread, contact_handle, etc.) are added when
  // a real query needs them, informed by EXPLAIN ANALYZE against representative
  // data — not by ahead-of-time guessing.

  pgm.createIndex('job_queue', ['queue', 'scheduled_for'], {
    name: 'idx_job_queue_poll',
    where: "status = 'pending'",
  });

  pgm.createIndex('job_queue', ['queue', 'dedup_key'], {
    name: 'idx_job_queue_dedup',
    unique: true,
    where: "status IN ('pending', 'processing') AND dedup_key IS NOT NULL",
  });

  // Row-Level Security
  //
  // RLS is ENABLEd but not FORCEd. By default Postgres exempts table owners
  // and superusers from RLS. The migration role typically owns these tables,
  // so RLS does not engage in dev/test sessions opened as that role; this is
  // accepted by ADR-002 (bootstrap runs under the BYPASSRLS-equivalent role).
  // Production should run application queries under a non-owner role for
  // defense in depth. Smoke tests should use a non-owner role to verify
  // isolation — RLS verification under the owner role is a no-op.
  //
  // node-pg-migrate has no first-class RLS API; using pgm.sql() escape hatch.
  pgm.sql(`
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
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  // Tables in FK-reverse order. CASCADE drops policies, indexes, constraints.
  pgm.dropTable('acme', { cascade: true });
  pgm.dropTable('attachment', { cascade: true });
  pgm.dropTable('contact_handle', { cascade: true });
  pgm.dropTable('contact', { cascade: true });
  pgm.dropTable('job_queue', { cascade: true });
  pgm.dropTable('message_raw', { cascade: true });
  pgm.dropTable('message', { cascade: true });
  pgm.dropTable('thread', { cascade: true });
  pgm.dropTable('provider_account', { cascade: true });
  pgm.dropTable('user', { cascade: true });
  pgm.dropTable('org', { cascade: true });

  pgm.dropType('auth_method');
  pgm.dropType('provider');
  pgm.dropType('channel');
}
