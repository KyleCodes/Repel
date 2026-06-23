import { Command, CommanderError } from 'commander';
import { closeDb } from '@repel/backend-db/runtime';
import { registerAccountsCommands } from './accounts/handler';
import { registerDbCommands } from './db/handler';
import { handleCliError } from './lib/handle-cli-error';
import { registerOrgsCommands } from './orgs/handler';
import { registerServicesCommands } from './services/handler';
import { registerSyncsCommands } from './syncs/handler';

const program = new Command();

// Take over process exit so commander's own control-flow exits (help text,
// --version, a group invoked with no subcommand) surface as throws we can
// classify, rather than calling process.exit(1) mid-parse. Without this,
// `repel db` (print group help) exits 1 and reads as a failure.
program.exitOverride();

program.name('repel').description('Repel CLI').version('0.0.1');

registerOrgsCommands(program);
registerAccountsCommands(program);
registerDbCommands(program);
registerSyncsCommands(program);
registerServicesCommands(program);

// Commander signals "displayed help / version" via these codes — that is the
// command succeeding, so exit 0. Everything else is a real error: exit 1.
const HELP_OR_VERSION = new Set([
  'commander.help',
  'commander.helpDisplayed',
  'commander.version',
]);

program
  .parseAsync()
  .catch(function (err: unknown) {
    if (err instanceof CommanderError) {
      process.exitCode = HELP_OR_VERSION.has(err.code) ? 0 : err.exitCode;
      return;
    }
    handleCliError(err);
    process.exitCode = 1;
  })
  // Close the shared pool when the command resolves. `services run` blocks on a
  // shutdown promise, so this only fires for it on boot failure (it owns its own
  // shutdown otherwise).
  .finally(function () {
    return closeDb();
  });
