import { Readable } from 'node:stream';
import { describe, expect, test } from 'bun:test';
import { confirm } from '../confirm';

// Builds a readable stream that yields `text` as a single chunk, mimicking
// a line of stdin input. An empty array yields nothing, mimicking EOF.
function streamOf(text: string | null): Readable {
  return Readable.from(text === null ? [] : [Buffer.from(text)]);
}

describe('confirm', function () {
  test("returns true for 'y'", async function () {
    expect(await confirm('go? ', streamOf('y\n'))).toBe(true);
  });

  test("returns true for 'yes'", async function () {
    expect(await confirm('go? ', streamOf('yes\n'))).toBe(true);
  });

  test("returns true for 'Y' (case-insensitive)", async function () {
    expect(await confirm('go? ', streamOf('Y\n'))).toBe(true);
  });

  test("returns true for 'YES' (case-insensitive)", async function () {
    expect(await confirm('go? ', streamOf('YES\n'))).toBe(true);
  });

  test("returns true for ' y ' (trimmed)", async function () {
    expect(await confirm('go? ', streamOf(' y \n'))).toBe(true);
  });

  test("returns false for 'n'", async function () {
    expect(await confirm('go? ', streamOf('n\n'))).toBe(false);
  });

  test('returns false for an empty line', async function () {
    expect(await confirm('go? ', streamOf('\n'))).toBe(false);
  });

  test("returns false for 'yep' (not an exact y/yes match)", async function () {
    expect(await confirm('go? ', streamOf('yep\n'))).toBe(false);
  });

  test('returns false on EOF / no input', async function () {
    expect(await confirm('go? ', streamOf(null))).toBe(false);
  });

  test('stops at the first newline — later chunks are not consumed', async function () {
    // Two chunks; the newline is in the first. confirm must break out of
    // the drain loop after chunk one and never read 'unreached'.
    const stream = Readable.from([
      Buffer.from('y\n'),
      Buffer.from('unreached'),
    ]);
    expect(await confirm('go? ', stream)).toBe(true);
  });

  test('writes the question to stderr', async function () {
    const original = process.stderr.write;
    let written = '';
    process.stderr.write = function (chunk: unknown): boolean {
      written += String(chunk);
      return true;
    } as typeof process.stderr.write;
    try {
      await confirm('Deactivate work? [y/N] ', streamOf('y\n'));
    } finally {
      process.stderr.write = original;
    }
    expect(written).toBe('Deactivate work? [y/N] ');
  });
});
