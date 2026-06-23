import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { Command } from 'commander';
import { SyncTaskNotFoundError } from '../../error';
import { registerSyncsCommands } from '../../handler';
import {
  registerTasksCommands,
  runTasksEvents,
  runTasksList,
  runTasksShow,
} from '../handler';

let originalOrg: string | undefined;

beforeEach(function () {
  originalOrg = process.env.REPEL_ORG_ID;
  process.env.REPEL_ORG_ID = 'org-1';
});

afterEach(function () {
  if (originalOrg === undefined) delete process.env.REPEL_ORG_ID;
  else process.env.REPEL_ORG_ID = originalOrg;
});

describe('registerTasksCommands', function () {
  test('hangs tasks list/show/events off the syncs command', function () {
    const syncs = new Command('syncs');
    registerTasksCommands(syncs);
    const tasks = syncs.commands.find(function (c) {
      return c.name() === 'tasks';
    });
    expect(tasks).toBeDefined();
    const leafNames = tasks!.commands.map(function (c) {
      return c.name();
    });
    expect(leafNames).toContain('list');
    expect(leafNames).toContain('show');
    expect(leafNames).toContain('events');
  });

  test('the parent handler wires tasks under syncs', function () {
    const program = new Command();
    registerSyncsCommands(program);
    const syncs = program.commands.find((c) => c.name() === 'syncs');
    expect(syncs!.commands.some((c) => c.name() === 'tasks')).toBe(true);
  });
});

const taskRow = {
  taskId: 'task-1',
  jobId: 'job-1',
  providerAccountId: 'pa-1',
  status: 'completed' as const,
  processed: 5,
  cursor: { historyId: '9' },
  startedAt: new Date(0),
  completedAt: new Date(1),
  error: null,
};

describe('runTasksList', function () {
  test('prints the task rows for the job, org-scoped', async function () {
    const writeSpy = spyOn(process.stdout, 'write').mockReturnValue(true);
    let arg: { orgId: string; syncTask: { jobId: string } } | undefined;
    let printed = '';
    try {
      await runTasksList(
        { org: undefined, jobId: 'job-1' },
        {
          getSyncTaskResults: async function (a) {
            arg = a;
            return [taskRow] as never;
          },
        }
      );
      printed = String(writeSpy.mock.calls[0]![0]);
    } finally {
      writeSpy.mockRestore();
    }
    expect(arg!.orgId).toBe('org-1');
    expect(arg!.syncTask.jobId).toBe('job-1');
    // Date fields land as ISO strings through JSON.stringify — compare roundtrips.
    expect(JSON.parse(printed)).toEqual(JSON.parse(JSON.stringify([taskRow])));
  });
});

describe('runTasksShow', function () {
  test('prints the one task when it belongs to the job', async function () {
    const writeSpy = spyOn(process.stdout, 'write').mockReturnValue(true);
    let printed = '';
    try {
      await runTasksShow(
        { org: undefined, jobId: 'job-1', taskId: 'task-1' },
        {
          getSyncTaskResult: async function () {
            return taskRow as never;
          },
        }
      );
      printed = String(writeSpy.mock.calls[0]![0]);
    } finally {
      writeSpy.mockRestore();
    }
    expect(JSON.parse(printed)).toEqual(JSON.parse(JSON.stringify(taskRow)));
  });

  test('throws SyncTaskNotFoundError when the task is not under the job', async function () {
    const writeSpy = spyOn(process.stdout, 'write').mockReturnValue(true);
    let caught: unknown;
    try {
      await runTasksShow(
        { org: undefined, jobId: 'job-1', taskId: 'other' },
        {
          // jobId-scoped lookup returns undefined for a task not under the job.
          getSyncTaskResult: async function () {
            return undefined;
          },
        }
      );
    } catch (e) {
      caught = e;
    } finally {
      writeSpy.mockRestore();
    }
    expect(caught).toBeInstanceOf(SyncTaskNotFoundError);
    expect(writeSpy).not.toHaveBeenCalled();
  });
});

describe('runTasksEvents', function () {
  const eventRows = [
    { type: 'enqueued' as const, createdAt: new Date(0), payload: null },
    {
      type: 'completed' as const,
      createdAt: new Date(2),
      payload: { processed: 5 },
    },
  ];

  test('validates membership then prints the ordered event log', async function () {
    const writeSpy = spyOn(process.stdout, 'write').mockReturnValue(true);
    let eventsArg: { orgId: string; syncTask: { id: string } } | undefined;
    let printed = '';
    try {
      await runTasksEvents(
        { org: undefined, jobId: 'job-1', taskId: 'task-1' },
        {
          getSyncTaskResult: async function () {
            return taskRow as never;
          },
          listTaskEvents: async function (a) {
            eventsArg = a;
            return eventRows as never;
          },
        }
      );
      printed = String(writeSpy.mock.calls[0]![0]);
    } finally {
      writeSpy.mockRestore();
    }
    expect(eventsArg!.orgId).toBe('org-1');
    expect(eventsArg!.syncTask.id).toBe('task-1');
    expect(JSON.parse(printed)).toEqual(JSON.parse(JSON.stringify(eventRows)));
  });

  test('throws SyncTaskNotFoundError without reading events when membership fails', async function () {
    const writeSpy = spyOn(process.stdout, 'write').mockReturnValue(true);
    let eventsRead = false;
    let caught: unknown;
    try {
      await runTasksEvents(
        { org: undefined, jobId: 'job-1', taskId: 'other' },
        {
          getSyncTaskResult: async function () {
            return undefined;
          },
          listTaskEvents: async function () {
            eventsRead = true;
            return [] as never;
          },
        }
      );
    } catch (e) {
      caught = e;
    } finally {
      writeSpy.mockRestore();
    }
    expect(caught).toBeInstanceOf(SyncTaskNotFoundError);
    expect(eventsRead).toBe(false);
    expect(writeSpy).not.toHaveBeenCalled();
  });
});
