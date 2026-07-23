import type { SyncTaskEvent } from '@repel/backend-db/prisma/client';
import type { SyncEventType } from '@repel/backend-db/prisma/enums';
import { type Sql, sql } from '@repel/backend-db/sql';
import type { Tx } from '@repel/backend-db/types';

// One non-message event for the log (started/auth/progress/completed/failed —
// the message event has its own mutation). payload is opaque at this layer (a
// completed event's cursor is unknown JSON), stringified into the jsonb
// column here. Raw SQL keeps SQL-NULL semantics for an absent payload — the
// query API would force Prisma's JsonNull/DbNull sentinels into this layer.

export type PersistEventInput = {
  orgId: string;
  userId: string;
  taskId: string;
  type: SyncEventType;
  payload: unknown;
};

export const buildPersistEvent = (input: PersistEventInput): Sql => sql`
  INSERT INTO sync_task_event (org_id, user_id, task_id, type, payload)
  VALUES (${input.orgId}, ${input.userId}, ${input.taskId},
          ${input.type}::sync_event_type,
          ${input.payload == null ? null : JSON.stringify(input.payload)}::jsonb)
  RETURNING id,
            org_id AS "orgId",
            user_id AS "userId",
            task_id AS "taskId",
            type,
            payload,
            raw_message_id AS "rawMessageId",
            created_at AS "createdAt"`;

export type PersistEventResult = SyncTaskEvent;

export async function persistEvent(
  trx: Tx,
  input: PersistEventInput
): Promise<PersistEventResult> {
  const rows = await trx.$queryRaw<PersistEventResult[]>(
    buildPersistEvent(input)
  );
  const row = rows[0];
  if (!row) throw new Error('persistEvent: statement returned no row');
  return row;
}
