import type { InferResult } from 'kysely';
import type { Tx } from '@repel/backend-db/types';

export type ListTaskEventsInput = {
  syncTask: { id: string };
};

// The raw event log for one task, oldest first — the audit trail. Unlike
// get-sync-task-results (which collapses the log to the latest event per type
// via distinctOn), this keeps every row: the full ordered history a caller
// drills into. RLS scopes to the current org; the taskId predicate narrows to
// the one task.
export const buildListTaskEvents = (trx: Tx, input: ListTaskEventsInput) =>
  trx
    .selectFrom('syncTaskEvent as e')
    .select([
      'e.type as type',
      'e.createdAt as createdAt',
      'e.payload as payload',
    ])
    .where('e.taskId', '=', input.syncTask.id)
    .orderBy('e.createdAt', 'asc');

export type TaskEventRow = InferResult<
  ReturnType<typeof buildListTaskEvents>
>[number];

export async function listTaskEvents(
  trx: Tx,
  input: ListTaskEventsInput
): Promise<TaskEventRow[]> {
  return buildListTaskEvents(trx, input).execute();
}
