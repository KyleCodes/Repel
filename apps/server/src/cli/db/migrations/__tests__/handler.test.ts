import { describe, expect, test } from 'bun:test';
import { Command } from 'commander';
import { registerMigrationsCommands } from '../handler.ts';

describe('registerMigrationsCommands', function () {
  test('attaches migrate create|up|down to a db Command', function () {
    const db = new Command('db');
    registerMigrationsCommands(db);
    const migrate = db.commands.find(function (c) {
      return c.name() === 'migrate';
    });
    expect(migrate).toBeDefined();
    const subs = migrate!.commands.map(function (c) {
      return c.name();
    });
    expect(subs).toContain('create');
    expect(subs).toContain('up');
    expect(subs).toContain('down');
  });
});
