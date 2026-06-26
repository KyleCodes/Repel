import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { Command } from 'commander';
import { registerEncryptionCommands, runGenerateKey } from '../handler';

describe('registerEncryptionCommands', function () {
  test('registers `encryption generate-key` with a --yes option', function () {
    const db = new Command('db');
    registerEncryptionCommands(db);
    const encryption = db.commands.find(function (c) {
      return c.name() === 'encryption';
    });
    const generate = encryption!.commands.find(function (c) {
      return c.name() === 'generate-key';
    });
    expect(generate).toBeDefined();
    const optionNames = generate!.options.map(function (o) {
      return o.long;
    });
    expect(optionNames).toContain('--yes');
  });
});

describe('runGenerateKey', function () {
  // The raw key line goes to stdout (the data channel). The warning/cancellation
  // diagnostics go through the logger to stderr. Spy on both streams separately.
  let stdoutSpy: ReturnType<typeof spyOn>;
  let stderrSpy: ReturnType<typeof spyOn>;

  function stdoutLines(): string[] {
    return stdoutSpy.mock.calls.map((c: unknown[]) => String(c[0]));
  }
  function stderrLines(): string[] {
    return stderrSpy.mock.calls.map((c: unknown[]) => String(c[0]));
  }
  function keyLines(): string[] {
    return stdoutLines().filter((l) => l.startsWith('ENCRYPTION_KEY='));
  }

  beforeEach(function () {
    stdoutSpy = spyOn(process.stdout, 'write').mockReturnValue(true);
    stderrSpy = spyOn(process.stderr, 'write').mockReturnValue(true);
  });

  afterEach(function () {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  test('a declined prompt warns, prints no key, and reports cancellation', async function () {
    // Closed stream = non-TTY stdin: confirm() sees EOF and returns false.
    await runGenerateKey({ yes: false }, Readable.from([]));
    // No key was emitted to the data channel.
    expect(keyLines()).toHaveLength(0);
    // The warning and the cancellation diagnostic were both emitted to stderr.
    const diagnostics = stderrLines();
    expect(
      diagnostics.some((l) => l.includes('re-encrypt existing data'))
    ).toBe(true);
    expect(diagnostics.some((l) => l.includes('generate-key: cancelled'))).toBe(
      true
    );
  });

  test('a confirmed prompt prints a 32-byte hex ENCRYPTION_KEY line', async function () {
    await runGenerateKey({ yes: false }, Readable.from(['y\n']));
    const keys = keyLines();
    expect(keys).toHaveLength(1);
    const match = keys[0]!.match(/^ENCRYPTION_KEY=([0-9a-f]+)\n$/);
    expect(match).not.toBeNull();
    expect(Buffer.from(match![1], 'hex').length).toBe(32);
  });

  test('--yes skips the prompt and prints the key directly', async function () {
    // No stdin needed — --yes bypasses confirm entirely.
    await runGenerateKey({ yes: true });
    const keys = keyLines();
    expect(keys).toHaveLength(1);
    const match = keys[0]!.match(/^ENCRYPTION_KEY=([0-9a-f]{64})\n$/);
    expect(match).not.toBeNull();
    // No prompt/warning emitted when --yes is passed: the only stdout write is the key.
    expect(stdoutLines()).toHaveLength(1);
  });
});
