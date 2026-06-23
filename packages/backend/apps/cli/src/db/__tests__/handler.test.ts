import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Command } from 'commander';
import { registerDbCommands, runNuke } from '../handler';

describe('registerDbCommands', function () {
  test('registers db clone|drop|refresh-template|status|nuke|codegen and the migrate subgroup', function () {
    const program = new Command();
    registerDbCommands(program);
    const db = program.commands.find(function (c) {
      return c.name() === 'db';
    });
    expect(db).toBeDefined();
    const subNames = db!.commands.map(function (c) {
      return c.name();
    });
    expect(subNames).toContain('clone');
    expect(subNames).toContain('drop');
    expect(subNames).toContain('refresh-template');
    expect(subNames).toContain('status');
    expect(subNames).toContain('nuke');
    expect(subNames).toContain('codegen');

    const migrations = db!.commands.find(function (c) {
      return c.name() === 'migrations';
    });
    expect(migrations).toBeDefined();
    const migrationsSubs = migrations!.commands.map(function (c) {
      return c.name();
    });
    expect(migrationsSubs).toContain('create');
    expect(migrationsSubs).toContain('up');
    expect(migrationsSubs).toContain('down');
  });
});

describe('runNuke', function () {
  // A captured/restored console.log so the cancellation message does not
  // leak into the test runner's output, and can be asserted on.
  let logCalls: unknown[][];
  let originalConsoleLog: typeof console.log;

  beforeEach(function () {
    logCalls = [];
    originalConsoleLog = console.log;
    console.log = function (...args: unknown[]): void {
      logCalls.push(args);
    };
  });

  afterEach(function () {
    console.log = originalConsoleLog;
  });

  test('without --yes, a declined prompt cancels without touching the db', async function () {
    // A closed stream stands in for non-TTY stdin: confirm() sees EOF and
    // returns false, so runNuke must cancel before any db connection.
    const declinedStdin = Readable.from([]);
    await runNuke({ yes: false }, declinedStdin);
    expect(logCalls).toHaveLength(1);
    expect(logCalls[0]![0]).toBe('db nuke: cancelled');
  });
});
