/**
 * Migration: rep-58-queue-schema
 * Branch:    kylemuldoon15/rep-58-sync-libsqueue-postgres-queue-client-consumer-runtime
 * Ticket:    REP-58
 * Created:   2026-06-23T05:22:19.403Z
 */
import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';
import { JobStatus } from '@repel/enums';

export const shorthands: ColumnDefinitions | undefined = undefined;

export async function up(pgm: MigrationBuilder): Promise<void> {
  // queue -> topic, aligning the column with the enqueue/consume vocabulary.
  pgm.renameColumn('job_queue', 'queue', 'topic');

  // Drop both partial indexes up front. They have `status`-predicate WHERE
  // clauses, and a status-referencing index blocks the column's type change
  // below; they are rebuilt at the end against topic + the new enum type.
  pgm.dropIndex('job_queue', ['queue', 'scheduled_for'], {
    name: 'idx_job_queue_poll',
  });
  pgm.dropIndex('job_queue', ['queue', 'dedup_key'], {
    name: 'idx_job_queue_dedup',
  });

  // status text + CHECK -> a real job_status enum (reaches generated.ts as a
  // union). Order matters: drop the CHECK (the enum cast cannot run while it
  // stands) and the text default (Postgres will not auto-cast a default to the
  // new type), change the type, then restore the default as the enum value.
  pgm.dropConstraint('job_queue', 'job_queue_status_check');
  pgm.alterColumn('job_queue', 'status', { default: null });
  pgm.createType('job_status', Object.values(JobStatus));
  pgm.alterColumn('job_queue', 'status', {
    type: 'job_status',
    using: 'status::job_status',
  });
  pgm.alterColumn('job_queue', 'status', { default: 'pending' });

  // Rebuild the partial indexes against topic; their status predicates now
  // compare the enum to enum literals. poll backs the dequeue scan, dedup the
  // no-duplicate-while-active constraint.
  pgm.createIndex('job_queue', ['topic', 'scheduled_for'], {
    name: 'idx_job_queue_poll',
    where: "status = 'pending'",
  });
  pgm.createIndex('job_queue', ['topic', 'dedup_key'], {
    name: 'idx_job_queue_dedup',
    unique: true,
    where: "status IN ('pending', 'processing') AND dedup_key IS NOT NULL",
  });
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  // Drop the status-predicate indexes first (same reason as up()).
  pgm.dropIndex('job_queue', ['topic', 'scheduled_for'], {
    name: 'idx_job_queue_poll',
  });
  pgm.dropIndex('job_queue', ['topic', 'dedup_key'], {
    name: 'idx_job_queue_dedup',
  });

  // enum -> text + CHECK. Drop the default before the type change (an enum
  // default cannot cast to text in place), then restore it as text.
  pgm.alterColumn('job_queue', 'status', { default: null });
  pgm.alterColumn('job_queue', 'status', {
    type: 'text',
    using: 'status::text',
  });
  pgm.alterColumn('job_queue', 'status', { default: 'pending' });
  pgm.addConstraint('job_queue', 'job_queue_status_check', {
    check: "status IN ('pending', 'processing', 'completed', 'failed', 'dead')",
  });
  pgm.dropType('job_status');

  // Indexes back to queue.
  pgm.renameColumn('job_queue', 'topic', 'queue');
  pgm.createIndex('job_queue', ['queue', 'scheduled_for'], {
    name: 'idx_job_queue_poll',
    where: "status = 'pending'",
  });
  pgm.createIndex('job_queue', ['queue', 'dedup_key'], {
    name: 'idx_job_queue_dedup',
    unique: true,
    where: "status IN ('pending', 'processing') AND dedup_key IS NOT NULL",
  });
}
