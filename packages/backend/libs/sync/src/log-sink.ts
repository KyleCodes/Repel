import type { AdapterEvent } from '@repel/backend-adapters/types';
import type { SyncContext, SyncEventSink } from './types';

// The v0 default sink: log one line per adapter event to stdout and persist
// nothing. REP-56 replaces this with a sink that writes the message graph. The
// sink owns only its log lines — the machine-readable job summary is the
// caller's (the CLI prints it).
export const logSink: SyncEventSink = {
  onEvent(event: AdapterEvent, ctx: SyncContext): void {
    const tag = `[sync ${ctx.syncTask.id}]`;
    switch (event.type) {
      case 'started':
        console.log(
          `${tag} started${
            event.estimatedTotal === undefined
              ? ''
              : ` estimatedTotal=${event.estimatedTotal}`
          }`
        );
        break;
      case 'auth':
        console.log(`${tag} auth refreshed=${event.refreshed}`);
        break;
      case 'progress':
        console.log(
          `${tag} progress processed=${event.processed}${
            event.estimatedTotal === undefined ? '' : `/${event.estimatedTotal}`
          }`
        );
        break;
      case 'message': {
        const participants = event.normalized?.participants.length ?? 0;
        const attachments = event.attachments.length;
        const subject = event.normalized?.subject ?? '(no subject)';
        console.log(
          `${tag} message participants=${participants} attachments=${attachments} subject="${subject}"`
        );
        break;
      }
      case 'completed':
        console.log(
          `${tag} completed processed=${event.processed} cursor=${JSON.stringify(
            event.cursor
          )}`
        );
        break;
      case 'failed':
        console.log(`${tag} failed error=${event.error.message}`);
        break;
    }
  },
};
