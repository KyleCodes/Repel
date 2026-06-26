import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { Command } from 'commander';
import { registerDbCommands, runNuke } from '../handler';

describe('registerDbCommands', function () {
  test('registers db dump|restore|refresh-template|status|nuke|codegen and the migrate subgroup', function () {
    const program = new Command();
    registerDbCommands(program);
    const db = program.commands.find(function (c) {
      return c.name() === 'db';
    });
    expect(db).toBeDefined();
    const subNames = db!.commands.map(function (c) {
      return c.name();
    });
    expect(subNames).toContain('dump');
    expect(subNames).toContain('restore');
    expect(subNames).not.toContain('clone');
    expect(subNames).not.toContain('drop');
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
  // The cancellation message routes through the logger to stderr; spy on the
  // write so it does not leak into runner output and can be asserted.
  let writeSpy: ReturnType<typeof spyOn>;

  beforeEach(function () {
    writeSpy = spyOn(process.stderr, 'write').mockReturnValue(true);
  });

  afterEach(function () {
    writeSpy.mockRestore();
  });

  test('without --yes, a declined prompt cancels without touching the db', async function () {
    // A closed stream stands in for non-TTY stdin: confirm() sees EOF and
    // returns false, so runNuke must cancel before any db connection.
    const declinedStdin = Readable.from([]);
    await runNuke({ yes: false }, declinedStdin);
    // stderr carries both the confirm() prompt and the cancellation diagnostic.
    const lines = writeSpy.mock.calls.map((c: unknown[]) => String(c[0]));
    expect(lines.some((l: string) => l.includes('nuke: cancelled'))).toBe(true);
  });
});
