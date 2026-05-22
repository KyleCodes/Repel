import { describe, expect, test } from 'bun:test';
import { Command } from 'commander';
import { registerAccountsCommands } from '../handler.ts';

describe('registerAccountsCommands', function () {
  test('registers the accounts namespace with list|show|rm|add', function () {
    const program = new Command();
    registerAccountsCommands(program);
    const accounts = program.commands.find(function (c) {
      return c.name() === 'accounts';
    });
    expect(accounts).toBeDefined();
    const subNames = accounts!.commands.map(function (c) {
      return c.name();
    });
    expect(subNames).toContain('list');
    expect(subNames).toContain('show');
    expect(subNames).toContain('rm');
    expect(subNames).toContain('add');
  });

  test('no longer registers bootstrap — it moved to the orgs namespace', function () {
    const program = new Command();
    registerAccountsCommands(program);
    const accounts = program.commands.find(function (c) {
      return c.name() === 'accounts';
    });
    const subNames = accounts!.commands.map(function (c) {
      return c.name();
    });
    expect(subNames).not.toContain('bootstrap');
  });
});
