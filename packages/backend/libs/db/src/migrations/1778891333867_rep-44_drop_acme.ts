/**
 * Migration: rep-44_drop_acme
 * Branch:    kylemuldoon15/rep-44-refactor-codebase-according-to-architecture-manifesto
 * Ticket:    REP-44
 * Created:   2026-05-15
 */
import type { MigrationBuilder } from 'node-pg-migrate';

// Removes the acme reference vertical. The table and its tenant_isolation RLS
// policy were introduced in v0 (rep-9) as scaffolding paired with
// apps/server/src/core/acme/. REP-44 deletes that directory and the manifesto
// no longer prescribes a reference vertical in the schema. The drop is
// reversible — down() recreates the table and policy mirroring the v0
// fragment so a rollback restores the prior state exactly.

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable('acme', { cascade: true });
}

export async function down(pgm: MigrationBuilder): Promise<void> {
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

  pgm.sql(`
    ALTER TABLE acme ENABLE ROW LEVEL SECURITY;

    CREATE POLICY tenant_isolation ON acme
      USING (org_id = current_setting('app.current_org_id')::uuid);
  `);
}
