import { describe, expect, test } from 'bun:test';
import type { Tx } from '@repel/backend-db/types';
import { getSyncTaskResults } from '../get-sync-task-results';

// Behavioral tests of the event-log fold: fetch is ORM, derivation is app
// code, so the unit under test is the fold — latest-per-type, terminal
// resolution, payload field extraction — driven through a fake Tx.

function makeFakeTx(fixture: {
  tasks: Array<{ id: string; jobId: string; providerAccountId: string }>;
  events: Array<{
    taskId: string;
    type: string;
    payload: unknown;
    createdAt: Date;
  }>;
}) {
  let capturedWhere: Record<string, unknown> | undefined;
  const trx = {
    syncTask: {
      findMany: async () => fixture.tasks,
    },
    syncTaskEvent: {
      findMany: async (args: { where: Record<string, unknown> }) => {
        capturedWhere = args.where;
        return [...fixture.events].sort(
          (a, b) => a.createdAt.getTime() - b.createdAt.getTime()
        );
      },
    },
  } as unknown as Tx;
  return { trx, where: () => capturedWhere! };
}

const at = (s: number) => new Date(2026, 0, 1, 0, 0, s);
const task = { id: 'task-1', jobId: 'job-1', providerAccountId: 'pa-1' };

describe('getSyncTaskResults', function () {
  test('excludes high-volume message events from the fetch', async function () {
    const { trx, where } = makeFakeTx({ tasks: [task], events: [] });
    await getSyncTaskResults(trx, { syncTask: { jobId: 'job-1' } });
    const typeFilter = where().type as { in: string[] };
    expect(typeFilter.in).not.toContain('message');
    expect(typeFilter.in).toEqual(
      expect.arrayContaining(['started', 'progress', 'completed', 'failed'])
    );
  });

  test('a completed run: status, processed and cursor from the completed payload', async function () {
    const { trx } = makeFakeTx({
      tasks: [task],
      events: [
        { taskId: 'task-1', type: 'started', payload: null, createdAt: at(1) },
        {
          taskId: 'task-1',
          type: 'progress',
          payload: { processed: 5 },
          createdAt: at(2),
        },
        {
          taskId: 'task-1',
          type: 'completed',
          payload: { processed: 9, cursor: { historyId: '42' } },
          createdAt: at(3),
        },
      ],
    });
    const [row] = await getSyncTaskResults(trx, {
      syncTask: { jobId: 'job-1' },
    });
    expect(row).toMatchObject({
      taskId: 'task-1',
      status: 'completed',
      processed: 9,
      cursor: { historyId: '42' },
      startedAt: at(1),
      completedAt: at(3),
      error: null,
    });
  });

  test('a running task (no terminal event) falls back to the progress count', async function () {
    const { trx } = makeFakeTx({
      tasks: [task],
      events: [
        { taskId: 'task-1', type: 'started', payload: null, createdAt: at(1) },
        {
          taskId: 'task-1',
          type: 'progress',
          payload: { processed: 3 },
          createdAt: at(2),
        },
      ],
    });
    const [row] = await getSyncTaskResults(trx, {
      syncTask: { jobId: 'job-1' },
    });
    expect(row).toMatchObject({
      status: 'running',
      processed: 3,
      completedAt: null,
      cursor: null,
    });
  });

  test('completion after an earlier failure: terminal is the newer event, error still reported', async function () {
    const { trx } = makeFakeTx({
      tasks: [task],
      events: [
        {
          taskId: 'task-1',
          type: 'failed',
          payload: { error: 'rate limited' },
          createdAt: at(1),
        },
        {
          taskId: 'task-1',
          type: 'completed',
          payload: { processed: 7 },
          createdAt: at(2),
        },
      ],
    });
    const [row] = await getSyncTaskResults(trx, {
      syncTask: { jobId: 'job-1' },
    });
    // error reads from the latest failed event even when the run completed.
    expect(row).toMatchObject({
      status: 'completed',
      processed: 7,
      error: 'rate limited',
      completedAt: at(2),
    });
  });

  test('the latest event per type wins', async function () {
    const { trx } = makeFakeTx({
      tasks: [task],
      events: [
        {
          taskId: 'task-1',
          type: 'progress',
          payload: { processed: 1 },
          createdAt: at(1),
        },
        {
          taskId: 'task-1',
          type: 'progress',
          payload: { processed: 8 },
          createdAt: at(5),
        },
      ],
    });
    const [row] = await getSyncTaskResults(trx, {
      syncTask: { jobId: 'job-1' },
    });
    expect(row!.processed).toBe(8);
  });

  test('a task with no events at all is running with zero progress', async function () {
    const { trx } = makeFakeTx({ tasks: [task], events: [] });
    const [row] = await getSyncTaskResults(trx, {
      syncTask: { jobId: 'job-1' },
    });
    expect(row).toMatchObject({
      status: 'running',
      processed: 0,
      startedAt: null,
      completedAt: null,
      error: null,
    });
  });
});
