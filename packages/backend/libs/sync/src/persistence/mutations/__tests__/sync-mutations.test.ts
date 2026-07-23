import { describe, expect, test } from 'bun:test';
import { Prisma } from '@repel/backend-db/prisma/client';
import type { Tx } from '@repel/backend-db/types';
import { createSyncJob } from '../create-sync-job';
import { persistEvent } from '../persist-event';
import { type PersistMessageInput, persistMessage } from '../persist-message';

// Behavioral tests against a fake Tx: the mutations are ORM calls now, so the
// unit under test is the orchestration — nested-write shape, the idempotency
// branch, the DbNull sentinel — not SQL text. No database.

describe('createSyncJob', function () {
  test('creates job, tasks, and per-task enqueued events as one nested write', async function () {
    let captured: Record<string, unknown> | undefined;
    const trx = {
      syncJob: {
        create: async (args: { data: Record<string, unknown> }) => {
          captured = args.data;
          return {
            id: 'job-1',
            orgId: 'org-1',
            userId: 'user-1',
            tasks: [{ id: 'task-1', providerAccountId: 'pa-1', spec: {} }],
          };
        },
      },
    } as unknown as Tx;

    const row = await createSyncJob(trx, {
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
    });

    expect(row.id).toBe('job-1');
    const tasks = (captured!.tasks as { create: Record<string, unknown>[] })
      .create;
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.providerAccountId).toBe('pa-1');
    // org_id explicit on every level (RLS USING-only) and the enqueued event
    // nested under its task.
    expect(captured!.orgId).toBe('org-1');
    expect(tasks[0]!.orgId).toBe('org-1');
    const events = (tasks[0]!.events as { create: Record<string, unknown>[] })
      .create;
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe('enqueued');
    expect(events[0]!.orgId).toBe('org-1');
  });
});

describe('persistEvent', function () {
  function capturingTx() {
    let captured: Record<string, unknown> | undefined;
    const trx = {
      syncTaskEvent: {
        create: async (args: { data: Record<string, unknown> }) => {
          captured = args.data;
          return { id: 'evt-1', ...args.data };
        },
      },
    } as unknown as Tx;
    return { trx, data: () => captured! };
  }

  test('passes an object payload through', async function () {
    const { trx, data } = capturingTx();
    await persistEvent(trx, {
      orgId: 'org-1',
      userId: 'user-1',
      taskId: 'task-1',
      type: 'progress',
      payload: { processed: 3 },
    });
    expect(data().payload).toEqual({ processed: 3 });
    expect(data().orgId).toBe('org-1');
  });

  test('stores an absent payload as SQL NULL via the DbNull sentinel', async function () {
    const { trx, data } = capturingTx();
    await persistEvent(trx, {
      orgId: 'org-1',
      userId: 'user-1',
      taskId: 'task-1',
      type: 'started',
      payload: null,
    });
    expect(data().payload).toBe(Prisma.DbNull);
  });
});

describe('persistMessage', function () {
  const input: PersistMessageInput = {
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
    participants: [{ handle: 'a@x.com', displayName: 'A', role: 'from' }],
    attachments: [],
  };

  // The raw insert is an upsert (native ON CONFLICT — a thrown P2002 would
  // abort the ambient Postgres tx, so create-then-catch is not an option).
  // persisted is derived from whether the 1:1 message row already exists.
  function makeFakeTx(behavior: {
    existingMessage: { id: string } | null;
    upsert?: () => Promise<{ id: string }>;
  }) {
    const calls = {
      messageCreate: 0,
      participantRows: 0,
      events: [] as Record<string, unknown>[],
    };
    const trx = {
      messageRaw: {
        upsert: behavior.upsert ?? (async () => ({ id: 'raw-1' })),
      },
      message: {
        findUnique: async () => behavior.existingMessage,
        create: async () => {
          calls.messageCreate += 1;
          return { id: 'msg-1' };
        },
      },
      messageParticipant: {
        createMany: async (args: { data: unknown[] }) => {
          calls.participantRows += args.data.length;
        },
      },
      attachment: {
        createMany: async () => {},
      },
      syncTaskEvent: {
        create: async (args: { data: Record<string, unknown> }) => {
          calls.events.push(args.data);
        },
      },
    } as unknown as Tx;
    return { trx, calls };
  }

  test('fresh message: writes the graph and appends the message event', async function () {
    const { trx, calls } = makeFakeTx({ existingMessage: null });
    const result = await persistMessage(trx, input);
    expect(result).toEqual({ rawMessageId: 'raw-1', persisted: true });
    expect(calls.messageCreate).toBe(1);
    expect(calls.participantRows).toBe(1);
    expect(calls.events).toHaveLength(1);
    expect(calls.events[0]!.rawMessageId).toBe('raw-1');
    expect(calls.events[0]!.type).toBe('message');
  });

  test('resync (raw already has a message): skips the graph but still appends the event', async function () {
    const { trx, calls } = makeFakeTx({ existingMessage: { id: 'msg-1' } });
    const result = await persistMessage(trx, input);
    expect(result).toEqual({ rawMessageId: 'raw-1', persisted: false });
    expect(calls.messageCreate).toBe(0);
    expect(calls.participantRows).toBe(0);
    expect(calls.events).toHaveLength(1);
  });

  test('propagates upsert failures', async function () {
    const { trx } = makeFakeTx({
      existingMessage: null,
      upsert: async () => {
        throw new Error('connection reset');
      },
    });
    await expect(persistMessage(trx, input)).rejects.toThrow(
      'connection reset'
    );
  });
});
