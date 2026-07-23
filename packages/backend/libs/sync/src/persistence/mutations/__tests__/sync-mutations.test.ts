import { describe, expect, test } from 'bun:test';
import {
  type CreateSyncJobValues,
  buildCreateSyncJob,
} from '../create-sync-job';
import { buildPersistEvent } from '../persist-event';
import {
  type PersistMessageInput,
  buildPersistMessageCore,
} from '../persist-message';

// Connection-free: a Prisma.Sql is plain text + bound values, so the SQL-shape
// invariants are asserted with no I/O — the successor of the old
// Kysely .compile() pattern. (persistMessage runs sequential statements, not a
// single builder, so its idempotency is covered by an integration test; here we
// assert the SQL-shape invariants of the single-statement mutations.)

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
    const query = buildCreateSyncJob(createInput);
    // All three inserts ride one CTE statement.
    expect(query.sql).toContain('sync_job');
    expect(query.sql).toContain('sync_task');
    expect(query.sql).toContain('sync_task_event');
    // The enqueued event type is a bound parameter.
    expect(query.values).toContain('enqueued');
    // org_id is written explicitly (RLS USING-only).
    expect(query.sql).toContain('org_id');
    expect(query.values).toContain('org-1');
    // The nested task projection aliases camelCase in-SQL (no plugin anymore).
    expect(query.sql).toContain('"providerAccountId"');
  });

  test('the supplied ids become bound parameters (in-memory id == persisted id)', function () {
    const query = buildCreateSyncJob(createInput);
    expect(query.values).toContain('job-1');
    expect(query.values).toContain('task-1');
  });

  test('the spec is bound stringified and cast to jsonb', function () {
    const query = buildCreateSyncJob(createInput);
    expect(query.sql).toContain('::jsonb');
    expect(query.values).toContain(JSON.stringify({ type: 'full', limit: 20 }));
  });
});

describe('buildPersistEvent', function () {
  test('inserts one sync_task_event with org_id explicit', function () {
    const query = buildPersistEvent({
      orgId: 'org-1',
      userId: 'user-1',
      taskId: 'task-1',
      type: 'progress',
      payload: { processed: 3 },
    });
    expect(query.sql).toContain('sync_task_event');
    expect(query.sql).toContain('org_id');
    expect(query.values).toContain('progress');
  });

  test('a nullish payload binds SQL NULL, not a JSON null sentinel', function () {
    const query = buildPersistEvent({
      orgId: 'org-1',
      userId: 'user-1',
      taskId: 'task-1',
      type: 'started',
      payload: null,
    });
    expect(query.values).toContain(null);
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
    const query = buildPersistMessageCore(messageInput);
    // All three writes are CTEs in a single statement.
    expect(query.sql).toContain('message_raw');
    expect(query.sql).toContain('INSERT INTO message');
    expect(query.sql).toContain('sync_task_event');
    // Idempotency anchor: ON CONFLICT DO NOTHING on the raw insert.
    expect(query.sql).toContain('ON CONFLICT');
    expect(query.sql).toContain('DO NOTHING');
    // The message event type is bound.
    expect(query.values).toContain('message');
  });

  test('resolves the raw id on both branches via a union select-back', function () {
    const query = buildPersistMessageCore(messageInput);
    expect(query.sql).toContain('UNION ALL');
    // The projection aliases camelCase in-SQL for both returned columns.
    expect(query.sql).toContain('"rawMessageId"');
    expect(query.sql).toContain('"messageId"');
  });
});
