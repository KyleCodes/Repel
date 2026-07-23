import { Prisma } from '@repel/backend-db/prisma/client';
import type { SyncTaskEvent } from '@repel/backend-db/prisma/client';
import type { SyncEventType } from '@repel/backend-db/prisma/enums';
import type { Tx } from '@repel/backend-db/types';

// One non-message event for the log (started/auth/progress/completed/failed —
// the message event has its own mutation). payload is opaque at this layer (a
// completed event's cursor is unknown JSON). An absent payload is stored as
// SQL NULL via Prisma.DbNull — the sentinel the query API requires to
// distinguish a NULL column from a JSON null value.

export type PersistEventInput = {
  orgId: string;
  userId: string;
  taskId: string;
  type: SyncEventType;
  payload: unknown;
};

export type PersistEventResult = SyncTaskEvent;

export async function persistEvent(
  trx: Tx,
  input: PersistEventInput
): Promise<PersistEventResult> {
  return trx.syncTaskEvent.create({
    data: {
      orgId: input.orgId,
      userId: input.userId,
      taskId: input.taskId,
      type: input.type,
      payload:
        input.payload == null
          ? Prisma.DbNull
          : (input.payload as Prisma.InputJsonValue),
    },
  });
}
