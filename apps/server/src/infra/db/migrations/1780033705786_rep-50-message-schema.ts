/**
 * Migration: rep-50-message-schema
 * Branch:    kylemuldoon15/rep-50-spike-raw-normalized-message-schema-for-adapter-ingestion
 * Ticket:    REP-50
 * Created:   2026-05-29
 */
import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

// REP-50 schema spike: settles the per-message shape adapters (REP-13/14) write
// into and the thread/participant/contact graph downstream of it. Full rationale
// is in the REP-50 ticket comment.
//
// Key shape changes:
//   * message_raw becomes the root row; message gains a raw_message_id back-pointer
//     unique 1:1. Raw can exist without a successful normalize (re-normalization).
//   * message_raw gains full ADR-002/ADR-013 scoping (org_id, user_id, RLS) plus
//     provider_account_id, sync_task_id (FK target added by REP-21), channel,
//     external_message_id, payload_schema.
//   * message drops the recipient/cc/bcc arrays and the provider/external_message_id
//     unique (moved to message_raw); gains in_reply_to, references, message_id_header,
//     snippet for email threading.
//   * message_participant (new) replaces the dropped arrays. Adapter emits handles
//     dumbly; reconciler downstream resolves to contact_id (nullable).
//   * thread gains provider_account_id; unique scope tightens to
//     (provider_account_id, external_thread_id) since Gmail's threadId is per-mailbox.
//   * attachment gains user_id, bytes, external_attachment_id, content_id,
//     disposition. Bytes stored in PG until blob storage migration.
//   * contact gains user_id (per-user address book).
//   * contact_handle gains org_id, user_id, RLS; unique re-keyed to (user_id, channel, handle).
//
// All affected tables are empty (no sync has run), so NOT NULL adds are safe with
// no backfill. sync_task_id on message_raw is NOT NULL but UNCONSTRAINED until REP-21's
// migration adds the FK to sync_task(id).

export const shorthands: ColumnDefinitions | undefined = undefined;

export async function up(pgm: MigrationBuilder): Promise<void> {
  // ---------------------------------------------------------------------------
  // message_raw — drop and recreate as the root row.
  //
  // The old shape (message_id PK FK → message(id)) made raw a dependent extension
  // of normalized, which breaks the adapter contract (raw must persist even when
  // normalize fails) and the re-normalization flow. New shape is independent;
  // message back-points to it via raw_message_id UNIQUE NOT NULL.
  // ---------------------------------------------------------------------------

  pgm.dropTable('message_raw', { cascade: true });

  pgm.createTable(
    'message_raw',
    {
      id: {
        type: 'uuid',
        primaryKey: true,
        default: pgm.func('gen_random_uuid()'),
      },
      org_id: { type: 'uuid', notNull: true, references: 'org(id)' },
      user_id: { type: 'uuid', notNull: true, references: '"user"(id)' },
      provider_account_id: {
        type: 'uuid',
        notNull: true,
        references: 'provider_account(id)',
      },
      // sync_task_id is NOT NULL but unconstrained — REP-21's migration adds
      // the FK to sync_task(id). Every raw row in the system's life is produced
      // by a task; no backfill ever.
      sync_task_id: { type: 'uuid', notNull: true },
      channel: { type: 'channel', notNull: true },
      external_message_id: { type: 'text', notNull: true },
      // payload_schema identifies the shape so a future re-normalizer dispatches
      // correctly (e.g. 'gmail.users.messages.v1' vs '.v2').
      payload_schema: { type: 'text', notNull: true },
      payload: { type: 'jsonb', notNull: true },
      created_at: {
        type: 'timestamptz',
        notNull: true,
        default: pgm.func('now()'),
      },
    },
    {
      constraints: { unique: ['provider_account_id', 'external_message_id'] },
    }
  );

  // ---------------------------------------------------------------------------
  // message — delta.
  //   * Drop unique (provider_account_id, external_message_id) — moved to message_raw.
  //   * Drop recipient/cc/bcc arrays — replaced by message_participant.
  //   * Drop sender_address, sender_name — single source of truth lives in
  //     message_participant (role='from'). The denormalized cache was rejected
  //     to keep one place for "who sent this" and avoid a write-time consistency
  //     obligation between message and message_participant.
  //   * Add raw_message_id FK→message_raw(id) UNIQUE NOT NULL (back-pointer).
  //   * Add in_reply_to, references, message_id_header, snippet.
  // ---------------------------------------------------------------------------

  pgm.dropConstraint(
    'message',
    'message_uniq_provider_account_id_external_message_id'
  );

  pgm.dropColumns('message', [
    'recipient_addresses',
    'cc_addresses',
    'bcc_addresses',
    'sender_address',
    'sender_name',
  ]);

  pgm.addColumns('message', {
    raw_message_id: {
      type: 'uuid',
      notNull: true,
      references: 'message_raw(id)',
      unique: true,
    },
    in_reply_to: { type: 'text' },
    // "references" is a SQL reserved word; node-pg-migrate quotes it as needed.
    // The RFC 5322 References: header is an ordered list of message-id strings.
    references: { type: 'text[]' },
    message_id_header: { type: 'text' },
    snippet: { type: 'text' },
  });

  // ---------------------------------------------------------------------------
  // thread — delta.
  //   * Add provider_account_id FK→provider_account(id) NOT NULL.
  //   * Re-scope unique: was (org_id, channel, external_thread_id);
  //     becomes (provider_account_id, external_thread_id).
  // ---------------------------------------------------------------------------

  pgm.dropConstraint('thread', 'thread_uniq_org_id_channel_external_thread_id');

  pgm.addColumn('thread', {
    provider_account_id: {
      type: 'uuid',
      notNull: true,
      references: 'provider_account(id)',
    },
  });

  pgm.addConstraint('thread', 'thread_uniq_provider_account_external_thread', {
    unique: ['provider_account_id', 'external_thread_id'],
  });

  // ---------------------------------------------------------------------------
  // message_participant — new table.
  //
  // Replaces the dropped recipient/cc/bcc arrays. Adapter emits {handle,
  // display_name, role} with contact_id = null; reconciler (later ticket)
  // resolves contact_id by lookup-or-create on contact_handle.
  // ---------------------------------------------------------------------------

  pgm.createTable('message_participant', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
    },
    org_id: { type: 'uuid', notNull: true, references: 'org(id)' },
    user_id: { type: 'uuid', notNull: true, references: '"user"(id)' },
    message_id: {
      type: 'uuid',
      notNull: true,
      references: 'message(id)',
      onDelete: 'CASCADE',
    },
    contact_id: { type: 'uuid', references: 'contact(id)' },
    handle: { type: 'text', notNull: true },
    display_name: { type: 'text' },
    role: {
      type: 'text',
      notNull: true,
      check: "role IN ('from', 'to', 'cc', 'bcc', 'reply_to')",
    },
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
  });

  pgm.createIndex('message_participant', ['message_id'], {
    name: 'idx_message_participant_message',
  });
  pgm.createIndex('message_participant', ['contact_id'], {
    name: 'idx_message_participant_contact',
    where: 'contact_id IS NOT NULL',
  });

  // ---------------------------------------------------------------------------
  // attachment — delta.
  //   * Drop storage_path — bytes-in-PG is the only path today; storage_path
  //     would force every insert to invent a value. A future blob-storage
  //     migration will add it back (nullable) and flip bytes to nullable then.
  //   * Add user_id FK→"user"(id) NOT NULL — ADR-013 scoping.
  //   * Add bytes bytea NOT NULL — PG-resident byte storage until blob migration.
  //   * Add external_attachment_id (Gmail's attachmentId), content_id (inline cid),
  //     disposition ('inline' | 'attachment') with CHECK.
  // ---------------------------------------------------------------------------

  pgm.dropColumn('attachment', 'storage_path');

  pgm.addColumns('attachment', {
    user_id: { type: 'uuid', notNull: true, references: '"user"(id)' },
    external_attachment_id: { type: 'text' },
    content_id: { type: 'text' },
    disposition: {
      type: 'text',
      check: "disposition IN ('inline', 'attachment')",
    },
    bytes: { type: 'bytea', notNull: true },
  });

  // ---------------------------------------------------------------------------
  // contact — delta.
  //   * Add user_id FK→"user"(id) NOT NULL. Contacts scoped per-user-within-org;
  //     no implicit cross-user sharing at the DB level.
  // ---------------------------------------------------------------------------

  pgm.addColumn('contact', {
    user_id: { type: 'uuid', notNull: true, references: '"user"(id)' },
  });

  // ---------------------------------------------------------------------------
  // contact_handle — delta.
  //   * Add org_id, user_id, RLS policy.
  //   * Re-key unique: was (contact_id, channel, handle);
  //     becomes (user_id, channel, handle) — same handle can map to a different
  //     contact for a different user.
  // ---------------------------------------------------------------------------

  pgm.dropConstraint(
    'contact_handle',
    'contact_handle_uniq_contact_id_channel_handle'
  );

  pgm.addColumns('contact_handle', {
    org_id: { type: 'uuid', notNull: true, references: 'org(id)' },
    user_id: { type: 'uuid', notNull: true, references: '"user"(id)' },
  });

  pgm.addConstraint(
    'contact_handle',
    'contact_handle_uniq_user_channel_handle',
    { unique: ['user_id', 'channel', 'handle'] }
  );

  // ---------------------------------------------------------------------------
  // RLS — enable + tenant_isolation policy for the new and newly-scoped tables.
  //
  // No first-class node-pg-migrate API for RLS; using pgm.sql() escape hatch
  // consistent with rep-9.
  // ---------------------------------------------------------------------------

  pgm.sql(`
    ALTER TABLE message_raw ENABLE ROW LEVEL SECURITY;
    ALTER TABLE message_participant ENABLE ROW LEVEL SECURITY;
    ALTER TABLE contact_handle ENABLE ROW LEVEL SECURITY;

    CREATE POLICY tenant_isolation ON message_raw
      USING (org_id = current_setting('app.current_org_id')::uuid);

    CREATE POLICY tenant_isolation ON message_participant
      USING (org_id = current_setting('app.current_org_id')::uuid);

    CREATE POLICY tenant_isolation ON contact_handle
      USING (org_id = current_setting('app.current_org_id')::uuid);
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    DROP POLICY IF EXISTS tenant_isolation ON contact_handle;
    DROP POLICY IF EXISTS tenant_isolation ON message_participant;
    DROP POLICY IF EXISTS tenant_isolation ON message_raw;

    ALTER TABLE contact_handle DISABLE ROW LEVEL SECURITY;
  `);

  pgm.dropConstraint(
    'contact_handle',
    'contact_handle_uniq_user_channel_handle'
  );
  pgm.dropColumns('contact_handle', ['user_id', 'org_id']);
  pgm.addConstraint(
    'contact_handle',
    'contact_handle_uniq_contact_id_channel_handle',
    { unique: ['contact_id', 'channel', 'handle'] }
  );

  pgm.dropColumn('contact', 'user_id');

  pgm.dropColumns('attachment', [
    'bytes',
    'disposition',
    'content_id',
    'external_attachment_id',
    'user_id',
  ]);
  pgm.addColumn('attachment', {
    storage_path: { type: 'text', notNull: true },
  });

  pgm.dropTable('message_participant', { cascade: true });

  pgm.dropConstraint('thread', 'thread_uniq_provider_account_external_thread');
  pgm.dropColumn('thread', 'provider_account_id');
  pgm.addConstraint('thread', 'thread_uniq_org_id_channel_external_thread_id', {
    unique: ['org_id', 'channel', 'external_thread_id'],
  });

  pgm.dropColumns('message', [
    'snippet',
    'message_id_header',
    'references',
    'in_reply_to',
    'raw_message_id',
  ]);
  pgm.addColumns('message', {
    recipient_addresses: {
      type: 'text[]',
      notNull: true,
      default: pgm.func("'{}'"),
    },
    cc_addresses: { type: 'text[]', default: pgm.func("'{}'") },
    bcc_addresses: { type: 'text[]', default: pgm.func("'{}'") },
    sender_address: { type: 'text', notNull: true },
    sender_name: { type: 'text' },
  });
  pgm.addConstraint(
    'message',
    'message_uniq_provider_account_id_external_message_id',
    { unique: ['provider_account_id', 'external_message_id'] }
  );

  pgm.dropTable('message_raw', { cascade: true });

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
}
