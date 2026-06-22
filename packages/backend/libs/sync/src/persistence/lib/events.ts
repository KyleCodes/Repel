import type {
  AdapterAuthEvent,
  AdapterCompletedEvent,
  AdapterProgressEvent,
  AdapterStartedEvent,
} from '@repel/backend-adapters/types';
import { SyncEventType, type SyncEventTypeSlug } from '@repel/enums';
import { syncService } from '../service';

// Typed constructors over syncService.persistEvent. Each takes the adapter event
// variant it logs and projects it to the sync_task_event row payload — callers
// never assemble the DB row or pick the type slug by hand. The projection is
// lossy on purpose: auth drops the rotated credentials, failed keeps only the
// message. The message event is not here — it writes a graph (see persistMessage).

export interface EventScope {
  orgId: string;
  userId: string;
  taskId: string;
}

function write(
  scope: EventScope,
  type: SyncEventTypeSlug,
  payload: unknown
): Promise<unknown> {
  return syncService.persistEvent({
    orgId: scope.orgId,
    userId: scope.userId,
    taskId: scope.taskId,
    type,
    payload,
  });
}

export function createStartedEvent(
  scope: EventScope,
  event: AdapterStartedEvent
): Promise<unknown> {
  const { estimatedTotal } = event;
  return write(
    scope,
    SyncEventType.started,
    estimatedTotal === undefined ? null : { estimatedTotal }
  );
}

export function createAuthEvent(
  scope: EventScope,
  event: AdapterAuthEvent
): Promise<unknown> {
  return write(scope, SyncEventType.auth, { refreshed: event.refreshed });
}

export function createProgressEvent(
  scope: EventScope,
  event: AdapterProgressEvent
): Promise<unknown> {
  return write(scope, SyncEventType.progress, { processed: event.processed });
}

export function createCompletedEvent(
  scope: EventScope,
  event: AdapterCompletedEvent
): Promise<unknown> {
  return write(scope, SyncEventType.completed, {
    cursor: event.cursor,
    processed: event.processed,
  });
}

// Widened past AdapterFailedEvent so the executor's catch (which holds a plain
// Error, not an adapter event) can use the same constructor.
export function createFailedEvent(
  scope: EventScope,
  event: { error: { message: string } }
): Promise<unknown> {
  return write(scope, SyncEventType.failed, { error: event.error.message });
}
