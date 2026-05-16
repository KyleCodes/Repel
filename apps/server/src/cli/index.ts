import { Command } from 'commander';
import { closeDb } from '../infra/db/runtime.ts';
import { registerAccountsCommands } from './accounts/handler.ts';
import { registerDbCommands } from './db/handler.ts';

const program = new Command();

program.name('repel').description('Repel CLI').version('0.0.1');

registerAccountsCommands(program);
registerDbCommands(program);

program
  .parseAsync()
  .catch(function (err: Error) {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(function () {
    return closeDb();
  });
