import { AppError } from '../error.ts';

// The ENCRYPTION_KEY env var is missing, empty, or not a 32-byte hex string.
// An operator-misconfiguration fault — fix the environment, then retry.
export class EncryptionKeyError extends AppError {}

// A ciphertext blob could not be decrypted: a wrong key, a tampered/corrupt
// blob (GCM auth tag mismatch), or one too short to contain iv + tag. Distinct
// from EncryptionKeyError so a caller can tell "key is misconfigured" from
// "this particular stored value is unrecoverable".
export class DecryptionError extends AppError {}
