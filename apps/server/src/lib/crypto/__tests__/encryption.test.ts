import { randomBytes } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { MissingEnvVarError } from '../../env.ts';
import { decrypt, encrypt, loadEncryptionKey } from '../encryption.ts';
import { DecryptionError, EncryptionKeyError } from '../error.ts';

// A valid 32-byte key, hex-encoded (64 chars) — the shape `openssl rand -hex 32`
// and `repel db encryption generate-key` produce.
const KEY_HEX = randomBytes(32).toString('hex');
const key = Buffer.from(KEY_HEX, 'hex');

describe('encrypt / decrypt round-trip', function () {
  test('decrypt(encrypt(x)) === x for a realistic JSON credential blob', function () {
    const plaintext = Buffer.from(
      JSON.stringify({ accessToken: 'tok-abc', refreshToken: 'r-xyz' }),
      'utf8'
    );
    const blob = encrypt(key, plaintext);
    expect(decrypt(key, blob)).toEqual(plaintext);
  });

  test('round-trips empty input', function () {
    const plaintext = Buffer.alloc(0);
    const blob = encrypt(key, plaintext);
    expect(decrypt(key, blob)).toEqual(plaintext);
  });

  test('two encryptions of the same input differ (random iv) but both decrypt back', function () {
    const plaintext = Buffer.from('same input', 'utf8');
    const a = encrypt(key, plaintext);
    const b = encrypt(key, plaintext);
    expect(a.equals(b)).toBe(false);
    expect(decrypt(key, a)).toEqual(plaintext);
    expect(decrypt(key, b)).toEqual(plaintext);
  });

  test('blob is longer than the plaintext by iv(12) + tag(16)', function () {
    const plaintext = Buffer.from('1234567890', 'utf8');
    const blob = encrypt(key, plaintext);
    expect(blob.length).toBe(plaintext.length + 12 + 16);
  });
});

describe('decrypt failures', function () {
  test('throws DecryptionError on a wrong key', function () {
    const blob = encrypt(key, Buffer.from('secret', 'utf8'));
    const wrongKey = Buffer.from(randomBytes(32));
    expect(function () {
      decrypt(wrongKey, blob);
    }).toThrow(DecryptionError);
  });

  test('throws DecryptionError on tampered ciphertext', function () {
    const blob = encrypt(key, Buffer.from('secret', 'utf8'));
    // Flip a bit in the last byte (inside the ciphertext region).
    const tampered = Buffer.from(blob);
    tampered[tampered.length - 1] ^= 0x01;
    expect(function () {
      decrypt(key, tampered);
    }).toThrow(DecryptionError);
  });

  test('throws DecryptionError on a too-short blob (cannot hold iv + tag)', function () {
    expect(function () {
      decrypt(key, Buffer.alloc(10));
    }).toThrow(DecryptionError);
  });
});

describe('loadEncryptionKey', function () {
  let original: string | undefined;

  beforeEach(function () {
    original = process.env.ENCRYPTION_KEY;
  });

  afterEach(function () {
    if (original === undefined) delete process.env.ENCRYPTION_KEY;
    else process.env.ENCRYPTION_KEY = original;
  });

  test('returns a 32-byte Buffer for a valid hex key', function () {
    process.env.ENCRYPTION_KEY = KEY_HEX;
    const loaded = loadEncryptionKey();
    expect(Buffer.isBuffer(loaded)).toBe(true);
    expect(loaded.length).toBe(32);
    expect(loaded.equals(key)).toBe(true);
  });

  test('throws MissingEnvVarError when unset', function () {
    delete process.env.ENCRYPTION_KEY;
    expect(loadEncryptionKey).toThrow(MissingEnvVarError);
  });

  test('throws MissingEnvVarError when empty', function () {
    process.env.ENCRYPTION_KEY = '';
    expect(loadEncryptionKey).toThrow(MissingEnvVarError);
  });

  test('throws EncryptionKeyError on a too-short key (16 bytes hex)', function () {
    process.env.ENCRYPTION_KEY = randomBytes(16).toString('hex');
    expect(loadEncryptionKey).toThrow(EncryptionKeyError);
  });

  test('throws EncryptionKeyError on a too-long key (48 bytes hex)', function () {
    process.env.ENCRYPTION_KEY = randomBytes(48).toString('hex');
    expect(loadEncryptionKey).toThrow(EncryptionKeyError);
  });

  test('throws EncryptionKeyError on non-hex input', function () {
    // 64 chars but not hex — Buffer.from(..,'hex') stops at the first invalid
    // pair, yielding the wrong byte length.
    process.env.ENCRYPTION_KEY = 'z'.repeat(64);
    expect(loadEncryptionKey).toThrow(EncryptionKeyError);
  });
});
