import type { SyncTaskEvent } from '@repel/backend-db/prisma/client';
import type { SyncEventType } from '@repel/backend-db/prisma/enums';
import type { Tx } from '@repel/backend-db/types';
import { SyncTaskStatus, type SyncTaskStatusSlug } from '@repel/enums';

export type GetSyncTaskResultInput = {
  syncTask: { jobId: string };
};

// Per-task outcome, derived entirely from the sync_task_event log (sync_task
// holds no status/cursor columns). The ORM shape: fetch the lifecycle events
// and fold latest-per-type in app code. The type filter excludes `message`
// events — the high-volume rows — so the fetch stays proportional to task
// count, not mailbox size. error is read from the latest *failed* event, not
// the terminal one — a task can complete after an earlier failure, so
// terminal != failed there. The terminal event is the newest of
// completed|failed, folding both candidates to a single status + completedAt.

type LifecycleEvent = Pick<
  SyncTaskEvent,
  'taskId' | 'type' | 'payload' | 'createdAt'
>;

export type SyncTaskResultRow = {
  taskId: string;
  jobId: string;
  providerAccountId: string;
  processed: number;
  cursor: unknown;
  startedAt: Date | null;
  completedAt: Date | null;
  error: string | null;
  status: SyncTaskStatusSlug;
};

const LIFECYCLE_TYPES = [
  'started',
  'progress',
  'completed',
  'failed',
] satisfies SyncEventType[];

function payloadField(
  payload: LifecycleEvent['payload'],
  key: string
): unknown {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload))
    return undefined;
  return (payload as Record<string, unknown>)[key];
}

function asProcessed(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

export async function getSyncTaskResults(
  trx: Tx,
  input: GetSyncTaskResultInput
): Promise<SyncTaskResultRow[]> {
  const jobId = input.syncTask.jobId;
  const tasks = await trx.syncTask.findMany({
    where: { jobId },
    select: { id: true, jobId: true, providerAccountId: true },
  });
  const events = await trx.syncTaskEvent.findMany({
    where: { task: { jobId }, type: { in: LIFECYCLE_TYPES } },
    orderBy: { createdAt: 'asc' },
    select: { taskId: true, type: true, payload: true, createdAt: true },
  });

  // Ascending order means the last write per (task, type) wins — the app-code
  // equivalent of the previous DISTINCT ON ... ORDER BY created_at DESC.
  const latest = new Map<
    string,
    Partial<Record<SyncEventType, LifecycleEvent>>
  >();
  for (const event of events) {
    const perTask = latest.get(event.taskId) ?? {};
    perTask[event.type] = event;
    latest.set(event.taskId, perTask);
  }

  return tasks.map((task): SyncTaskResultRow => {
    const perTask = latest.get(task.id) ?? {};
    const completed = perTask.completed;
    const failed = perTask.failed;
    const terminal =
      completed && failed
        ? failed.createdAt > completed.createdAt
          ? failed
          : completed
        : (completed ?? failed);

    const status: SyncTaskStatusSlug =
      terminal?.type === 'completed'
        ? SyncTaskStatus.completed
        : terminal?.type === 'failed'
          ? SyncTaskStatus.failed
          : SyncTaskStatus.running;

    return {
      taskId: task.id,
      jobId: task.jobId,
      providerAccountId: task.providerAccountId,
      processed:
        asProcessed(payloadField(completed?.payload ?? null, 'processed')) ??
        asProcessed(
          payloadField(perTask.progress?.payload ?? null, 'processed')
        ) ??
        0,
      cursor: payloadField(completed?.payload ?? null, 'cursor') ?? null,
      startedAt: perTask.started?.createdAt ?? null,
      completedAt: terminal?.createdAt ?? null,
      error:
        (payloadField(perTask.failed?.payload ?? null, 'error') as
          | string
          | undefined) ?? null,
      status,
    };
  });
}
