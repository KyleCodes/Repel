/**
 * Migration: rep-48-user-id-message-thread
 * Branch:    kylemuldoon15/rep-48-denormalize-user-id-message-thread
 * Ticket:    REP-48
 * Created:   2026-05-22
 */
import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

// Denormalizes user_id onto the message and thread feed tables, mirroring the
// org_id that v0 (rep-9) already denormalized onto them. Per ADR-013: the
// user dimension lives on these tables as an indexable column so future
// user-scoped RLS is a flat-cost ALTER POLICY rather than a backfill plus a
// correlated subquery through provider_account.
//
// NOT NULL is safe with no backfill: message and thread are empty (no sync
// has run). `user` is a reserved word — quoted in the FK reference, matching
// the provider_account fragment in rep-9.

export const shorthands: ColumnDefinitions | undefined = undefined;

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.addColumn('message', {
    user_id: { type: 'uuid', notNull: true, references: '"user"(id)' },
  });
  pgm.addColumn('thread', {
    user_id: { type: 'uuid', notNull: true, references: '"user"(id)' },
  });

  pgm.createIndex('message', ['user_id'], { name: 'idx_message_user' });
  pgm.createIndex('thread', ['user_id'], { name: 'idx_thread_user' });
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  // Dropping the columns cascades their indexes and FK constraints.
  pgm.dropColumn('thread', 'user_id');
  pgm.dropColumn('message', 'user_id');
}
