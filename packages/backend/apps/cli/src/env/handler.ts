import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { Command } from 'commander';
import { parseOrExit } from '../lib/parse-or-exit';
import { renderEnvLocal } from './lib/env-file';
import { deriveWorktreeEnv } from './lib/worktree-env';
import { type ProvisionInput, ProvisionInputSchema } from './schemas/index';

// `env` namespace. Per-worktree dev-environment provisioning — the ports,
// compose project name, and DATABASE_URL each worktree's own docker stack uses.
// Distinct from `db` (database lifecycle): this owns the gitops/stack config
// that compose consumes, not the database itself.

export function registerEnvCommands(program: Command): void {
  const env = program
    .command('env')
    .description('Per-worktree dev-environment provisioning');

  env
    .command('provision <branch>')
    .description(
      'Compute this worktree’s stack env (ports, project name, DATABASE_URL) and write .env.local'
    )
    .option('--env-file <path>', 'path to the .env file to write')
    .action(async function (branch: string, opts: { envFile?: string }) {
      const input = parseOrExit(ProvisionInputSchema, {
        branch,
        envFile: opts.envFile,
      });
      await runProvision(input);
    });
}

export async function runProvision(input: ProvisionInput): Promise<void> {
  const env = deriveWorktreeEnv(input.branch);
  const envPath = resolve(process.cwd(), input.envFile);
  mkdirSync(dirname(envPath), { recursive: true });
  writeFileSync(envPath, renderEnvLocal(env), { mode: 0o600 });

  console.log(`env provision: ${input.branch} → ${env.projectName}`);
  console.log(
    `env provision: pg ${env.pgPort}, grafana ${env.grafanaPort}, api ${env.apiPort}`
  );
  console.log(`env provision: wrote ${envPath}`);
}
