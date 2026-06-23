import { describe, expect, spyOn, test } from 'bun:test';
import { AdapterError } from '@repel/backend-adapters/error';
import type {
  AdapterEvent,
  IProviderAdapter,
} from '@repel/backend-adapters/types';
import { syncService } from '../../persistence/service';
import type { SyncContext, SyncEventHandler, SyncJob } from '../../types';
import { type SyncDeps, runSyncJob } from '../handler';

// A no-op syncService seam so any persistence the default handler would do
// touches no DB in these unit tests. (The executor no longer writes the skeleton
// itself — the caller does — but the seam still carries createSyncJob so a test
// can assert the executor leaves it alone; see the "does not write the skeleton"
// test below.)
const noopSyncService = {
  createSyncJob: async () => ({}) as never,
  persistMessage: async () => ({}) as never,
  persistEvent: async () => ({}) as never,
  getSyncTaskResults: async () => [] as never,
  getSyncJobResult: async () => ({}) as never,
} satisfies SyncDeps['syncService'];

// Build a full accountsService seam from a partial: methods the test does not
// supply throw if the executor unexpectedly calls them.
function makeAccountsServiceStub(
  overrides: Partial<NonNullable<SyncDeps['accountsService']>>
): NonNullable<SyncDeps['accountsService']> {
  return new Proxy(overrides, {
    get(target, prop, receiver) {
      if (prop in target) return Reflect.get(target, prop, receiver);
      return async () => {
        throw new Error(`accountsService.${String(prop)} called unexpectedly`);
      };
    },
  }) as NonNullable<SyncDeps['accountsService']>;
}

// A no-op handler so the executor delivers events nowhere by default; tests that
// assert on delivery inject a recording handler.
const noopHandler: SyncEventHandler = { handle() {} };

// A concrete AdapterError for the `failed`-event tests (AdapterError is abstract).
class TestAdapterError extends AdapterError {}

// Build a fake adapter whose ingest() yields a canned event stream. Only ingest
// is exercised by the executor; the other members throw if touched.
function makeAdapter(events: AdapterEvent[]): IProviderAdapter {
  return {
    capabilities: {
      channel: 'email',
      canSend: false,
      canReceive: true,
      ingressMode: 'poll',
    },
    auth: { method: 'oauth2' } as IProviderAdapter['auth'],
    ingest: async function* () {
      for (const event of events) yield event;
    },
    send: async function () {
      throw new Error('unused');
    },
    normalize: function () {
      throw new Error('unused');
    },
  };
}

// An adapter whose ingest() throws mid-stream.
function makeThrowingAdapter(error: Error): IProviderAdapter {
  return {
    ...makeAdapter([]),
    ingest: async function* () {
      yield { type: 'started' };
      throw error;
    },
  };
}

const TOKENS = {
  accessToken: 'a',
  refreshToken: 'r',
  expiresAt: 0,
  tokenType: 'Bearer',
};

// A stored-account stub: the service returns a row carrying ciphertext; decrypt
// is stubbed to return the token JSON, so no real key/crypto is needed.
function makeAccount(overrides: Record<string, unknown> = {}) {
  return {
    id: 'pa-1',
    orgId: 'org-1',
    userId: 'user-1',
    provider: 'gmail',
    credentialsEncrypted: Buffer.from('cipher'),
    ...overrides,
  } as never;
}

// Default deps: a service that returns a gmail account, a decrypt that yields the
// canned token set, and the adapter under test. Individual tests override pieces.
function makeDeps(
  adapter: IProviderAdapter,
  overrides: Partial<SyncDeps> = {}
): SyncDeps {
  return {
    accountsService: makeAccountsServiceStub({
      getProviderAccount: async function () {
        return makeAccount();
      },
    }),
    resolveProviderAdapter: function () {
      return adapter;
    },
    decrypt: function () {
      return Buffer.from(JSON.stringify(TOKENS), 'utf8');
    },
    loadEncryptionKey: function () {
      return Buffer.alloc(32);
    },
    syncService: noopSyncService,
    handler: noopHandler,
    ...overrides,
  };
}

function job(tasks: SyncJob['tasks']): SyncJob {
  return { id: 'job-1', orgId: 'org-1', userId: 'user-1', tasks };
}

const oneTask = [
  { id: 'task-1', providerAccountId: 'pa-1', spec: { type: 'full' as const } },
];

describe('runSyncJob — happy path', function () {
  test('a completed stream yields a completed task with processed and cursor', async function () {
    const adapter = makeAdapter([
      { type: 'started' },
      { type: 'auth', refreshed: true },
      {
        type: 'message',
        raw: {} as never,
        normalized: null,
        attachments: [],
      },
      { type: 'progress', processed: 1 },
      { type: 'completed', cursor: { historyId: '99' }, processed: 1 },
    ]);
    const result = await runSyncJob(job(oneTask), makeDeps(adapter));

    expect(result.status).toBe('completed');
    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0]!.status).toBe('completed');
    expect(result.tasks[0]!.processed).toBe(1);
    expect(result.tasks[0]!.cursor).toEqual({ historyId: '99' });
    expect(result.tasks[0]!.taskId).toBe('task-1');
  });

  test('does not write the skeleton (the caller owns createSyncJob)', async function () {
    // REP-57 relocated the skeleton write out of the executor: the enqueuer (or
    // the in-process verb) calls createSyncJob before runSyncJob, so the executor
    // must never call it (a second insert on the same sync_job.id is a dup-PK).
    const createSyncJob = spyOn(
      { createSyncJob: noopSyncService.createSyncJob },
      'createSyncJob'
    );
    const adapter = makeAdapter([
      { type: 'completed', cursor: null, processed: 0 },
    ]);
    await runSyncJob(
      job(oneTask),
      makeDeps(adapter, {
        syncService: { ...noopSyncService, createSyncJob },
      })
    );
    expect(createSyncJob).not.toHaveBeenCalled();
  });

  test('every event reaches the handler in order with the right context', async function () {
    const seen: Array<{ type: string; ctx: SyncContext }> = [];
    const recordingHandler: SyncEventHandler = {
      handle(event, ctx) {
        seen.push({ type: event.type, ctx });
      },
    };
    const adapter = makeAdapter([
      { type: 'started' },
      { type: 'auth', refreshed: false },
      { type: 'completed', cursor: null, processed: 0 },
    ]);
    const theJob = job(oneTask);
    await runSyncJob(theJob, makeDeps(adapter, { handler: recordingHandler }));

    expect(seen.map((s) => s.type)).toEqual(['started', 'auth', 'completed']);
    // The context carries the job + task objects, not a denormalized copy.
    expect(seen[0]!.ctx.syncJob).toBe(theJob);
    expect(seen[0]!.ctx.syncTask).toBe(theJob.tasks[0]!);
    expect(seen[0]!.ctx.syncJob.orgId).toBe('org-1');
    expect(seen[0]!.ctx.syncTask.providerAccountId).toBe('pa-1');
  });

  test('the decrypted credential is passed to the adapter opaquely (no re-tagging)', async function () {
    let received: { providerSlug: unknown; credentials: unknown } | undefined;
    const adapter: IProviderAdapter = {
      ...makeAdapter([{ type: 'completed', cursor: null, processed: 0 }]),
      ingest: async function* (input) {
        received = input as typeof received;
        yield { type: 'completed', cursor: null, processed: 0 };
      },
    };
    await runSyncJob(job(oneTask), makeDeps(adapter));

    // The slug comes off the resolved account row; the credential is the bare
    // parsed token set, handed through untouched (not wrapped in {provider,tokens}).
    expect(received?.providerSlug).toBe('gmail');
    expect(received?.credentials).toEqual(TOKENS);
  });
});

describe('runSyncJob — failure isolation', function () {
  test('a thrown ingest becomes a failed task, not a thrown job', async function () {
    const adapter = makeThrowingAdapter(new Error('boom'));
    const result = await runSyncJob(job(oneTask), makeDeps(adapter));

    expect(result.status).toBe('failed');
    expect(result.tasks[0]!.status).toBe('failed');
    expect(result.tasks[0]!.error).toBe('boom');
  });

  test('a thrown ingest persists a terminal failed event (so derived status is correct)', async function () {
    // The adapter emits no `failed` event, so without this the log would end at
    // `started` and the derived status would stay `running`. The executor writes
    // the failed event itself via createFailedEvent, which calls the module
    // syncService directly — spy on it rather than the injectable seam.
    const persistEvent = spyOn(syncService, 'persistEvent').mockResolvedValue(
      {} as never
    );
    try {
      const adapter = makeThrowingAdapter(new Error('refresh failed'));
      await runSyncJob(job(oneTask), makeDeps(adapter));

      const calls = persistEvent.mock.calls.map(
        (c) => c[0] as { type: string; payload: { error?: string } | null }
      );
      const failed = calls.find((e) => e.type === 'failed');
      expect(failed).toBeDefined();
      expect(failed!.payload?.error).toBe('refresh failed');
    } finally {
      persistEvent.mockRestore();
    }
  });

  test('a stream with no terminal event fails as incomplete', async function () {
    const adapter = makeAdapter([
      { type: 'started' },
      { type: 'message', raw: {} as never, normalized: null, attachments: [] },
    ]);
    const result = await runSyncJob(job(oneTask), makeDeps(adapter));

    expect(result.tasks[0]!.status).toBe('failed');
    expect(result.tasks[0]!.error).toContain('without a terminal event');
  });

  test('a terminal failed event surfaces the adapter error message', async function () {
    const adapter = makeAdapter([
      { type: 'started' },
      { type: 'failed', error: new TestAdapterError('revoked token') },
    ]);
    const result = await runSyncJob(job(oneTask), makeDeps(adapter));

    expect(result.tasks[0]!.status).toBe('failed');
    expect(result.tasks[0]!.error).toBe('revoked token');
  });

  test('null stored credentials fail the task without calling decrypt', async function () {
    let decryptCalled = false;
    const adapter = makeAdapter([
      { type: 'completed', cursor: null, processed: 0 },
    ]);
    const result = await runSyncJob(
      job(oneTask),
      makeDeps(adapter, {
        accountsService: makeAccountsServiceStub({
          getProviderAccount: async function () {
            return makeAccount({ credentialsEncrypted: null });
          },
        }),
        decrypt: function () {
          decryptCalled = true;
          return Buffer.from('x');
        },
      })
    );

    expect(result.tasks[0]!.status).toBe('failed');
    expect(result.tasks[0]!.error).toContain('no stored credentials');
    expect(decryptCalled).toBe(false);
  });

  test('one failing task does not abort its sibling (allSettled isolation)', async function () {
    // task-a resolves a good account; task-b resolves an account with no stored
    // credentials, so it fails deterministically (no ordering assumptions).
    const good = makeAdapter([
      { type: 'completed', cursor: { c: 1 }, processed: 2 },
    ]);
    const twoTasks = [
      {
        id: 'task-a',
        providerAccountId: 'pa-a',
        spec: { type: 'full' as const },
      },
      {
        id: 'task-b',
        providerAccountId: 'pa-b',
        spec: { type: 'full' as const },
      },
    ];
    const result = await runSyncJob(
      job(twoTasks),
      makeDeps(good, {
        accountsService: makeAccountsServiceStub({
          getProviderAccount: async function (input: {
            providerAccount: { id: string };
          }) {
            const id = input.providerAccount.id;
            return makeAccount({
              id,
              credentialsEncrypted:
                id === 'pa-b' ? null : Buffer.from('cipher'),
            });
          },
        }),
      })
    );

    expect(result.status).toBe('failed');
    expect(result.tasks).toHaveLength(2);
    const a = result.tasks.find((t) => t.taskId === 'task-a')!;
    const b = result.tasks.find((t) => t.taskId === 'task-b')!;
    expect(a.status).toBe('completed');
    expect(a.processed).toBe(2);
    expect(b.status).toBe('failed');
    expect(b.error).toContain('no stored credentials');
  });
});
