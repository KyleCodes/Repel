import { randomBytes } from 'node:crypto';
import type { Command } from 'commander';
import { logger } from '@repel/logger/logger';
import { confirm } from '../../lib/confirm';
import { parseOrExit } from '../../lib/parse-or-exit';
import { type GenerateKeyInput, GenerateKeyInputSchema } from './schemas/index';

// `db encryption` namespace. Houses the encryption-key lifecycle for credentials
// at rest. Today only `generate-key`; a future `rotate-key` (re-encrypt every
// row under a new key) belongs here too.

export function registerEncryptionCommands(db: Command): void {
  const encryption = db
    .command('encryption')
    .description('Credential-encryption key lifecycle');

  encryption
    .command('generate-key')
    .description(
      'Generate a new ENCRYPTION_KEY (prints to stdout; does NOT re-encrypt existing data)'
    )
    .option('-y, --yes', 'skip the confirmation prompt')
    .action(async function (opts: { yes?: boolean }) {
      const input = parseOrExit(GenerateKeyInputSchema, { yes: opts.yes });
      await runGenerateKey(input);
    });
}

// Generate a fresh AES-256 key and print it as an assignable `ENCRYPTION_KEY=`
// line to stdout. Warnings and the consent prompt go to stderr (stdout is
// reserved for the key itself, so the line stays pipeable). Generating a key is
// itself harmless; the danger is *using* a new one — so the prompt exists to make
// the operator acknowledge that a new key orphans anything already encrypted.
// `stdin` is injectable so tests can drive the prompt without a real TTY.
export async function runGenerateKey(
  input: GenerateKeyInput,
  stdin: NodeJS.ReadableStream = process.stdin
): Promise<void> {
  if (!input.yes) {
    logger.warn(
      'encryption generate-key: this prints a NEW key. It does NOT ' +
        're-encrypt existing data; anything already encrypted under the ' +
        'current key becomes unrecoverable if you switch to this one. Store it ' +
        'in .env.development and never commit it.'
    );
    const ok = await confirm(
      'db encryption generate-key: generate a new key? [y/N] ',
      stdin
    );
    if (!ok) {
      logger.info('encryption generate-key: cancelled');
      return;
    }
  }
  const key = randomBytes(32).toString('hex');
  process.stdout.write(`ENCRYPTION_KEY=${key}\n`);
}
