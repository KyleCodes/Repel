import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { AdapterError } from '@repel/backend-adapters/error';
import type { AdapterEvent } from '@repel/backend-adapters/types';
import { logSink } from '../log-sink';
import type { SyncContext } from '../types';

class TestAdapterError extends AdapterError {}

const ctx: SyncContext = {
  syncJob: { id: 'job-1', orgId: 'org-1', userId: 'user-1', tasks: [] },
  syncTask: { id: 'task-1', providerAccountId: 'pa-1', spec: { type: 'full' } },
};

let logSpy: ReturnType<typeof spyOn>;
let stdoutSpy: ReturnType<typeof spyOn>;

beforeEach(function () {
  logSpy = spyOn(console, 'log').mockReturnValue(undefined);
  stdoutSpy = spyOn(process.stdout, 'write').mockReturnValue(true);
});

afterEach(function () {
  logSpy.mockRestore();
  stdoutSpy.mockRestore();
});

function lastLine(): string {
  return String(logSpy.mock.calls.at(-1)![0]);
}

describe('logSink', function () {
  test('started logs the task tag', function () {
    logSink.onEvent({ type: 'started' }, ctx);
    expect(lastLine()).toBe('[sync task-1] started');
  });

  test('started includes estimatedTotal when present', function () {
    logSink.onEvent({ type: 'started', estimatedTotal: 42 }, ctx);
    expect(lastLine()).toContain('estimatedTotal=42');
  });

  test('auth logs the refreshed flag', function () {
    logSink.onEvent({ type: 'auth', refreshed: true }, ctx);
    expect(lastLine()).toBe('[sync task-1] auth refreshed=true');
  });

  test('progress logs processed', function () {
    logSink.onEvent({ type: 'progress', processed: 7 }, ctx);
    expect(lastLine()).toContain('progress processed=7');
  });

  test('message logs participant count, attachment count, and subject', function () {
    const event: AdapterEvent = {
      type: 'message',
      raw: {} as never,
      normalized: {
        subject: 'Hello',
        participants: [{}, {}],
        attachments: [],
      } as never,
      attachments: [{ externalAttachmentId: 'a', bytes: Buffer.alloc(1) }],
    };
    logSink.onEvent(event, ctx);
    const line = lastLine();
    expect(line).toContain('participants=2');
    expect(line).toContain('attachments=1');
    expect(line).toContain('subject="Hello"');
  });

  test('message falls back to (no subject) when normalized is null', function () {
    logSink.onEvent(
      { type: 'message', raw: {} as never, normalized: null, attachments: [] },
      ctx
    );
    const line = lastLine();
    expect(line).toContain('participants=0');
    expect(line).toContain('attachments=0');
    expect(line).toContain('subject="(no subject)"');
  });

  test('completed logs processed and cursor', function () {
    logSink.onEvent(
      { type: 'completed', cursor: { historyId: '5' }, processed: 3 },
      ctx
    );
    const line = lastLine();
    expect(line).toContain('completed processed=3');
    expect(line).toContain('cursor={"historyId":"5"}');
  });

  test('failed logs the error message', function () {
    logSink.onEvent(
      { type: 'failed', error: new TestAdapterError('nope') },
      ctx
    );
    expect(lastLine()).toBe('[sync task-1] failed error=nope');
  });

  test('the sink never writes to process.stdout (only console.log)', function () {
    logSink.onEvent({ type: 'started' }, ctx);
    logSink.onEvent({ type: 'completed', cursor: null, processed: 0 }, ctx);
    expect(stdoutSpy).not.toHaveBeenCalled();
  });
});
