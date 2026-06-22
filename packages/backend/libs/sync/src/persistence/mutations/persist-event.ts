import type { InferResult } from 'kysely';
import type { Json, SyncEventType } from '@repel/backend-db/generated';
import type { Tx } from '@repel/backend-db/types';

// One non-message event for the log (started/auth/progress/completed/failed —
// the message event has its own mutation). payload is opaque at this layer (a
// completed event's cursor is unknown JSON), cast to the jsonb column here.
export type PersistEventInput = {
  orgId: string;
  userId: string;
  taskId: string;
  type: SyncEventType;
  payload: unknown;
};

export function buildPersistEvent(trx: Tx, input: PersistEventInput) {
  return trx
    .insertInto('syncTaskEvent')
    .values({
      orgId: input.orgId,
      userId: input.userId,
      taskId: input.taskId,
      type: input.type,
      payload: input.payload as Json | null,
    })
    .returningAll();
}

export type PersistEventResult = InferResult<
  ReturnType<typeof buildPersistEvent>
>[number];

export async function persistEvent(
  trx: Tx,
  input: PersistEventInput
): Promise<PersistEventResult> {
  return buildPersistEvent(trx, input).executeTakeFirstOrThrow();
}
