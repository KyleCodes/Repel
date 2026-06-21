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
  // Capture console.log so warnings/cancellation don't leak into runner output.
  let logCalls: unknown[][];
  let originalConsoleLog: typeof console.log;

  beforeEach(function () {
    logCalls = [];
    originalConsoleLog = console.log;
    console.log = function (...args: unknown[]): void {
      logCalls.push(args);
    };
  });

  afterEach(function () {
    console.log = originalConsoleLog;
  });

  test('a declined prompt prints no key and reports cancellation', async function () {
    const writeSpy = spyOn(process.stdout, 'write').mockReturnValue(true);
    try {
      // Closed stream = non-TTY stdin: confirm() sees EOF and returns false.
      await runGenerateKey({ yes: false }, Readable.from([]));
    } finally {
      writeSpy.mockRestore();
    }
    expect(writeSpy).not.toHaveBeenCalled();
    expect(logCalls.at(-1)![0]).toBe('db encryption generate-key: cancelled');
  });

  test('a confirmed prompt prints a 32-byte hex ENCRYPTION_KEY line', async function () {
    const writeSpy = spyOn(process.stdout, 'write').mockReturnValue(true);
    let printed = '';
    try {
      await runGenerateKey({ yes: false }, Readable.from(['y\n']));
      printed = String(writeSpy.mock.calls[0][0]);
    } finally {
      writeSpy.mockRestore();
    }
    const match = printed.match(/^ENCRYPTION_KEY=([0-9a-f]+)\n$/);
    expect(match).not.toBeNull();
    expect(Buffer.from(match![1], 'hex').length).toBe(32);
  });

  test('--yes skips the prompt and prints the key directly', async function () {
    const writeSpy = spyOn(process.stdout, 'write').mockReturnValue(true);
    let printed = '';
    try {
      // No stdin needed — --yes bypasses confirm entirely.
      await runGenerateKey({ yes: true });
      printed = String(writeSpy.mock.calls[0][0]);
    } finally {
      writeSpy.mockRestore();
    }
    const match = printed.match(/^ENCRYPTION_KEY=([0-9a-f]{64})\n$/);
    expect(match).not.toBeNull();
    // No prompt/warning emitted when --yes is passed.
    expect(logCalls).toHaveLength(0);
  });
});
