import { describe, expect, test } from 'bun:test';
import { Command } from 'commander';
import { registerDbCommands } from '../handler.ts';

describe('registerDbCommands', function () {
  test('registers db clone|drop|refresh-template|status and the migrate subgroup', function () {
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

    const migrate = db!.commands.find(function (c) {
      return c.name() === 'migrate';
    });
    expect(migrate).toBeDefined();
    const migrateSubs = migrate!.commands.map(function (c) {
      return c.name();
    });
    expect(migrateSubs).toContain('create');
    expect(migrateSubs).toContain('up');
    expect(migrateSubs).toContain('down');
  });
});
