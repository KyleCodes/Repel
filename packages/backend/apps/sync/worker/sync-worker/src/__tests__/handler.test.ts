import { describe, expect, test } from 'bun:test';
import type { Envelope } from '@repel/backend-queue/types';
import type { SyncJob, SyncJobResult } from '@repel/backend-sync/types';
import { makeSyncHandler } from '../handler';

const jobResult: SyncJobResult = {
  jobId: 'job-1',
  status: 'completed',
  tasks: [],
};

function envelope(payload: unknown): Envelope {
  return { topic: 'sync', orgId: 'org-1', payload };
}

describe('syncHandler', function () {
  test('rebuilds the SyncJob from the payload + envelope orgId and delegates to runSyncJob', async function () {
    let received: SyncJob | undefined;
    const handler = makeSyncHandler({
      runSyncJob: async function (job) {
        received = job;
        return jobResult;
      },
    });

    await handler(
      envelope({
        id: 'job-1',
        userId: 'user-1',
        tasks: [
          { id: 'task-1', providerAccountId: 'pa-1', spec: { type: 'full' } },
        ],
      })
    );

    expect(received).toBeDefined();
    expect(received!.id).toBe('job-1');
    // orgId comes off the envelope wrapper, not the payload.
    expect(received!.orgId).toBe('org-1');
    expect(received!.userId).toBe('user-1');
    expect(received!.tasks).toHaveLength(1);
    expect(received!.tasks[0]!.providerAccountId).toBe('pa-1');
    expect(received!.tasks[0]!.spec).toEqual({ type: 'full' });
  });

  test('propagates a runSyncJob failure (so the queue can retry/dead-letter)', async function () {
    const handler = makeSyncHandler({
      runSyncJob: async function () {
        throw new Error('executor boom');
      },
    });

    let caught: unknown;
    try {
      await handler(envelope({ id: 'j', userId: 'u', tasks: [] }));
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe('executor boom');
  });
});
