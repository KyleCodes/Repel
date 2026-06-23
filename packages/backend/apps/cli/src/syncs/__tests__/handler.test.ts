import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { Command } from 'commander';
import type { SyncJob, SyncJobResult } from '@repel/backend-sync/types';
import { SyncJobNotFoundError, SyncRunFullRequiredError } from '../error';
import {
  registerSyncsCommands,
  runSyncRun,
  runSyncsList,
  runSyncsShow,
} from '../handler';
import { SyncRunInputSchema } from '../schemas/index';

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
    const optionNames = run!.options.map(function (o) {
      return o.long;
    });
    // account is now a flag (was a positional) so support can redrive a sync for
    // a non-dev user's account.
    expect(optionNames).toContain('--account');
    expect(optionNames).toContain('--full');
    expect(optionNames).toContain('--limit');
    expect(optionNames).toContain('--enqueue');
  });
});

describe('SyncRunInputSchema', function () {
  test('coerces a string limit to a positive int', function () {
    const parsed = SyncRunInputSchema.parse({
      account: 'work',
      full: true,
      limit: '20',
    });
    expect(parsed.limit).toBe(20);
  });

  test('defaults full to false when omitted', function () {
    const parsed = SyncRunInputSchema.parse({ account: 'work' });
    expect(parsed.full).toBe(false);
  });

  test('rejects a missing account', function () {
    expect(SyncRunInputSchema.safeParse({ full: true }).success).toBe(false);
  });

  test('rejects a non-positive limit', function () {
    expect(
      SyncRunInputSchema.safeParse({ account: 'w', full: true, limit: '0' })
        .success
    ).toBe(false);
  });
});

// runSyncRun: REPEL_ORG_ID / REPEL_USER_ID are set so resolveOrgId/resolveUserId
// succeed; resolveAccount and runSyncJob are injected so no DB/adapter is touched.

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
      cursor: { historyId: '9' },
    },
  ],
};

describe('runSyncRun', function () {
  test('throws SyncRunFullRequiredError when --full is absent', async function () {
    let caught: unknown;
    try {
      await runSyncRun({ account: 'work', full: false, enqueue: false });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(SyncRunFullRequiredError);
  });

  test('builds a one-task full-sync job, writes the skeleton, and prints the summary', async function () {
    const writeSpy = spyOn(process.stdout, 'write').mockReturnValue(true);
    let receivedJob: SyncJob | undefined;
    let skeletonJob: SyncJob | undefined;
    let enqueueCalled = false;
    let printed = '';
    try {
      await runSyncRun(
        { account: 'work', full: true, limit: 20, enqueue: false },
        {
          resolveAccount: async function () {
            return { id: 'pa-1' } as never;
          },
          createSyncJob: async function (job) {
            skeletonJob = job;
            return job as never;
          },
          runSyncJob: async function (job) {
            receivedJob = job;
            return jobResult;
          },
          enqueue: async function () {
            enqueueCalled = true;
            return { enqueued: true, id: 'x' };
          },
        }
      );
      printed = String(writeSpy.mock.calls[0]![0]);
    } finally {
      writeSpy.mockRestore();
    }

    expect(receivedJob).toBeDefined();
    expect(receivedJob!.orgId).toBe('org-1');
    expect(receivedJob!.userId).toBe('user-1');
    expect(receivedJob!.tasks).toHaveLength(1);
    expect(receivedJob!.tasks[0]!.providerAccountId).toBe('pa-1');
    expect(receivedJob!.tasks[0]!.spec).toEqual({ type: 'full', limit: 20 });
    // The skeleton is written before the run, for the same job the executor gets.
    expect(skeletonJob).toBe(receivedJob!);
    // The default path runs in-process — it does not enqueue.
    expect(enqueueCalled).toBe(false);
    expect(JSON.parse(printed)).toEqual(jobResult as never);
  });

  test('omits limit from the spec when not provided', async function () {
    const writeSpy = spyOn(process.stdout, 'write').mockReturnValue(true);
    let receivedJob: SyncJob | undefined;
    try {
      await runSyncRun(
        { account: 'work', full: true, enqueue: false },
        {
          resolveAccount: async function () {
            return { id: 'pa-2' } as never;
          },
          createSyncJob: async function (job) {
            return job as never;
          },
          runSyncJob: async function (job) {
            receivedJob = job;
            return jobResult;
          },
        }
      );
    } finally {
      writeSpy.mockRestore();
    }
    expect(receivedJob!.tasks[0]!.spec).toEqual({ type: 'full' });
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
      await runSyncRun(
        { account: 'work', full: true, limit: 5, enqueue: true },
        {
          resolveAccount: async function () {
            return { id: 'pa-1' } as never;
          },
          createSyncJob: async function (job) {
            skeletonJob = job;
            return job as never;
          },
          runSyncJob: async function () {
            ranSync = true;
            return jobResult;
          },
          enqueue: async function (topic, payload, opts) {
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
    expect(enqueued).toBeDefined();
    expect(enqueued!.topic).toBe('sync');
    // orgId is the authoritative tenant scope on the envelope wrapper.
    expect(enqueued!.opts.orgId).toBe('org-1');
    expect(enqueued!.opts.dedupKey).toBe(skeletonJob!.id);
    // The payload is the full SyncJob (orgId denormalized in too).
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
    // Output is the enqueue receipt, not a SyncJobResult.
    expect(JSON.parse(printed)).toEqual({
      enqueued: true,
      jobId: skeletonJob!.id,
    });
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
