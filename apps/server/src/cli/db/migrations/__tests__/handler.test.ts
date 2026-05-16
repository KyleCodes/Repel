import { describe, expect, test } from 'bun:test';
import { Command } from 'commander';
import { registerMigrationsCommands } from '../handler.ts';

describe('registerMigrationsCommands', function () {
  test('attaches migrations create|up|down to a db Command', function () {
    const db = new Command('db');
    registerMigrationsCommands(db);
    const migrations = db.commands.find(function (c) {
      return c.name() === 'migrations';
    });
    expect(migrations).toBeDefined();
    const subs = migrations!.commands.map(function (c) {
      return c.name();
    });
    expect(subs).toContain('create');
    expect(subs).toContain('up');
    expect(subs).toContain('down');
  });
});
