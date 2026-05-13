import { Command } from 'commander';
import { registerDevDbCommands } from './cli/admin/db/handler.ts';
import { registerBootstrapCommand } from './core/account-setup/cli.ts';
import { closeDb } from './db/runtime.ts';

const program = new Command();

program.name('repel').description('Repel CLI').version('0.0.1');

registerBootstrapCommand(program);
registerDevDbCommands(program);

program
  .parseAsync()
  .catch(function (err: Error) {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(function () {
    return closeDb();
  });
