import { describe, expect, test } from 'bun:test';
import { Command } from 'commander';
import { registerDevDbCommands } from '../handler.ts';

describe('registerDevDbCommands', function () {
  test('registers db migrate create|up|down and db status on a fresh Command', function () {
    const program = new Command();
    registerDevDbCommands(program);
    const db = program.commands.find(function (c) {
      return c.name() === 'db';
    });
    expect(db).toBeDefined();
    const subNames = db!.commands.map(function (c) {
      return c.name();
    });
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
