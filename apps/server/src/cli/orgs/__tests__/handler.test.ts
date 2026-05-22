import { describe, expect, test } from 'bun:test';
import { Command } from 'commander';
import { registerOrgsCommands } from '../handler.ts';

describe('registerOrgsCommands', function () {
  test('registers the orgs namespace with the bootstrap verb', function () {
    const program = new Command();
    registerOrgsCommands(program);
    const orgs = program.commands.find(function (c) {
      return c.name() === 'orgs';
    });
    expect(orgs).toBeDefined();
    const subNames = orgs!.commands.map(function (c) {
      return c.name();
    });
    expect(subNames).toContain('bootstrap');
  });
});
