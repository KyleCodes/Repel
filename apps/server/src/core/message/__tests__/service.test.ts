import { describe, expect, test } from 'bun:test';
import { Channel, MessageDirection } from '@repel/shared';
import type { Repos } from '../../../db/repos.ts';
import type { MessageRow, ThreadRow } from '../../../db/types.ts';
import { withTxContext } from '../../../db/tx.ts';
import { messageService } from '../service.ts';

// In-memory fake of the messages repo. Tracks all calls so tests can assert
// ordering and arguments. Override hooks let individual tests inject
// outcomes for insertMessage / insertMessageRaw without rebuilding the fake.

type Call = { method: string; args: unknown[] };

interface FakeOpts {
  threadByExternalId?: ThreadRow | undefined;
  insertedThread?: ThreadRow;
  insertedMessage?: MessageRow;
  messageById?: MessageRow | undefined;
  messageByExternalId?: MessageRow | undefined;
  listResult?: MessageRow[];
  insertMessageOverride?: (data: unknown) => Promise<MessageRow>;
  insertMessageRawOverride?: (data: unknown) => Promise<void>;
  insertThreadOverride?: (data: unknown) => Promise<ThreadRow>;
}

function buildFakeRepos(opts: FakeOpts = {}) {
  const calls: Call[] = [];
  const threadCounter: Record<string, { count: number; lastMessageAt: Date | null }> = {};

  const messages = {
    async insertMessage(data: unknown): Promise<MessageRow> {
      calls.push({ method: 'insertMessage', args: [data] });
      if (opts.insertMessageOverride) return opts.insertMessageOverride(data);
      if (!opts.insertedMessage) throw new Error('insertedMessage not set');
      return opts.insertedMessage;
    },
    async insertMessageRaw(data: unknown): Promise<void> {
      calls.push({ method: 'insertMessageRaw', args: [data] });
      if (opts.insertMessageRawOverride) return opts.insertMessageRawOverride(data);
    },
    async findMessageById(id: string): Promise<MessageRow | undefined> {
      calls.push({ method: 'findMessageById', args: [id] });
      return opts.messageById;
    },
    async findMessageByExternalId(
      providerAccountId: string,
      externalMessageId: string,
    ): Promise<MessageRow | undefined> {
      calls.push({
        method: 'findMessageByExternalId',
        args: [providerAccountId, externalMessageId],
      });
      return opts.messageByExternalId;
    },
    async listMessagesByAccount(
      providerAccountId: string,
      o: { limit?: number; cursor?: { sentAt: Date; id: string } } = {},
    ): Promise<MessageRow[]> {
      calls.push({ method: 'listMessagesByAccount', args: [providerAccountId, o] });
      return opts.listResult ?? [];
    },
    async findThreadByExternalId(
      orgId: string,
      channel: string,
      externalThreadId: string,
    ): Promise<ThreadRow | undefined> {
      calls.push({
        method: 'findThreadByExternalId',
        args: [orgId, channel, externalThreadId],
      });
      return opts.threadByExternalId;
    },
    async insertThread(data: unknown): Promise<ThreadRow> {
      calls.push({ method: 'insertThread', args: [data] });
      if (opts.insertThreadOverride) return opts.insertThreadOverride(data);
      if (!opts.insertedThread) throw new Error('insertedThread not set');
      return opts.insertedThread;
    },
    async incrementThreadCounter(threadId: string, sentAt: Date): Promise<void> {
      calls.push({ method: 'incrementThreadCounter', args: [threadId, sentAt] });
      const existing = threadCounter[threadId];
      if (!existing) {
        threadCounter[threadId] = { count: 1, lastMessageAt: sentAt };
      } else {
        existing.count += 1;
        if (!existing.lastMessageAt || sentAt > existing.lastMessageAt) {
          existing.lastMessageAt = sentAt;
        }
      }
    },
  };

  const repos = { messages } as unknown as Repos;
  return { repos, calls, threadCounter };
}

const orgId = '00000000-0000-0000-0000-000000000001';
const otherOrgId = '00000000-0000-0000-0000-000000000099';
const providerAccountId = '00000000-0000-0000-0000-000000000010';
const threadId = '00000000-0000-0000-0000-000000000020';
const messageId = '00000000-0000-0000-0000-000000000030';

function makeThreadRow(over: Partial<ThreadRow> = {}): ThreadRow {
  return {
    id: threadId,
    orgId,
    channel: Channel.email,
    externalThreadId: 'gmail-thread-1',
    subject: 'hello',
    lastMessageAt: null,
    messageCount: 0,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...over,
  };
}

function makeMessageRow(over: Partial<MessageRow> = {}): MessageRow {
  return {
    id: messageId,
    orgId,
    threadId,
    providerAccountId,
    channel: Channel.email,
    externalMessageId: 'msg-ext-1',
    senderAddress: 'a@example.com',
    senderName: 'A',
    recipientAddresses: ['b@example.com'],
    ccAddresses: null,
    bccAddresses: null,
    subject: 'hello',
    bodyText: 'body',
    bodyHtml: null,
    direction: MessageDirection.inbound,
    sentAt: new Date('2026-02-01T12:00:00Z'),
    receivedAt: new Date('2026-02-01T12:00:01Z'),
    isRead: false,
    isStarred: false,
    isArchived: false,
    isDeleted: false,
    createdAt: new Date('2026-02-01T12:00:02Z'),
    updatedAt: new Date('2026-02-01T12:00:02Z'),
    ...over,
  };
}

const baseInsertInput = {
  providerAccountId,
  channel: Channel.email,
  externalMessageId: 'msg-ext-1',
  externalThreadId: 'gmail-thread-1',
  senderAddress: 'a@example.com',
  recipientAddresses: ['b@example.com'],
  direction: MessageDirection.inbound,
  sentAt: new Date('2026-02-01T12:00:00Z'),
};

const baseRawPayload = {
  payload: { foo: 'bar' },
  contentType: 'application/json',
};

// ───────────────────────────────────────────────────────────────────────────
// insertMessageWithRaw
// ───────────────────────────────────────────────────────────────────────────

describe('messageService.insertMessageWithRaw', function () {
  test('1: creates a new thread when none exists, then inserts message + raw + counter', async function () {
    const insertedThread = makeThreadRow();
    const insertedMessage = makeMessageRow();
    const { repos, calls } = buildFakeRepos({
      threadByExternalId: undefined,
      insertedThread,
      insertedMessage,
    });

    const result = await withTxContext({ repos, orgId }, function () {
      return messageService.insertMessageWithRaw({
        orgId,
        message: baseInsertInput,
        rawPayload: baseRawPayload,
      });
    });

    expect(result.id).toBe(insertedMessage.id);
    expect(calls.map((c) => c.method)).toEqual([
      'findThreadByExternalId',
      'insertThread',
      'insertMessage',
      'insertMessageRaw',
      'incrementThreadCounter',
    ]);
  });

  test('2: re-uses an existing thread when one matches (no insertThread call)', async function () {
    const existingThread = makeThreadRow();
    const insertedMessage = makeMessageRow();
    const { repos, calls } = buildFakeRepos({
      threadByExternalId: existingThread,
      insertedMessage,
    });

    await withTxContext({ repos, orgId }, function () {
      return messageService.insertMessageWithRaw({
        orgId,
        message: baseInsertInput,
        rawPayload: baseRawPayload,
      });
    });

    const methods = calls.map((c) => c.method);
    expect(methods).toContain('findThreadByExternalId');
    expect(methods).not.toContain('insertThread');
    expect(methods).toEqual([
      'findThreadByExternalId',
      'insertMessage',
      'insertMessageRaw',
      'incrementThreadCounter',
    ]);
  });

  test('3: passes orgId, channel, threadId on the inserted message', async function () {
    const existingThread = makeThreadRow();
    const insertedMessage = makeMessageRow();
    const { repos, calls } = buildFakeRepos({
      threadByExternalId: existingThread,
      insertedMessage,
    });

    await withTxContext({ repos, orgId }, function () {
      return messageService.insertMessageWithRaw({
        orgId,
        message: baseInsertInput,
        rawPayload: baseRawPayload,
      });
    });

    const insertCall = calls.find((c) => c.method === 'insertMessage');
    expect(insertCall).toBeDefined();
    const data = insertCall!.args[0] as Record<string, unknown>;
    expect(data.orgId).toBe(orgId);
    expect(data.threadId).toBe(existingThread.id);
    expect(data.channel).toBe(Channel.email);
    expect(data.providerAccountId).toBe(providerAccountId);
    expect(data.externalMessageId).toBe('msg-ext-1');
  });

  test('4: writes message_raw with the inserted message id and payload', async function () {
    const existingThread = makeThreadRow();
    const insertedMessage = makeMessageRow();
    const { repos, calls } = buildFakeRepos({
      threadByExternalId: existingThread,
      insertedMessage,
    });

    await withTxContext({ repos, orgId }, function () {
      return messageService.insertMessageWithRaw({
        orgId,
        message: baseInsertInput,
        rawPayload: baseRawPayload,
      });
    });

    const rawCall = calls.find((c) => c.method === 'insertMessageRaw');
    expect(rawCall).toBeDefined();
    const data = rawCall!.args[0] as Record<string, unknown>;
    expect(data.messageId).toBe(insertedMessage.id);
    expect(data.payload).toEqual(baseRawPayload.payload);
    expect(data.contentType).toBe(baseRawPayload.contentType);
  });

  test('5: increments thread counter with the message sentAt', async function () {
    const existingThread = makeThreadRow();
    const insertedMessage = makeMessageRow();
    const { repos, calls, threadCounter } = buildFakeRepos({
      threadByExternalId: existingThread,
      insertedMessage,
    });

    await withTxContext({ repos, orgId }, function () {
      return messageService.insertMessageWithRaw({
        orgId,
        message: baseInsertInput,
        rawPayload: baseRawPayload,
      });
    });

    const incCall = calls.find((c) => c.method === 'incrementThreadCounter');
    expect(incCall).toBeDefined();
    expect(incCall!.args).toEqual([existingThread.id, baseInsertInput.sentAt]);
    expect(threadCounter[existingThread.id]).toEqual({
      count: 1,
      lastMessageAt: baseInsertInput.sentAt,
    });
  });

  test('6: returns the inserted message mapped to the domain shape', async function () {
    const existingThread = makeThreadRow();
    const insertedMessage = makeMessageRow();
    const { repos } = buildFakeRepos({
      threadByExternalId: existingThread,
      insertedMessage,
    });

    const result = await withTxContext({ repos, orgId }, function () {
      return messageService.insertMessageWithRaw({
        orgId,
        message: baseInsertInput,
        rawPayload: baseRawPayload,
      });
    });

    expect(result).toEqual({
      id: insertedMessage.id,
      orgId: insertedMessage.orgId,
      threadId: insertedMessage.threadId,
      providerAccountId: insertedMessage.providerAccountId,
      channel: insertedMessage.channel,
      externalMessageId: insertedMessage.externalMessageId,
      senderAddress: insertedMessage.senderAddress,
      senderName: insertedMessage.senderName,
      recipientAddresses: insertedMessage.recipientAddresses,
      ccAddresses: insertedMessage.ccAddresses,
      bccAddresses: insertedMessage.bccAddresses,
      subject: insertedMessage.subject,
      bodyText: insertedMessage.bodyText,
      bodyHtml: insertedMessage.bodyHtml,
      direction: insertedMessage.direction,
      sentAt: insertedMessage.sentAt,
      receivedAt: insertedMessage.receivedAt,
      isRead: insertedMessage.isRead,
      isStarred: insertedMessage.isStarred,
      isArchived: insertedMessage.isArchived,
      isDeleted: insertedMessage.isDeleted,
      createdAt: insertedMessage.createdAt,
      updatedAt: insertedMessage.updatedAt,
    });
  });

  test('7: propagates insertMessage errors (no raw insert, no counter bump)', async function () {
    const existingThread = makeThreadRow();
    const { repos, calls } = buildFakeRepos({
      threadByExternalId: existingThread,
      insertMessageOverride: async function () {
        throw new Error('unique violation');
      },
    });

    await expect(
      withTxContext({ repos, orgId }, function () {
        return messageService.insertMessageWithRaw({
          orgId,
          message: baseInsertInput,
          rawPayload: baseRawPayload,
        });
      }),
    ).rejects.toThrow(/unique violation/);

    const methods = calls.map((c) => c.method);
    expect(methods).not.toContain('insertMessageRaw');
    expect(methods).not.toContain('incrementThreadCounter');
  });

  test('8: propagates insertMessageRaw errors (counter not bumped)', async function () {
    const existingThread = makeThreadRow();
    const insertedMessage = makeMessageRow();
    const { repos, calls } = buildFakeRepos({
      threadByExternalId: existingThread,
      insertedMessage,
      insertMessageRawOverride: async function () {
        throw new Error('payload too large');
      },
    });

    await expect(
      withTxContext({ repos, orgId }, function () {
        return messageService.insertMessageWithRaw({
          orgId,
          message: baseInsertInput,
          rawPayload: baseRawPayload,
        });
      }),
    ).rejects.toThrow(/payload too large/);

    expect(calls.map((c) => c.method)).not.toContain('incrementThreadCounter');
  });

  test('9: thread create uses externalThreadId and channel from input', async function () {
    const insertedThread = makeThreadRow();
    const insertedMessage = makeMessageRow();
    const { repos, calls } = buildFakeRepos({
      threadByExternalId: undefined,
      insertedThread,
      insertedMessage,
    });

    await withTxContext({ repos, orgId }, function () {
      return messageService.insertMessageWithRaw({
        orgId,
        message: { ...baseInsertInput, externalThreadId: 'thread-xyz', subject: 'sub' },
        rawPayload: baseRawPayload,
      });
    });

    const insertThreadCall = calls.find((c) => c.method === 'insertThread');
    expect(insertThreadCall).toBeDefined();
    const data = insertThreadCall!.args[0] as Record<string, unknown>;
    expect(data.orgId).toBe(orgId);
    expect(data.channel).toBe(Channel.email);
    expect(data.externalThreadId).toBe('thread-xyz');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// getMessageById
// ───────────────────────────────────────────────────────────────────────────

describe('messageService.getMessageById', function () {
  test('10: returns a row that the repo returns (RLS owns cross-org isolation)', async function () {
    // The fake returns a row that "belongs to" otherOrgId. The service does
    // NOT manually filter — we assert it returns whatever repo returns. In
    // production, RLS filters cross-org rows out before the repo sees them.
    const row = makeMessageRow({ orgId: otherOrgId });
    const { repos } = buildFakeRepos({ messageById: row });

    const result = await withTxContext({ repos, orgId }, function () {
      return messageService.getMessageById({ orgId, id: row.id });
    });

    expect(result.id).toBe(row.id);
    expect(result.orgId).toBe(otherOrgId);
  });

  test('11: throws when repo returns undefined', async function () {
    const { repos } = buildFakeRepos({ messageById: undefined });

    await expect(
      withTxContext({ repos, orgId }, function () {
        return messageService.getMessageById({ orgId, id: messageId });
      }),
    ).rejects.toThrow(/not found/);
  });

  test('12: maps the row to a domain Message', async function () {
    const row = makeMessageRow();
    const { repos } = buildFakeRepos({ messageById: row });

    const result = await withTxContext({ repos, orgId }, function () {
      return messageService.getMessageById({ orgId, id: row.id });
    });

    expect(result.externalMessageId).toBe(row.externalMessageId);
    expect(result.threadId).toBe(row.threadId);
    expect(result.sentAt).toEqual(row.sentAt);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// listMessagesByAccount
// ───────────────────────────────────────────────────────────────────────────

describe('messageService.listMessagesByAccount', function () {
  test('13: passes providerAccountId through to repo', async function () {
    const { repos, calls } = buildFakeRepos({ listResult: [] });

    await withTxContext({ repos, orgId }, function () {
      return messageService.listMessagesByAccount({ orgId, providerAccountId });
    });

    const call = calls.find((c) => c.method === 'listMessagesByAccount');
    expect(call).toBeDefined();
    expect(call!.args[0]).toBe(providerAccountId);
  });

  test('14: forwards limit and cursor opts', async function () {
    const cursor = { sentAt: new Date('2026-01-15T00:00:00Z'), id: messageId };
    const { repos, calls } = buildFakeRepos({ listResult: [] });

    await withTxContext({ repos, orgId }, function () {
      return messageService.listMessagesByAccount({
        orgId,
        providerAccountId,
        limit: 25,
        cursor,
      });
    });

    const call = calls.find((c) => c.method === 'listMessagesByAccount');
    expect(call!.args[1]).toEqual({ limit: 25, cursor });
  });

  test('15: maps each row to a domain Message', async function () {
    const r1 = makeMessageRow({ id: 'm1', externalMessageId: 'e1' });
    const r2 = makeMessageRow({ id: 'm2', externalMessageId: 'e2' });
    const { repos } = buildFakeRepos({ listResult: [r1, r2] });

    const result = await withTxContext({ repos, orgId }, function () {
      return messageService.listMessagesByAccount({ orgId, providerAccountId });
    });

    expect(result.map((m) => m.id)).toEqual(['m1', 'm2']);
    expect(result.map((m) => m.externalMessageId)).toEqual(['e1', 'e2']);
  });

  test('16: returns an empty array when repo returns none', async function () {
    const { repos } = buildFakeRepos({ listResult: [] });

    const result = await withTxContext({ repos, orgId }, function () {
      return messageService.listMessagesByAccount({ orgId, providerAccountId });
    });

    expect(result).toEqual([]);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// getMessageByExternalId
// ───────────────────────────────────────────────────────────────────────────

describe('messageService.getMessageByExternalId', function () {
  test('17: returns null when repo returns undefined', async function () {
    const { repos } = buildFakeRepos({ messageByExternalId: undefined });

    const result = await withTxContext({ repos, orgId }, function () {
      return messageService.getMessageByExternalId({
        orgId,
        providerAccountId,
        externalMessageId: 'nope',
      });
    });

    expect(result).toBeNull();
  });

  test('18: returns mapped Message when repo returns a row', async function () {
    const row = makeMessageRow();
    const { repos, calls } = buildFakeRepos({ messageByExternalId: row });

    const result = await withTxContext({ repos, orgId }, function () {
      return messageService.getMessageByExternalId({
        orgId,
        providerAccountId,
        externalMessageId: row.externalMessageId,
      });
    });

    expect(result).not.toBeNull();
    expect(result!.id).toBe(row.id);
    const call = calls.find((c) => c.method === 'findMessageByExternalId');
    expect(call!.args).toEqual([providerAccountId, row.externalMessageId]);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// getOrCreateThread
// ───────────────────────────────────────────────────────────────────────────

describe('messageService.getOrCreateThread', function () {
  test('19: returns existing thread without inserting (no counter touch)', async function () {
    const existing = makeThreadRow();
    const { repos, calls } = buildFakeRepos({ threadByExternalId: existing });

    const result = await withTxContext({ repos, orgId }, function () {
      return messageService.getOrCreateThread({
        orgId,
        channel: Channel.email,
        externalThreadId: existing.externalThreadId!,
      });
    });

    expect(result.id).toBe(existing.id);
    const methods = calls.map((c) => c.method);
    expect(methods).toEqual(['findThreadByExternalId']);
    expect(methods).not.toContain('insertThread');
    expect(methods).not.toContain('incrementThreadCounter');
  });

  test('20: inserts a new thread when none matches', async function () {
    const inserted = makeThreadRow({ externalThreadId: 'fresh' });
    const { repos, calls } = buildFakeRepos({
      threadByExternalId: undefined,
      insertedThread: inserted,
    });

    const result = await withTxContext({ repos, orgId }, function () {
      return messageService.getOrCreateThread({
        orgId,
        channel: Channel.email,
        externalThreadId: 'fresh',
        subject: 'a subject',
      });
    });

    expect(result.id).toBe(inserted.id);
    const insertCall = calls.find((c) => c.method === 'insertThread');
    expect(insertCall).toBeDefined();
    const data = insertCall!.args[0] as Record<string, unknown>;
    expect(data.orgId).toBe(orgId);
    expect(data.channel).toBe(Channel.email);
    expect(data.externalThreadId).toBe('fresh');
    expect(data.subject).toBe('a subject');
  });

  test('21: maps the returned row to a domain Thread', async function () {
    const existing = makeThreadRow();
    const { repos } = buildFakeRepos({ threadByExternalId: existing });

    const result = await withTxContext({ repos, orgId }, function () {
      return messageService.getOrCreateThread({
        orgId,
        channel: Channel.email,
        externalThreadId: existing.externalThreadId!,
      });
    });

    expect(result).toEqual({
      id: existing.id,
      orgId: existing.orgId,
      channel: existing.channel,
      externalThreadId: existing.externalThreadId,
      subject: existing.subject,
      lastMessageAt: existing.lastMessageAt,
      messageCount: existing.messageCount,
      createdAt: existing.createdAt,
      updatedAt: existing.updatedAt,
    });
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Cross-org guard (parameterized 22, 23) — runInOrgTx must reject mismatches
// ───────────────────────────────────────────────────────────────────────────

interface MethodCase {
  name: string;
  invoke: (orgArg: string) => Promise<unknown>;
}

const methodCases: MethodCase[] = [
  {
    name: 'insertMessageWithRaw',
    invoke: (o) =>
      messageService.insertMessageWithRaw({
        orgId: o,
        message: baseInsertInput,
        rawPayload: baseRawPayload,
      }),
  },
  {
    name: 'getMessageById',
    invoke: (o) => messageService.getMessageById({ orgId: o, id: messageId }),
  },
  {
    name: 'listMessagesByAccount',
    invoke: (o) =>
      messageService.listMessagesByAccount({ orgId: o, providerAccountId }),
  },
  {
    name: 'getMessageByExternalId',
    invoke: (o) =>
      messageService.getMessageByExternalId({
        orgId: o,
        providerAccountId,
        externalMessageId: 'x',
      }),
  },
  {
    name: 'getOrCreateThread',
    invoke: (o) =>
      messageService.getOrCreateThread({
        orgId: o,
        channel: Channel.email,
        externalThreadId: 'x',
      }),
  },
];

for (const m of methodCases) {
  test(`22: refuses cross-org for ${m.name} (ambient runInTx)`, async function () {
    const { repos } = buildFakeRepos();
    await expect(
      withTxContext({ repos, orgId: null }, function () {
        return m.invoke(orgId);
      }),
    ).rejects.toThrow(/cannot call tenant-scoped service inside runInTx/);
  });

  test(`23: refuses cross-org for ${m.name} (different ambient org)`, async function () {
    const { repos } = buildFakeRepos();
    await expect(
      withTxContext({ repos, orgId: otherOrgId }, function () {
        return m.invoke(orgId);
      }),
    ).rejects.toThrow(/refusing to join/);
  });
}

// ───────────────────────────────────────────────────────────────────────────
// 24: ordering — message_raw is written AFTER message insertion succeeds
// ───────────────────────────────────────────────────────────────────────────

test('24: insertMessageRaw is called after insertMessage and before incrementThreadCounter', async function () {
  const existingThread = makeThreadRow();
  const insertedMessage = makeMessageRow();
  const { repos, calls } = buildFakeRepos({
    threadByExternalId: existingThread,
    insertedMessage,
  });

  await withTxContext({ repos, orgId }, function () {
    return messageService.insertMessageWithRaw({
      orgId,
      message: baseInsertInput,
      rawPayload: baseRawPayload,
    });
  });

  const methods = calls.map((c) => c.method);
  const idxInsert = methods.indexOf('insertMessage');
  const idxRaw = methods.indexOf('insertMessageRaw');
  const idxCounter = methods.indexOf('incrementThreadCounter');
  expect(idxInsert).toBeGreaterThanOrEqual(0);
  expect(idxRaw).toBeGreaterThan(idxInsert);
  expect(idxCounter).toBeGreaterThan(idxRaw);
});
