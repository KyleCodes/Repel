import { describe, expect, test } from 'bun:test';
import type { ConsumerHandle } from '@repel/backend-queue/types';
import { createSyncWorkerApp } from '../start';

describe('createSyncWorkerApp', function () {
  test('binds a consumer to the `sync` topic and delegates start()/stop()', async function () {
    let boundTopic: string | undefined;
    let started = 0;
    let stopped = 0;
    const handle: ConsumerHandle = {
      start: async function () {
        started++;
      },
      stop: async function () {
        stopped++;
      },
    };

    const app = createSyncWorkerApp({
      consume: function (topic) {
        boundTopic = topic;
        return handle;
      },
    });

    expect(boundTopic).toBe('sync');
    // stop() is implemented (this is the first RunnableApp to drain).
    expect(typeof app.stop).toBe('function');

    await app.start();
    expect(started).toBe(1);

    await app.stop!();
    expect(stopped).toBe(1);
  });
});
