import { Command } from 'commander';
import { registerBootstrapCommand } from './domains/account-setup/cli.js';
import { registerAddAccountCommand } from './domains/providers/cli.js';
import { registerDevDbCommands } from './domains/dev-db/cli.js';

const program = new Command();

program.name('repel').description('Repel CLI').version('0.0.1');

registerBootstrapCommand(program);
registerAddAccountCommand(program);
registerDevDbCommands(program);

program.parseAsync().catch(function (err: Error) {
  console.error(err.message);
  process.exit(1);
});
