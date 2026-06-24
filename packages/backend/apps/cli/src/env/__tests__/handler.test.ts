import { describe, expect, test } from 'bun:test';
import { Command } from 'commander';
import { registerEnvCommands } from '../handler';

describe('registerEnvCommands', function () {
  test('registers the env namespace with a provision subcommand', function () {
    const program = new Command();
    registerEnvCommands(program);
    const env = program.commands.find(function (c) {
      return c.name() === 'env';
    });
    expect(env).toBeDefined();
    const subNames = env!.commands.map(function (c) {
      return c.name();
    });
    expect(subNames).toContain('provision');
  });
});
