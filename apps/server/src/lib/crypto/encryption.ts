import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { getRequiredEnvVar } from '../env.ts';
import { DecryptionError, EncryptionKeyError } from './error.ts';

// Authenticated symmetric encryption for credentials at rest (AES-256-GCM).
//
// The app encrypts before bytes reach Postgres, so the database only ever holds
// ciphertext and never sees the key — the separation that makes a DB-only /
// backup leak non-catastrophic. GCM is authenticated: a tampered blob fails to
// decrypt rather than yielding garbage.
//
// Stored blob layout, one self-contained buffer: iv(12) || authTag(16) || ciphertext.
// The iv is a per-encryption random nonce (not secret); reusing one under the
// same key would break GCM, so `encrypt` always generates a fresh one.

const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32; // AES-256
const IV_BYTES = 12; // GCM standard nonce length
const TAG_BYTES = 16; // GCM auth tag length

// Read ENCRYPTION_KEY from the environment as a 64-char hex string and decode it
// to its 32 raw bytes. Hex (not base64) avoids `+/=` mangling in `.env` files.
// An unset/empty var throws MissingEnvVarError (the shared env-config fault);
// a present-but-wrong-length value throws EncryptionKeyError.
export function loadEncryptionKey(): Buffer {
  const hex = getRequiredEnvVar(
    'ENCRYPTION_KEY',
    'ENCRYPTION_KEY is not set — generate one with `repel db encryption generate-key` and add it to .env.development'
  );
  const key = Buffer.from(hex, 'hex');
  if (key.length !== KEY_BYTES) {
    throw new EncryptionKeyError(
      `ENCRYPTION_KEY must be ${KEY_BYTES} bytes hex-encoded (${KEY_BYTES * 2} hex chars); got ${key.length} bytes`
    );
  }
  return key;
}

// Encrypt arbitrary bytes. Returns iv || authTag || ciphertext as one buffer,
// ready to store in a bytea column.
export function encrypt(key: Buffer, plaintext: Buffer): Buffer {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]);
}

// Reverse of encrypt. Slices the iv and auth tag off the front, verifies the
// tag, and returns the plaintext. Throws DecryptionError on a wrong key, a
// tampered blob, or a blob too short to contain iv + tag.
export function decrypt(key: Buffer, blob: Buffer): Buffer {
  if (blob.length < IV_BYTES + TAG_BYTES) {
    throw new DecryptionError(
      `ciphertext blob too short: ${blob.length} bytes (need at least ${IV_BYTES + TAG_BYTES})`
    );
  }
  const iv = blob.subarray(0, IV_BYTES);
  const authTag = blob.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ciphertext = blob.subarray(IV_BYTES + TAG_BYTES);
  try {
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch (err) {
    throw new DecryptionError(
      `failed to decrypt: wrong key or corrupt/tampered ciphertext (${err instanceof Error ? err.message : String(err)})`
    );
  }
}
