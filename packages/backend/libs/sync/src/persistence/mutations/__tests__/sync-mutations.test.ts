import { describe, expect, test } from 'bun:test';
import { CamelCasePlugin, Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import type { DB } from '@repel/backend-db/generated';
import type { Tx } from '@repel/backend-db/types';
import {
  type CreateSyncJobValues,
  buildCreateSyncJob,
} from '../create-sync-job';
import { buildPersistEvent } from '../persist-event';
import {
  type PersistMessageInput,
  buildPersistMessageCore,
} from '../persist-message';

// Compile-only: a Kysely over a never-connected Pool so .compile() yields SQL +
// parameters with no I/O. (persistMessage runs sequential statements, not a
// single builder, so its idempotency is covered by an integration test; here we
// assert the SQL-shape invariants of the single-statement mutations.)
const db = new Kysely<DB>({
  dialect: new PostgresDialect({
    pool: new Pool({ connectionString: 'postgres://unused' }),
  }),
  plugins: [new CamelCasePlugin()],
});
const trx = db as unknown as Tx;

const createInput: CreateSyncJobValues = {
  syncJob: { id: 'job-1', orgId: 'org-1', userId: 'user-1' },
  tasks: [
    {
      id: 'task-1',
      orgId: 'org-1',
      userId: 'user-1',
      jobId: 'job-1',
      providerAccountId: 'pa-1',
      spec: { type: 'full', limit: 20 },
    },
  ],
};

describe('buildCreateSyncJob', function () {
  test('writes job, tasks, and a per-task enqueued event in one statement', function () {
    const compiled = buildCreateSyncJob(trx, createInput).compile();
    // All three inserts ride one CTE statement.
    expect(compiled.sql).toContain('sync_job');
    expect(compiled.sql).toContain('sync_task');
    expect(compiled.sql).toContain('sync_task_event');
    // The enqueued event type is a bound parameter.
    expect(compiled.parameters).toContain('enqueued');
    // org_id is written explicitly (RLS USING-only).
    expect(compiled.sql).toContain('org_id');
    expect(compiled.parameters).toContain('org-1');
  });

  test('the supplied ids become bound parameters (in-memory id == persisted id)', function () {
    const compiled = buildCreateSyncJob(trx, createInput).compile();
    expect(compiled.parameters).toContain('job-1');
    expect(compiled.parameters).toContain('task-1');
  });
});

describe('buildPersistEvent', function () {
  test('inserts one sync_task_event with org_id explicit', function () {
    const compiled = buildPersistEvent(trx, {
      orgId: 'org-1',
      userId: 'user-1',
      taskId: 'task-1',
      type: 'progress',
      payload: { processed: 3 },
    }).compile();
    expect(compiled.sql).toContain('sync_task_event');
    expect(compiled.sql).toContain('org_id');
    expect(compiled.parameters).toContain('progress');
  });
});

describe('buildPersistMessageCore', function () {
  const messageInput: PersistMessageInput = {
    orgId: 'org-1',
    userId: 'user-1',
    providerAccountId: 'pa-1',
    taskId: 'task-1',
    raw: {
      orgId: 'org-1',
      userId: 'user-1',
      providerAccountId: 'pa-1',
      channel: 'email',
      externalMessageId: 'ext-1',
      payloadSchema: 'gmail.v1',
      payload: {},
    } as PersistMessageInput['raw'],
    message: {
      channel: 'email',
      externalMessageId: 'ext-1',
      sentAt: new Date(0),
      receivedAt: null,
      subject: 'hi',
      snippet: null,
      bodyText: 'body',
      bodyHtml: null,
      inReplyTo: null,
      references: null,
      messageIdHeader: null,
    } as PersistMessageInput['message'],
    participants: [],
    attachments: [],
  };

  test('raw, message, and the message event ride one CTE statement', function () {
    const compiled = buildPersistMessageCore(trx, messageInput).compile();
    // All three writes are CTEs in a single statement.
    expect(compiled.sql).toContain('message_raw');
    expect(compiled.sql).toContain('"message"');
    expect(compiled.sql).toContain('sync_task_event');
    // Idempotency anchor: ON CONFLICT DO NOTHING on the raw insert.
    expect(compiled.sql).toContain('on conflict');
    expect(compiled.sql).toContain('do nothing');
    // The message event type is bound.
    expect(compiled.parameters).toContain('message');
  });
});
