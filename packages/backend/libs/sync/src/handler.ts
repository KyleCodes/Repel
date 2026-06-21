import type {
  AdapterEvent,
  IProviderAdapter,
  IngestInput,
} from '@repel/backend-adapters/types';
import { SyncIncompleteError, SyncNormalizationError } from './error';
import type { SyncJob, SyncTask } from './types';

// What the consumer resolves for a task at execution time: the adapter to drive
// and the (already-typed) ingest input, including decrypted credentials. The job
// itself stays secret-free; secrets are reconstructed here, not carried.
export interface SyncTaskContext {
  readonly adapter: IProviderAdapter;
  readonly ingestInput: IngestInput;
}

export interface RunSyncJobDeps {
  resolveTaskContext(task: SyncTask, job: SyncJob): Promise<SyncTaskContext>;
}

export interface SyncTaskResult {
  readonly taskId: string;
  readonly processed: number;
  readonly cursor: unknown;
}

// Drive every task in a job. Each task resolves its own adapter + input, then we
// consume the adapter's event stream, logging each event to stdout. This is the
// future sync-queue-consumer entrypoint; the CLI is one caller today.
export async function runSyncJob(
  job: SyncJob,
  deps: RunSyncJobDeps
): Promise<readonly SyncTaskResult[]> {
  const results: SyncTaskResult[] = [];

  for (const task of job.tasks) {
    const { adapter, ingestInput } = await deps.resolveTaskContext(task, job);

    let processed: number | undefined;
    let cursor: unknown;
    let completed = false;

    for await (const ev of adapter.ingest(ingestInput)) {
      switch (ev.type) {
        case 'started':
          console.log(
            `sync run: started${ev.estimatedTotal !== undefined ? ` (estimatedTotal=${ev.estimatedTotal})` : ''}`
          );
          break;
        case 'auth':
          // Log ONLY the refreshed flag — never the credentials/token material.
          console.log(
            `sync run: auth successful; token refreshed=${ev.refreshed}`
          );
          break;
        case 'progress':
          console.log(
            `sync run: progress processed=${ev.processed}${ev.estimatedTotal !== undefined ? ` estimatedTotal=${ev.estimatedTotal}` : ''}`
          );
          break;
        case 'message':
          if (ev.normalized === null) {
            throw new SyncNormalizationError(
              `sync run: message ${ev.raw.externalMessageId} failed to normalize`
            );
          }
          console.log(
            `sync run: message ${ev.raw.externalMessageId} participants=${ev.normalized.participants.length} attachments=${ev.normalized.attachments.length}`
          );
          break;
        case 'completed':
          processed = ev.processed;
          cursor = ev.cursor;
          completed = true;
          console.log(`sync run: completed processed=${ev.processed}`);
          break;
        case 'failed':
          throw ev.error;
        default:
          ev satisfies never;
          throw new Error(
            `sync run: unexpected event type ${String((ev as AdapterEvent).type)}`
          );
      }
    }

    // A stream that ends without a terminal `completed` event is a truncated
    // run and must surface as a failure, not a silent success.
    if (!completed) {
      throw new SyncIncompleteError(
        'sync stream ended without a completed event'
      );
    }

    results.push({ taskId: task.id, processed: processed!, cursor });
  }

  return results;
}
