import { describe, expect, spyOn, test } from 'bun:test';
import { AdapterError } from '@repel/backend-adapters/error';
import type {
  AdapterEvent,
  IProviderAdapter,
  IngestInput,
  NormalizedMessage,
} from '@repel/backend-adapters/types';
import { SyncIncompleteError, SyncNormalizationError } from '../error';
import {
  type RunSyncJobDeps,
  type SyncTaskContext,
  runSyncJob,
} from '../handler';
import type { SyncJob, SyncTask } from '../types';

function makeNormalized(
  participants: number,
  attachments: number
): NormalizedMessage {
  return {
    externalThreadId: 't-1',
    externalMessageId: 'm-1',
    participants: Array.from({ length: participants }, function () {
      return {} as never;
    }),
    attachments: Array.from({ length: attachments }, function () {
      return {} as never;
    }),
  } as never;
}

function adapterYielding(events: readonly AdapterEvent[]): IProviderAdapter {
  return {
    capabilities: {
      channel: 'email',
      canSend: false,
      canReceive: true,
      ingressMode: 'poll',
    },
    auth: { method: 'oauth2' } as IProviderAdapter['auth'],
    ingest: async function* () {
      for (const ev of events) {
        yield ev;
      }
    },
    send: async function () {
      throw new Error('unused');
    },
    normalize: function () {
      throw new Error('unused');
    },
  };
}

function makeTask(id: string, providerAccountId: string): SyncTask {
  return { id, providerAccountId, spec: { type: 'full', limit: 5 } };
}

function makeJob(tasks: readonly SyncTask[]): SyncJob {
  return { id: 'job-1', orgId: 'org-1', userId: 'user-9', tasks };
}

function contextFor(adapter: IProviderAdapter): SyncTaskContext {
  return { adapter, ingestInput: {} as IngestInput };
}

describe('runSyncJob', function () {
  test('drives resolveTaskContext and ingest once per task, preserving task ids', async function () {
    const logSpy = spyOn(console, 'log').mockImplementation(function () {});
    const seenTaskIds: string[] = [];
    let ingestCalls = 0;
    try {
      const job = makeJob([makeTask('t-a', 'pa-1'), makeTask('t-b', 'pa-2')]);
      const deps: RunSyncJobDeps = {
        resolveTaskContext: async function (task: SyncTask) {
          seenTaskIds.push(task.id);
          const adapter: IProviderAdapter = {
            ...adapterYielding([]),
            ingest: async function* () {
              ingestCalls += 1;
              yield { type: 'completed', cursor: 'c', processed: 0 };
            },
          };
          return contextFor(adapter);
        },
      };
      await runSyncJob(job, deps);
    } finally {
      logSpy.mockRestore();
    }
    expect(seenTaskIds).toEqual(['t-a', 't-b']);
    expect(ingestCalls).toBe(2);
  });

  test('aggregates one result per task with taskId/processed/cursor', async function () {
    const logSpy = spyOn(console, 'log').mockImplementation(function () {});
    let results: readonly {
      taskId: string;
      processed: number;
      cursor: unknown;
    }[] = [];
    try {
      const job = makeJob([makeTask('t-a', 'pa-1'), makeTask('t-b', 'pa-2')]);
      const byTask: Record<string, AdapterEvent[]> = {
        't-a': [{ type: 'completed', cursor: 'cur-a', processed: 3 }],
        't-b': [{ type: 'completed', cursor: 'cur-b', processed: 7 }],
      };
      const deps: RunSyncJobDeps = {
        resolveTaskContext: async function (task: SyncTask) {
          return contextFor(adapterYielding(byTask[task.id]!));
        },
      };
      results = await runSyncJob(job, deps);
    } finally {
      logSpy.mockRestore();
    }
    expect(results).toEqual([
      { taskId: 't-a', processed: 3, cursor: 'cur-a' },
      { taskId: 't-b', processed: 7, cursor: 'cur-b' },
    ]);
  });

  test('logs started, auth (refreshed=false), progress, message, completed to stdout', async function () {
    const logSpy = spyOn(console, 'log').mockImplementation(function () {});
    let logged: string[] = [];
    try {
      const job = makeJob([makeTask('t-a', 'pa-1')]);
      const deps: RunSyncJobDeps = {
        resolveTaskContext: async function () {
          return contextFor(
            adapterYielding([
              { type: 'started', estimatedTotal: 10 },
              { type: 'auth', refreshed: false },
              { type: 'progress', processed: 5, estimatedTotal: 10 },
              {
                type: 'message',
                raw: { externalMessageId: 'm-1' } as never,
                normalized: makeNormalized(2, 1),
                attachments: [],
              },
              { type: 'completed', cursor: 'c', processed: 5 },
            ])
          );
        },
      };
      await runSyncJob(job, deps);
      logged = logSpy.mock.calls.map(function (c) {
        return c.map(String).join(' ');
      });
    } finally {
      logSpy.mockRestore();
    }
    const joined = logged.join('\n');
    expect(joined).toContain('sync run: started (estimatedTotal=10)');
    expect(joined).toContain(
      'sync run: auth successful; token refreshed=false'
    );
    expect(joined).toContain('sync run: progress processed=5');
    expect(joined).toContain(
      'sync run: message m-1 participants=2 attachments=1'
    );
    expect(joined).toContain('sync run: completed processed=5');
  });

  test('logs two message events with independent counts', async function () {
    const logSpy = spyOn(console, 'log').mockImplementation(function () {});
    let messageLogs = 0;
    try {
      const job = makeJob([makeTask('t-a', 'pa-1')]);
      const deps: RunSyncJobDeps = {
        resolveTaskContext: async function () {
          return contextFor(
            adapterYielding([
              {
                type: 'message',
                raw: { externalMessageId: 'm-1' } as never,
                normalized: makeNormalized(2, 1),
                attachments: [],
              },
              {
                type: 'message',
                raw: { externalMessageId: 'm-2' } as never,
                normalized: makeNormalized(3, 0),
                attachments: [],
              },
              { type: 'completed', cursor: null, processed: 2 },
            ])
          );
        },
      };
      await runSyncJob(job, deps);
      messageLogs = logSpy.mock.calls.filter(function (c) {
        return c.map(String).join(' ').includes('message');
      }).length;
    } finally {
      logSpy.mockRestore();
    }
    expect(messageLogs).toBe(2);
  });

  test('rejects with SyncNormalizationError when a message carries normalized:null', async function () {
    const logSpy = spyOn(console, 'log').mockImplementation(function () {});
    let caught: unknown;
    try {
      const job = makeJob([makeTask('t-a', 'pa-1')]);
      const deps: RunSyncJobDeps = {
        resolveTaskContext: async function () {
          return contextFor(
            adapterYielding([
              {
                type: 'message',
                raw: { externalMessageId: 'raw-id-42' } as never,
                normalized: null,
                attachments: [],
              },
              { type: 'completed', cursor: 'c', processed: 1 },
            ])
          );
        },
      };
      await runSyncJob(job, deps);
    } catch (e) {
      caught = e;
    } finally {
      logSpy.mockRestore();
    }
    expect(caught).toBeInstanceOf(SyncNormalizationError);
  });

  test('rejects with the adapter error when a stream ends in failed', async function () {
    const logSpy = spyOn(console, 'log').mockImplementation(function () {});
    let caught: unknown;
    const adapterErr = new (class extends AdapterError {})('sync failed');
    try {
      const job = makeJob([makeTask('t-a', 'pa-1')]);
      const deps: RunSyncJobDeps = {
        resolveTaskContext: async function () {
          return contextFor(
            adapterYielding([
              { type: 'started' },
              { type: 'failed', error: adapterErr },
            ])
          );
        },
      };
      await runSyncJob(job, deps);
    } catch (e) {
      caught = e;
    } finally {
      logSpy.mockRestore();
    }
    expect(caught).toBe(adapterErr);
  });

  test('rejects with SyncIncompleteError when a stream ends without a terminal event', async function () {
    const logSpy = spyOn(console, 'log').mockImplementation(function () {});
    let caught: unknown;
    try {
      const job = makeJob([makeTask('t-a', 'pa-1')]);
      const deps: RunSyncJobDeps = {
        resolveTaskContext: async function () {
          const adapter: IProviderAdapter = {
            ...adapterYielding([]),
            ingest: async function* () {
              yield { type: 'started' } as AdapterEvent;
              yield { type: 'auth', refreshed: false } as AdapterEvent;
              yield {
                type: 'message',
                raw: { externalMessageId: 'm-1' } as never,
                normalized: makeNormalized(1, 0),
                attachments: [],
              } as AdapterEvent;
            },
          };
          return contextFor(adapter);
        },
      };
      await runSyncJob(job, deps);
    } catch (e) {
      caught = e;
    } finally {
      logSpy.mockRestore();
    }
    expect(caught).toBeInstanceOf(SyncIncompleteError);
  });

  test('never leaks token material; auth line shows the refreshed flag only', async function () {
    const logSpy = spyOn(console, 'log').mockImplementation(function () {});
    let logged = '';
    try {
      const job = makeJob([makeTask('t-a', 'pa-1')]);
      const deps: RunSyncJobDeps = {
        resolveTaskContext: async function () {
          return contextFor(
            adapterYielding([
              {
                type: 'auth',
                refreshed: true,
                credentials: {
                  provider: 'gmail',
                  tokens: {
                    accessToken: 'tok-secret',
                    refreshToken: 'r-secret',
                    expiresAt: 1,
                    tokenType: 'Bearer',
                  },
                },
              },
              { type: 'completed', cursor: 'c', processed: 0 },
            ])
          );
        },
      };
      await runSyncJob(job, deps);
      logged = logSpy.mock.calls
        .map(function (c) {
          return c.map(String).join(' ');
        })
        .join('\n');
    } finally {
      logSpy.mockRestore();
    }
    expect(logged).not.toContain('tok-secret');
    expect(logged).not.toContain('r-secret');
    expect(logged).not.toContain('accessToken');
    expect(logged).toContain('refreshed=true');
  });

  test('rejects on an unknown event type (exhaustiveness guard)', async function () {
    const logSpy = spyOn(console, 'log').mockImplementation(function () {});
    let caught: unknown;
    try {
      const job = makeJob([makeTask('t-a', 'pa-1')]);
      const deps: RunSyncJobDeps = {
        resolveTaskContext: async function () {
          const adapter: IProviderAdapter = {
            ...adapterYielding([]),
            ingest: async function* () {
              yield { type: 'bogus' } as unknown as AdapterEvent;
            },
          };
          return contextFor(adapter);
        },
      };
      await runSyncJob(job, deps);
    } catch (e) {
      caught = e;
    } finally {
      logSpy.mockRestore();
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toContain('bogus');
  });
});
