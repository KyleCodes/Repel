import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { AdapterError } from '@repel/backend-adapters/error';
import type {
  AdapterEvent,
  NormalizedMessage,
  RawMessage,
} from '@repel/backend-adapters/types';
import { SyncMissingNormalizedError } from '../../error';
import { syncService } from '../../persistence/service';
import type { SyncContext } from '../../types';
import { syncEventHandler } from '../sync-event-handler';

// A concrete AdapterError (it is abstract) for the failed-event test.
class TestAdapterError extends AdapterError {}

const ctx: SyncContext = {
  syncJob: { id: 'job-1', orgId: 'org-1', userId: 'user-1', tasks: [] },
  syncTask: { id: 'task-1', providerAccountId: 'pa-1', spec: { type: 'full' } },
};

// Spy on the service so no DB is touched; capture the calls.
function stubService() {
  const persistEvent = spyOn(syncService, 'persistEvent').mockResolvedValue(
    {} as never
  );
  const persistMessage = spyOn(syncService, 'persistMessage').mockResolvedValue(
    {} as never
  );
  return { persistEvent, persistMessage };
}

afterEach(function () {
  // spyOn auto-restores at module teardown, but be explicit between tests.
  (syncService.persistEvent as ReturnType<typeof spyOn>).mockRestore?.();
  (syncService.persistMessage as ReturnType<typeof spyOn>).mockRestore?.();
});

describe('syncEventHandler — non-message events route to persistEvent', function () {
  test('started carries estimatedTotal when present', async function () {
    const { persistEvent, persistMessage } = stubService();
    await syncEventHandler.handle({ type: 'started', estimatedTotal: 9 }, ctx);
    expect(persistMessage).not.toHaveBeenCalled();
    expect(persistEvent).toHaveBeenCalledTimes(1);
    const arg = persistEvent.mock.calls[0]![0] as {
      orgId: string;
      taskId: string;
      type: string;
      payload: unknown;
    };
    expect(arg.orgId).toBe('org-1');
    expect(arg.taskId).toBe('task-1');
    expect(arg.type).toBe('started');
    expect(arg.payload).toEqual({ estimatedTotal: 9 });
  });

  test('completed carries cursor + processed in the payload', async function () {
    const { persistEvent } = stubService();
    await syncEventHandler.handle(
      { type: 'completed', cursor: { historyId: '42' }, processed: 7 },
      ctx
    );
    const arg = persistEvent.mock.calls[0]![0] as {
      type: string;
      payload: unknown;
    };
    expect(arg.type).toBe('completed');
    expect(arg.payload).toEqual({
      cursor: { historyId: '42' },
      processed: 7,
    });
  });

  test('failed carries the adapter error message', async function () {
    const { persistEvent } = stubService();
    await syncEventHandler.handle(
      { type: 'failed', error: new TestAdapterError('revoked') },
      ctx
    );
    const arg = persistEvent.mock.calls[0]![0] as {
      type: string;
      payload: unknown;
    };
    expect(arg.type).toBe('failed');
    expect(arg.payload).toEqual({ error: 'revoked' });
  });
});

describe('syncEventHandler — message events route to persistMessage', function () {
  const normalized: NormalizedMessage = {
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
    externalThreadId: 'thread-1',
    participants: [{ handle: 'a@b.com', displayName: 'A', role: 'from' }],
    attachments: [],
  } as NormalizedMessage;

  const raw = {
    orgId: 'org-1',
    userId: 'user-1',
    providerAccountId: 'pa-1',
    channel: 'email',
    externalMessageId: 'ext-1',
    payloadSchema: 'gmail.v1',
    payload: {},
  } as RawMessage;

  test('maps the event to a DB-first PersistMessageInput', async function () {
    const { persistMessage, persistEvent } = stubService();
    const event: AdapterEvent = {
      type: 'message',
      raw,
      normalized,
      attachments: [],
    };
    await syncEventHandler.handle(event, ctx);
    expect(persistEvent).not.toHaveBeenCalled();
    expect(persistMessage).toHaveBeenCalledTimes(1);
    const arg = persistMessage.mock.calls[0]![0] as unknown as {
      orgId: string;
      taskId: string;
      participants: readonly unknown[];
      message: Record<string, unknown>;
    };
    expect(arg.orgId).toBe('org-1');
    expect(arg.taskId).toBe('task-1');
    expect(arg.participants).toHaveLength(1);
    // externalThreadId / participants / attachments are stripped off the message body.
    expect('externalThreadId' in arg.message).toBe(false);
    expect('participants' in arg.message).toBe(false);
  });

  test('a null-normalized message throws (v0 contract violation)', async function () {
    const { persistMessage } = stubService();
    let caught: unknown;
    try {
      await syncEventHandler.handle(
        { type: 'message', raw, normalized: null, attachments: [] },
        ctx
      );
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(SyncMissingNormalizedError);
    expect(persistMessage).not.toHaveBeenCalled();
  });
});

describe('syncEventHandler — logging', function () {
  test('still emits a human log line per event', async function () {
    stubService();
    const log = spyOn(console, 'log').mockReturnValue(undefined);
    try {
      await syncEventHandler.handle({ type: 'auth', refreshed: true }, ctx);
      expect(log).toHaveBeenCalledTimes(1);
      expect(String(log.mock.calls[0]![0])).toContain('auth refreshed=true');
    } finally {
      log.mockRestore();
    }
  });
});
