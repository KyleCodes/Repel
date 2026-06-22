import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { Command } from 'commander';
import type { SyncJob, SyncJobResult } from '@repel/backend-sync/types';
import { SyncRunFullRequiredError } from '../error';
import { registerSyncCommands, runSyncRun } from '../handler';
import { SyncRunInputSchema } from '../schemas/index';

describe('registerSyncCommands', function () {
  test('registers the sync namespace with a run subcommand', function () {
    const program = new Command();
    registerSyncCommands(program);
    const sync = program.commands.find(function (c) {
      return c.name() === 'sync';
    });
    expect(sync).toBeDefined();
    const run = sync!.commands.find(function (c) {
      return c.name() === 'run';
    });
    expect(run).toBeDefined();
    const optionNames = run!.options.map(function (o) {
      return o.long;
    });
    expect(optionNames).toContain('--full');
    expect(optionNames).toContain('--limit');
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
      await runSyncRun({ account: 'work', full: false });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(SyncRunFullRequiredError);
  });

  test('builds a one-task full-sync job and prints the summary', async function () {
    const writeSpy = spyOn(process.stdout, 'write').mockReturnValue(true);
    let receivedJob: SyncJob | undefined;
    let printed = '';
    try {
      await runSyncRun(
        { account: 'work', full: true, limit: 20 },
        {
          resolveAccount: async function () {
            return { id: 'pa-1' } as never;
          },
          runSyncJob: async function (job) {
            receivedJob = job;
            return jobResult;
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
    expect(JSON.parse(printed)).toEqual(jobResult as never);
  });

  test('omits limit from the spec when not provided', async function () {
    const writeSpy = spyOn(process.stdout, 'write').mockReturnValue(true);
    let receivedJob: SyncJob | undefined;
    try {
      await runSyncRun(
        { account: 'work', full: true },
        {
          resolveAccount: async function () {
            return { id: 'pa-2' } as never;
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
});
