/**
 * Migration: rep-56-sync-schema
 * Branch:    kylemuldoon15/rep-56-sync-schema-synchronous-persistence-sync-status
 * Ticket:    REP-56
 * Created:   2026-06-22T08:02:27.934Z
 */
import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';
import { SyncEventType } from '@repel/enums';

export const shorthands: ColumnDefinitions | undefined = undefined;

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createType('sync_event_type', Object.values(SyncEventType));

  pgm.createTable('sync_job', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
    },
    org_id: { type: 'uuid', notNull: true, references: 'org(id)' },
    user_id: { type: 'uuid', notNull: true, references: '"user"(id)' },
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

  pgm.createTable('sync_task', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
    },
    org_id: { type: 'uuid', notNull: true, references: 'org(id)' },
    user_id: { type: 'uuid', notNull: true, references: '"user"(id)' },
    job_id: {
      type: 'uuid',
      notNull: true,
      references: 'sync_job(id)',
      onDelete: 'CASCADE',
    },
    provider_account_id: {
      type: 'uuid',
      notNull: true,
      references: 'provider_account(id)',
    },
    spec: { type: 'jsonb', notNull: true },
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
  });

  pgm.createTable('sync_task_event', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
    },
    org_id: { type: 'uuid', notNull: true, references: 'org(id)' },
    user_id: { type: 'uuid', notNull: true, references: '"user"(id)' },
    task_id: {
      type: 'uuid',
      notNull: true,
      references: 'sync_task(id)',
      onDelete: 'CASCADE',
    },
    type: { type: 'sync_event_type', notNull: true },
    payload: { type: 'jsonb' },
    raw_message_id: { type: 'uuid', references: 'message_raw(id)' },
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
  });

  // message_raw.sync_task_id exists NOT NULL but unconstrained since REP-50.
  pgm.addConstraint('message_raw', 'message_raw_sync_task_id_fkey', {
    foreignKeys: { columns: 'sync_task_id', references: 'sync_task(id)' },
  });

  // The resumption cursor now lives in the completed sync_task_event payload.
  pgm.dropColumn('provider_account', 'sync_cursor');

  pgm.createIndex('sync_task', ['job_id'], { name: 'idx_sync_task_job' });
  pgm.createIndex('sync_task', ['provider_account_id'], {
    name: 'idx_sync_task_provider_account',
  });
  pgm.createIndex('sync_task_event', ['task_id'], {
    name: 'idx_sync_task_event_task',
  });
  pgm.createIndex('sync_task_event', ['raw_message_id'], {
    name: 'idx_sync_task_event_raw_message',
    where: 'raw_message_id IS NOT NULL',
  });

  // org-scoped RLS (ADR-002). USING-only, so every INSERT must carry org_id.
  pgm.sql(`
    ALTER TABLE sync_job        ENABLE ROW LEVEL SECURITY;
    ALTER TABLE sync_task       ENABLE ROW LEVEL SECURITY;
    ALTER TABLE sync_task_event ENABLE ROW LEVEL SECURITY;

    CREATE POLICY tenant_isolation ON sync_job
      USING (org_id = current_setting('app.current_org_id')::uuid);

    CREATE POLICY tenant_isolation ON sync_task
      USING (org_id = current_setting('app.current_org_id')::uuid);

    CREATE POLICY tenant_isolation ON sync_task_event
      USING (org_id = current_setting('app.current_org_id')::uuid);
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.addColumn('provider_account', {
    sync_cursor: { type: 'jsonb' },
  });

  pgm.dropConstraint('message_raw', 'message_raw_sync_task_id_fkey');

  pgm.sql(`
    DROP POLICY IF EXISTS tenant_isolation ON sync_task_event;
    DROP POLICY IF EXISTS tenant_isolation ON sync_task;
    DROP POLICY IF EXISTS tenant_isolation ON sync_job;

    ALTER TABLE sync_task_event DISABLE ROW LEVEL SECURITY;
    ALTER TABLE sync_task       DISABLE ROW LEVEL SECURITY;
    ALTER TABLE sync_job        DISABLE ROW LEVEL SECURITY;
  `);

  pgm.dropTable('sync_task_event', { cascade: true });
  pgm.dropTable('sync_task', { cascade: true });
  pgm.dropTable('sync_job', { cascade: true });
  pgm.dropType('sync_event_type');
}
