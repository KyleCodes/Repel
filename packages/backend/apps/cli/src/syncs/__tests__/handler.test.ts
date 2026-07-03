import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { Command } from 'commander';
import type { SyncJob, SyncJobResult } from '@repel/backend-sync/types';
import { logger } from '@repel/logger/logger';
import {
  SyncJobNotFoundError,
  SyncRunLimitUnboundedError,
  SyncRunNoCursorError,
  SyncRunRangeBoundsError,
} from '../error';
import {
  type SyncRunDeps,
  registerSyncsCommands,
  runSyncFull,
  runSyncIncremental,
  runSyncRange,
  runSyncsList,
  runSyncsShow,
} from '../handler';
import {
  SyncRunFullInputSchema,
  SyncRunRangeInputSchema,
} from '../schemas/index';

describe('registerSyncsCommands', function () {
  test('registers the syncs namespace with run/list/show + tasks subcommands', function () {
    const program = new Command();
    registerSyncsCommands(program);
    const syncs = program.commands.find(function (c) {
      return c.name() === 'syncs';
    });
    expect(syncs).toBeDefined();
    const subNames = syncs!.commands.map(function (c) {
      return c.name();
    });
    expect(subNames).toContain('run');
    expect(subNames).toContain('list');
    expect(subNames).toContain('show');
    expect(subNames).toContain('tasks');

    const run = syncs!.commands.find(function (c) {
      return c.name() === 'run';
    });
    // The shared options live on the parent `run` command; the mode-specific
    // flags live on its subcommands.
    const runOptions = run!.options.map((o) => o.long);
    expect(runOptions).toContain('--account');
    expect(runOptions).toContain('--org');
    expect(runOptions).toContain('--user');
    expect(runOptions).toContain('--enqueue');

    const modeOptions = (mode: string): (string | undefined)[] => {
      const sub = run!.commands.find((c) => c.name() === mode);
      expect(sub).toBeDefined();
      return sub!.options.map((o) => o.long);
    };
    // full carries the cap flags; the shared flags do NOT repeat on it.
    expect(modeOptions('full')).toEqual(['--limit', '--unbounded']);
    expect(modeOptions('incremental')).toEqual(['--since', '--cursor']);
    expect(modeOptions('range')).toEqual(['--from', '--to']);
  });
});

describe('per-mode input schemas', function () {
  test('full coerces a string limit to a positive int', function () {
    expect(SyncRunFullInputSchema.parse({ limit: '20' }).limit).toBe(20);
  });

  test('full rejects a non-positive limit', function () {
    expect(SyncRunFullInputSchema.safeParse({ limit: '0' }).success).toBe(
      false
    );
  });

  test('range accepts ISO bounds and rejects an unparseable one', function () {
    expect(
      SyncRunRangeInputSchema.safeParse({ from: '2026-01-01T00:00:00Z' })
        .success
    ).toBe(true);
    expect(
      SyncRunRangeInputSchema.safeParse({ from: 'not-a-date' }).success
    ).toBe(false);
  });
});

// The per-mode runners: REPEL_ORG_ID / REPEL_USER_ID are set so resolveOrgId/
// resolveUserId succeed; resolveAccount, runSyncJob, and getLatestCompletedCursor
// are injected so no DB/adapter is touched.

let originalOrg: string | undefined;
let originalUser: string | undefined;

beforeEach(function () {
  originalOrg = process.env.REPEL_ORG_ID;
  originalUser = process.env.REPEL_USER_ID;
  process.env.REPEL_ORG_ID = 'org-1';
  process.env.REPEL_USER_ID = 'user-1';
});

afterEach(function () {
  if (originalOrg === undefined) delete process.env.REPEL_ORG_ID;
  else process.env.REPEL_ORG_ID = originalOrg;
  if (originalUser === undefined) delete process.env.REPEL_USER_ID;
  else process.env.REPEL_USER_ID = originalUser;
});

const jobResult: SyncJobResult = {
  jobId: 'job-1',
  status: 'completed',
  tasks: [
    {
      taskId: 'task-1',
      providerAccountId: 'pa-1',
      status: 'completed',
      processed: 5,
      cursor: { lastInternalDate: '2026-07-02T04:50:07.000Z' },
    },
  ],
};

const SHARED = { org: undefined, user: undefined, enqueue: false };

// Capture the job the runner would run in-process, driving through the shared
// tail (resolveAccount → createSyncJob → runSyncJob). Returns the captured job so
// tests can assert its spec.
function captureRunnerDeps(accountId = 'pa-1'): {
  deps: SyncRunDeps;
  captured: { job?: SyncJob };
} {
  const captured: { job?: SyncJob } = {};
  const deps: SyncRunDeps = {
    resolveAccount: async () => ({ id: accountId }) as never,
    createSyncJob: async (job) => job as never,
    runSyncJob: async (job) => {
      captured.job = job;
      return jobResult;
    },
  };
  return { deps, captured };
}

describe('runSyncFull', function () {
  test('builds a capped full-sync job, writes the skeleton, and prints the summary', async function () {
    const writeSpy = spyOn(process.stdout, 'write').mockReturnValue(true);
    let skeletonJob: SyncJob | undefined;
    let receivedJob: SyncJob | undefined;
    let enqueueCalled = false;
    let printed = '';
    try {
      await runSyncFull(
        { ...SHARED, account: 'work' },
        { limit: 20, unbounded: false },
        {
          resolveAccount: async () => ({ id: 'pa-1' }) as never,
          createSyncJob: async (job) => {
            skeletonJob = job;
            return job as never;
          },
          runSyncJob: async (job) => {
            receivedJob = job;
            return jobResult;
          },
          enqueue: async () => {
            enqueueCalled = true;
            return { enqueued: true, id: 'x' };
          },
        }
      );
      printed = String(writeSpy.mock.calls[0]![0]);
    } finally {
      writeSpy.mockRestore();
    }

    expect(receivedJob!.orgId).toBe('org-1');
    expect(receivedJob!.userId).toBe('user-1');
    expect(receivedJob!.tasks).toHaveLength(1);
    expect(receivedJob!.tasks[0]!.providerAccountId).toBe('pa-1');
    expect(receivedJob!.tasks[0]!.spec).toEqual({ type: 'full', limit: 20 });
    expect(skeletonJob).toBe(receivedJob!);
    expect(enqueueCalled).toBe(false);
    expect(JSON.parse(printed)).toEqual(jobResult as never);
  });

  test('applies the default cap when neither --limit nor --unbounded is given', async function () {
    const writeSpy = spyOn(process.stdout, 'write').mockReturnValue(true);
    const { deps, captured } = captureRunnerDeps('pa-2');
    try {
      await runSyncFull(
        { ...SHARED, account: 'work' },
        { unbounded: false },
        deps
      );
    } finally {
      writeSpy.mockRestore();
    }
    expect(captured.job!.tasks[0]!.spec).toEqual({ type: 'full', limit: 100 });
  });

  test('--unbounded omits the cap from the spec (whole-mailbox pull)', async function () {
    const writeSpy = spyOn(process.stdout, 'write').mockReturnValue(true);
    const { deps, captured } = captureRunnerDeps('pa-3');
    try {
      await runSyncFull(
        { ...SHARED, account: 'work' },
        { unbounded: true },
        deps
      );
    } finally {
      writeSpy.mockRestore();
    }
    expect(captured.job!.tasks[0]!.spec).toEqual({ type: 'full' });
  });

  test('--limit and --unbounded together throw SyncRunLimitUnboundedError', async function () {
    let caught: unknown;
    try {
      await runSyncFull(
        { ...SHARED, account: 'work' },
        { limit: 20, unbounded: true }
      );
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(SyncRunLimitUnboundedError);
  });

  test('a failed sync result sets a non-zero exit code and logs an error', async function () {
    const writeSpy = spyOn(process.stdout, 'write').mockReturnValue(true);
    const errorLog = spyOn(logger, 'error').mockReturnValue(undefined);
    const priorExit = process.exitCode;
    try {
      const failedResult: SyncJobResult = {
        jobId: 'job-1',
        status: 'failed',
        tasks: [
          {
            taskId: 'task-1',
            providerAccountId: 'pa-1',
            status: 'failed',
            processed: 0,
            cursor: null,
            error: 'HTTP 403 quota',
          },
        ],
      };
      await runSyncFull(
        { ...SHARED, account: 'work' },
        { unbounded: false },
        {
          resolveAccount: async () => ({ id: 'pa-1' }) as never,
          createSyncJob: async (j) => j as never,
          runSyncJob: async () => failedResult,
        }
      );
      expect(process.exitCode).toBe(1);
      expect(errorLog).toHaveBeenCalled();
    } finally {
      // Restore, coercing undefined → 0: assigning `undefined` does not clear an
      // exit code the runtime has already latched, which would fail the suite.
      process.exitCode = priorExit ?? 0;
      errorLog.mockRestore();
      writeSpy.mockRestore();
    }
  });

  test('a completed sync result leaves the exit code unchanged', async function () {
    const writeSpy = spyOn(process.stdout, 'write').mockReturnValue(true);
    const priorExit = process.exitCode;
    const { deps } = captureRunnerDeps();
    try {
      await runSyncFull(
        { ...SHARED, account: 'work' },
        { unbounded: false },
        deps
      );
      expect(process.exitCode).toBe(priorExit);
    } finally {
      writeSpy.mockRestore();
    }
  });

  test('--enqueue writes the skeleton, enqueues, and prints { enqueued, jobId } without running', async function () {
    const writeSpy = spyOn(process.stdout, 'write').mockReturnValue(true);
    let skeletonJob: SyncJob | undefined;
    let ranSync = false;
    let enqueued:
      | {
          topic: string;
          payload: unknown;
          opts: { orgId: string; dedupKey?: string };
        }
      | undefined;
    let printed = '';
    try {
      await runSyncFull(
        { ...SHARED, account: 'work', enqueue: true },
        { limit: 5, unbounded: false },
        {
          resolveAccount: async () => ({ id: 'pa-1' }) as never,
          createSyncJob: async (job) => {
            skeletonJob = job;
            return job as never;
          },
          runSyncJob: async () => {
            ranSync = true;
            return jobResult;
          },
          enqueue: async (topic, payload, opts) => {
            enqueued = { topic, payload, opts };
            return { enqueued: true, id: 'ignored' };
          },
        }
      );
      printed = String(writeSpy.mock.calls[0]![0]);
    } finally {
      writeSpy.mockRestore();
    }

    // Skeleton written; sync NOT run in-process; one envelope on the sync topic.
    expect(skeletonJob).toBeDefined();
    expect(ranSync).toBe(false);
    expect(enqueued!.topic).toBe('sync');
    expect(enqueued!.opts.orgId).toBe('org-1');
    expect(enqueued!.opts.dedupKey).toBe(skeletonJob!.id);
    const payload = enqueued!.payload as {
      id: string;
      userId: string;
      orgId: string;
      tasks: unknown[];
    };
    expect(payload.id).toBe(skeletonJob!.id);
    expect(payload.userId).toBe('user-1');
    expect(payload.orgId).toBe('org-1');
    expect(payload.tasks).toHaveLength(1);
    expect(JSON.parse(printed)).toEqual({
      enqueued: true,
      jobId: skeletonJob!.id,
    });
  });
});

describe('runSyncRange', function () {
  test('builds a range spec from --from / --to', async function () {
    const writeSpy = spyOn(process.stdout, 'write').mockReturnValue(true);
    const { deps, captured } = captureRunnerDeps();
    try {
      await runSyncRange(
        { ...SHARED, account: 'work' },
        { from: '2026-01-01T00:00:00Z', to: '2026-02-01T00:00:00Z' },
        deps
      );
    } finally {
      writeSpy.mockRestore();
    }
    expect(captured.job!.tasks[0]!.spec).toEqual({
      type: 'range',
      from: '2026-01-01T00:00:00Z',
      to: '2026-02-01T00:00:00Z',
    });
  });

  test('omits the absent bound (only --from given)', async function () {
    const writeSpy = spyOn(process.stdout, 'write').mockReturnValue(true);
    const { deps, captured } = captureRunnerDeps();
    try {
      await runSyncRange(
        { ...SHARED, account: 'work' },
        { from: '2026-01-01T00:00:00Z' },
        deps
      );
    } finally {
      writeSpy.mockRestore();
    }
    expect(captured.job!.tasks[0]!.spec).toEqual({
      type: 'range',
      from: '2026-01-01T00:00:00Z',
    });
  });

  test('throws SyncRunRangeBoundsError when neither bound is given', async function () {
    let caught: unknown;
    try {
      await runSyncRange({ ...SHARED, account: 'work' }, {});
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(SyncRunRangeBoundsError);
  });
});

describe('runSyncIncremental', function () {
  test('auto-resumes from the account latest completed cursor', async function () {
    const writeSpy = spyOn(process.stdout, 'write').mockReturnValue(true);
    const { deps, captured } = captureRunnerDeps('pa-9');
    let cursorArg:
      | { orgId: string; providerAccount: { id: string } }
      | undefined;
    try {
      await runSyncIncremental(
        { ...SHARED, account: 'work' },
        {},
        {
          ...deps,
          getLatestCompletedCursor: async (arg) => {
            cursorArg = arg;
            return { cursor: { lastInternalDate: '2026-07-02T04:50:07.000Z' } };
          },
        }
      );
    } finally {
      writeSpy.mockRestore();
    }
    // The read is scoped to the resolved account and current org.
    expect(cursorArg!.orgId).toBe('org-1');
    expect(cursorArg!.providerAccount.id).toBe('pa-9');
    expect(captured.job!.tasks[0]!.spec).toEqual({
      type: 'incremental',
      cursor: { lastInternalDate: '2026-07-02T04:50:07.000Z' },
    });
  });

  test('--since overrides the stored cursor, shaping a lastInternalDate', async function () {
    const writeSpy = spyOn(process.stdout, 'write').mockReturnValue(true);
    const { deps, captured } = captureRunnerDeps();
    let readCalled = false;
    try {
      await runSyncIncremental(
        { ...SHARED, account: 'work' },
        { since: '2026-06-01T00:00:00Z' },
        {
          ...deps,
          getLatestCompletedCursor: async () => {
            readCalled = true;
            return undefined;
          },
        }
      );
    } finally {
      writeSpy.mockRestore();
    }
    // The override short-circuits the stored-cursor read.
    expect(readCalled).toBe(false);
    expect(captured.job!.tasks[0]!.spec).toEqual({
      type: 'incremental',
      cursor: { lastInternalDate: '2026-06-01T00:00:00Z' },
    });
  });

  test('--cursor overrides with raw parsed JSON', async function () {
    const writeSpy = spyOn(process.stdout, 'write').mockReturnValue(true);
    const { deps, captured } = captureRunnerDeps();
    try {
      await runSyncIncremental(
        { ...SHARED, account: 'work' },
        { cursor: '{"lastInternalDate":"2026-05-05T00:00:00.000Z"}' },
        deps
      );
    } finally {
      writeSpy.mockRestore();
    }
    expect(captured.job!.tasks[0]!.spec).toEqual({
      type: 'incremental',
      cursor: { lastInternalDate: '2026-05-05T00:00:00.000Z' },
    });
  });

  test('throws SyncRunNoCursorError when there is nothing to resume from', async function () {
    let caught: unknown;
    try {
      await runSyncIncremental(
        { ...SHARED, account: 'work' },
        {},
        {
          resolveAccount: async () => ({ id: 'pa-1' }) as never,
          getLatestCompletedCursor: async () => undefined,
        }
      );
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(SyncRunNoCursorError);
  });
});

const jobSummary = {
  jobId: 'job-1',
  userId: 'user-1',
  status: 'completed' as const,
  taskCount: 1,
  processed: 5,
  createdAt: new Date(0),
};

describe('runSyncsList', function () {
  test('prints the light job summaries the service returns', async function () {
    const writeSpy = spyOn(process.stdout, 'write').mockReturnValue(true);
    let listArg: { orgId: string } | undefined;
    let printed = '';
    try {
      await runSyncsList(
        { org: undefined, user: undefined },
        {
          listSyncJobs: async function (arg) {
            listArg = arg;
            return [jobSummary] as never;
          },
        }
      );
      printed = String(writeSpy.mock.calls[0]![0]);
    } finally {
      writeSpy.mockRestore();
    }
    // Org from REPEL_ORG_ID scopes the read.
    expect(listArg!.orgId).toBe('org-1');
    // The handler JSON-stringifies, so Date fields land as ISO strings — compare
    // against the same roundtrip rather than the live Date fixture.
    expect(JSON.parse(printed)).toEqual(
      JSON.parse(JSON.stringify([jobSummary]))
    );
  });
});

describe('runSyncsShow', function () {
  test('prints the nested job result when the job exists', async function () {
    const writeSpy = spyOn(process.stdout, 'write').mockReturnValue(true);
    let printed = '';
    try {
      await runSyncsShow(
        { org: undefined, jobId: 'job-1' },
        {
          listSyncJobs: async function () {
            return [jobSummary] as never;
          },
          getSyncJobResult: async function () {
            return jobResult as never;
          },
        }
      );
      printed = String(writeSpy.mock.calls[0]![0]);
    } finally {
      writeSpy.mockRestore();
    }
    expect(JSON.parse(printed)).toEqual(jobResult as never);
  });

  test('throws SyncJobNotFoundError for an unknown job id', async function () {
    const writeSpy = spyOn(process.stdout, 'write').mockReturnValue(true);
    let getCalled = false;
    let caught: unknown;
    try {
      await runSyncsShow(
        { org: undefined, jobId: 'nope' },
        {
          listSyncJobs: async function () {
            return [jobSummary] as never;
          },
          getSyncJobResult: async function () {
            getCalled = true;
            return jobResult as never;
          },
        }
      );
    } catch (e) {
      caught = e;
    } finally {
      writeSpy.mockRestore();
    }
    expect(caught).toBeInstanceOf(SyncJobNotFoundError);
    // Unknown job short-circuits before the fold read and prints nothing.
    expect(getCalled).toBe(false);
    expect(writeSpy).not.toHaveBeenCalled();
  });
});
