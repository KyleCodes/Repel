import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { Command } from 'commander';
import type { RunnableApp } from '@repel/backend-runtime/application';
import { UnknownServiceError } from '../error';
import {
  drainAndClose,
  registerServicesCommands,
  runServicesRun,
} from '../handler';

describe('registerServicesCommands', function () {
  test('registers the services namespace with a run subcommand and --all', function () {
    const program = new Command();
    registerServicesCommands(program);
    const services = program.commands.find(function (c) {
      return c.name() === 'services';
    });
    expect(services).toBeDefined();
    const run = services!.commands.find(function (c) {
      return c.name() === 'run';
    });
    expect(run).toBeDefined();
    const optionNames = run!.options.map(function (o) {
      return o.long;
    });
    expect(optionNames).toContain('--all');
  });
});

// runServicesRun is driven with injected registry + closeDb + a non-blocking
// waitForShutdown, so no real server boots and the call doesn't hang. Each app's
// start() is a spy resolving immediately (resolve-when-ready, stubbed).

afterEach(function () {
  // nothing global to restore; spies are restored inline
});

function stubApp(): RunnableApp & { start: ReturnType<typeof spyOn> } {
  const app = { start: async function () {} } as never as RunnableApp;
  const start = spyOn(app, 'start');
  return app as never;
}

// The summary is the one raw write whose payload parses to a JSON array; the
// other writes are the logger's JSON-object diagnostic lines.
function findSummaryRow(
  writeSpy: ReturnType<typeof spyOn>
): Array<{ service: string; status: string; elapsedMs: number }> {
  for (const call of writeSpy.mock.calls) {
    try {
      const parsed = JSON.parse(String(call[0]));
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // diagnostic lines are objects or non-JSON; skip
    }
  }
  throw new Error('no summary array was written to stdout');
}

describe('runServicesRun', function () {
  test('boots a single named service and prints its summary row', async function () {
    const writeSpy = spyOn(process.stdout, 'write').mockReturnValue(true);
    const app = stubApp();
    let shutdownClosedDb = false;
    let summary: ReturnType<typeof findSummaryRow>;
    try {
      await runServicesRun(
        { name: 'api', all: false },
        {
          serviceNames: function () {
            return ['api'];
          },
          resolveService: function (name) {
            return name === 'api'
              ? async function () {
                  return app;
                }
              : undefined;
          },
          closeDb: async function () {
            shutdownClosedDb = true;
          },
          // resolve immediately so the call returns instead of waiting for a signal
          waitForShutdown: async function (apps, closeDb) {
            await drainAndClose(apps, closeDb);
          },
        }
      );
      summary = findSummaryRow(writeSpy);
    } finally {
      writeSpy.mockRestore();
    }

    expect(app.start).toHaveBeenCalledTimes(1);
    expect(shutdownClosedDb).toBe(true);
    expect(summary).toHaveLength(1);
    expect(summary[0]!.service).toBe('api');
    expect(summary[0]!.status).toBe('ready');
    expect(typeof summary[0]!.elapsedMs).toBe('number');
  });

  test('--all boots every registered service in one call', async function () {
    const writeSpy = spyOn(process.stdout, 'write').mockReturnValue(true);
    const a = stubApp();
    const b = stubApp();
    const apps: Record<string, RunnableApp> = { api: a, worker: b };
    let summary: ReturnType<typeof findSummaryRow>;
    try {
      await runServicesRun(
        { all: true },
        {
          serviceNames: function () {
            return ['api', 'worker'];
          },
          resolveService: function (name) {
            return apps[name]
              ? async function () {
                  return apps[name]!;
                }
              : undefined;
          },
          closeDb: async function () {},
          waitForShutdown: async function () {},
        }
      );
      summary = findSummaryRow(writeSpy);
    } finally {
      writeSpy.mockRestore();
    }

    expect(a.start).toHaveBeenCalledTimes(1);
    expect(b.start).toHaveBeenCalledTimes(1);
    expect(summary.map((r) => r.service)).toEqual(['api', 'worker']);
  });

  test('throws UnknownServiceError for an unregistered name', async function () {
    let caught: unknown;
    try {
      await runServicesRun(
        { name: 'nope', all: false },
        {
          serviceNames: function () {
            return ['api'];
          },
          resolveService: function () {
            return undefined;
          },
          closeDb: async function () {},
          waitForShutdown: async function () {},
        }
      );
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(UnknownServiceError);
  });
});

describe('drainAndClose', function () {
  test('stops each app before closing the pool, in order', async function () {
    const order: string[] = [];
    const appWithStop = {
      start: async function () {},
      stop: async function () {
        order.push('stop');
      },
    } as RunnableApp;
    let closed = false;
    await drainAndClose([appWithStop], async function () {
      order.push('close');
      closed = true;
    });
    expect(order).toEqual(['stop', 'close']);
    expect(closed).toBe(true);
  });

  test('an app without stop() is a no-op (the api today)', async function () {
    const appNoStop = { start: async function () {} } as RunnableApp;
    let closed = false;
    await drainAndClose([appNoStop], async function () {
      closed = true;
    });
    expect(closed).toBe(true);
  });
});
