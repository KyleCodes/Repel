import type { AdapterEvent } from '@repel/backend-adapters/types';
import { SyncMissingNormalizedError } from '../error';
import {
  type EventScope,
  createAuthEvent,
  createCompletedEvent,
  createFailedEvent,
  createProgressEvent,
  createStartedEvent,
} from '../persistence/lib/events';
import { type PersistMessageInput, syncService } from '../persistence/service';
import type { SyncContext, SyncEventHandler } from '../types';

export const syncEventHandler: SyncEventHandler = {
  async handle(event: AdapterEvent, ctx: SyncContext): Promise<void> {
    const { orgId, userId } = ctx.syncJob;
    const taskId = ctx.syncTask.id;
    const scope: EventScope = { orgId, userId, taskId };
    const tag = `[sync ${taskId}]`;

    switch (event.type) {
      case 'started': {
        const { estimatedTotal } = event;
        console.log(
          `${tag} started${estimatedTotal === undefined ? '' : ` estimatedTotal=${estimatedTotal}`}`
        );
        await createStartedEvent(scope, event);
        break;
      }
      case 'auth': {
        console.log(`${tag} auth refreshed=${event.refreshed}`);
        await createAuthEvent(scope, event);
        break;
      }
      case 'progress': {
        const { processed, estimatedTotal } = event;
        console.log(
          `${tag} progress processed=${processed}${estimatedTotal === undefined ? '' : `/${estimatedTotal}`}`
        );
        await createProgressEvent(scope, event);
        break;
      }
      case 'completed': {
        console.log(
          `${tag} completed processed=${event.processed} cursor=${JSON.stringify(event.cursor)}`
        );
        await createCompletedEvent(scope, event);
        break;
      }
      case 'failed': {
        console.log(`${tag} failed error=${event.error.message}`);
        await createFailedEvent(scope, event);
        break;
      }
      case 'message': {
        // The contract allows a null normalized, but v0 adapters throw a
        // normalize error upstream rather than emit one, so a null here is a
        // contract violation, not a row to skip.
        if (event.normalized === null) {
          throw new SyncMissingNormalizedError(
            `task ${taskId} emitted a message event with no normalized payload`
          );
        }
        // externalThreadId is dropped — v0 leaves message.thread_id null
        // (thread reconciliation is a later ticket).
        const { externalThreadId, participants, attachments, ...message } =
          event.normalized;
        void externalThreadId;
        const bytesByExternalId = new Map(
          event.attachments.map((a) => [a.externalAttachmentId, a.bytes])
        );
        console.log(
          `${tag} message participants=${participants.length} attachments=${attachments.length} subject="${message.subject ?? '(no subject)'}"`
        );
        const input: PersistMessageInput = {
          orgId,
          userId,
          providerAccountId: ctx.syncTask.providerAccountId,
          taskId,
          raw: event.raw,
          message,
          participants,
          attachments: attachments.map((a) => ({
            ...a,
            bytes:
              a.externalAttachmentId == null
                ? Buffer.alloc(0)
                : (bytesByExternalId.get(a.externalAttachmentId) ??
                  Buffer.alloc(0)),
          })),
        };
        await syncService.persistMessage(input);
        break;
      }
    }
  },
};
