import { Command } from 'commander';
import { registerBootstrapCommand } from './core/account-setup/cli.js';
import { registerDevDbCommands } from './db/admin/cli.js';
import { closeDb } from './db/runtime.js';

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
