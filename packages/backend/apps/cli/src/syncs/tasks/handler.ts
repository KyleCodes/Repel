import type { Command } from 'commander';
import { syncService as defaultSyncService } from '@repel/backend-sync/service';
import { parseOrExit } from '../../lib/parse-or-exit';
import { resolveOrgId } from '../../lib/resolve-org';
import { SyncTaskNotFoundError } from '../error';
import {
  type TasksEventsInput,
  TasksEventsInputSchema,
  type TasksListInput,
  TasksListInputSchema,
  type TasksShowInput,
  TasksShowInputSchema,
} from './schemas/index';

// Nested `syncs tasks` sub-handler. Mirrors `db migrations` / `db encryption`:
// takes the parent `syncs` Command and hangs the leaf read verbs off it. Each
// leaf takes both <jobId> and <taskId> for REST-path symmetry; the handler
// asserts the task belongs to the job and raises a typed not-found otherwise.

export function registerTasksCommands(syncs: Command): void {
  const tasks = syncs
    .command('tasks')
    .description('Inspect the tasks of a sync job');

  tasks
    .command('list <jobId>')
    .description('List the tasks of a sync job with their derived status')
    .option('--org <id>', 'org id (defaults to REPEL_ORG_ID)')
    .action(async function (jobId: string, opts: { org?: string }) {
      const input = parseOrExit(TasksListInputSchema, { org: opts.org, jobId });
      await runTasksList(input);
    });

  tasks
    .command('show <jobId> <taskId>')
    .description('Show one task of a sync job')
    .option('--org <id>', 'org id (defaults to REPEL_ORG_ID)')
    .action(async function (
      jobId: string,
      taskId: string,
      opts: { org?: string }
    ) {
      const input = parseOrExit(TasksShowInputSchema, {
        org: opts.org,
        jobId,
        taskId,
      });
      await runTasksShow(input);
    });

  tasks
    .command('events <jobId> <taskId>')
    .description('List the event log of one task, oldest first')
    .option('--org <id>', 'org id (defaults to REPEL_ORG_ID)')
    .action(async function (
      jobId: string,
      taskId: string,
      opts: { org?: string }
    ) {
      const input = parseOrExit(TasksEventsInputSchema, {
        org: opts.org,
        jobId,
        taskId,
      });
      await runTasksEvents(input);
    });
}

// Read-verb seams: the service is module-imported, so an optional deps param is
// the contained way to drive these without a real DB (same rationale as the
// parent handler's SyncRunDeps). Production calls pass nothing.
export interface TasksListDeps {
  getSyncTaskResults?: typeof defaultSyncService.getSyncTaskResults;
}

export async function runTasksList(
  input: TasksListInput,
  deps: TasksListDeps = {}
): Promise<void> {
  const getSyncTaskResults =
    deps.getSyncTaskResults ?? defaultSyncService.getSyncTaskResults;

  const orgId = resolveOrgId(input.org);
  const rows = await getSyncTaskResults({
    orgId,
    syncTask: { jobId: input.jobId },
  });
  process.stdout.write(JSON.stringify(rows) + '\n');
}

export interface TasksShowDeps {
  getSyncTaskResult?: typeof defaultSyncService.getSyncTaskResult;
}

export async function runTasksShow(
  input: TasksShowInput,
  deps: TasksShowDeps = {}
): Promise<void> {
  const getSyncTaskResult =
    deps.getSyncTaskResult ?? defaultSyncService.getSyncTaskResult;

  const orgId = resolveOrgId(input.org);
  // getSyncTaskResult is jobId-scoped, so a taskId not under this job comes back
  // undefined — that is the membership check. Map it to a typed not-found.
  const task = await getSyncTaskResult({
    orgId,
    syncTask: { jobId: input.jobId, id: input.taskId },
  });
  if (!task) {
    throw new SyncTaskNotFoundError(
      `sync task not found: ${input.taskId} is not a task of job ${input.jobId}`
    );
  }
  process.stdout.write(JSON.stringify(task) + '\n');
}

export interface TasksEventsDeps {
  getSyncTaskResult?: typeof defaultSyncService.getSyncTaskResult;
  listTaskEvents?: typeof defaultSyncService.listTaskEvents;
}

export async function runTasksEvents(
  input: TasksEventsInput,
  deps: TasksEventsDeps = {}
): Promise<void> {
  const getSyncTaskResult =
    deps.getSyncTaskResult ?? defaultSyncService.getSyncTaskResult;
  const listTaskEvents =
    deps.listTaskEvents ?? defaultSyncService.listTaskEvents;

  const orgId = resolveOrgId(input.org);
  // Validate membership before reading the log: listTaskEvents filters by taskId
  // alone, so without this check `events <jobId> <wrongTaskId>` would return the
  // wrong task's events (or, for an unknown task, an empty array) instead of a
  // not-found.
  const task = await getSyncTaskResult({
    orgId,
    syncTask: { jobId: input.jobId, id: input.taskId },
  });
  if (!task) {
    throw new SyncTaskNotFoundError(
      `sync task not found: ${input.taskId} is not a task of job ${input.jobId}`
    );
  }
  const events = await listTaskEvents({
    orgId,
    syncTask: { id: input.taskId },
  });
  process.stdout.write(JSON.stringify(events) + '\n');
}
