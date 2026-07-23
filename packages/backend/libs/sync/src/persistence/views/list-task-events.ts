import type { SyncTaskEvent } from '@repel/backend-db/prisma/client';
import type { Tx } from '@repel/backend-db/types';

export type ListTaskEventsInput = {
  syncTask: { id: string };
};

// The raw event log for one task, oldest first — the audit trail. Unlike
// get-sync-task-results (which collapses the log to the latest event per type
// via DISTINCT ON), this keeps every row: the full ordered history a caller
// drills into. RLS scopes to the current org; the taskId predicate narrows to
// the one task.

export type TaskEventRow = Pick<
  SyncTaskEvent,
  'type' | 'createdAt' | 'payload'
>;

export async function listTaskEvents(
  trx: Tx,
  input: ListTaskEventsInput
): Promise<TaskEventRow[]> {
  return trx.syncTaskEvent.findMany({
    select: { type: true, createdAt: true, payload: true },
    where: { taskId: input.syncTask.id },
    orderBy: { createdAt: 'asc' },
  });
}
