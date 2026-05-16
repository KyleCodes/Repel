import type { Kysely } from 'kysely';
import { makeDb } from './client.ts';
import type { DB } from './types.ts';

// Lazy process-level singleton. The first caller instantiates the pool and
// Kysely instance; every subsequent caller gets the same reference. Importing
// this module is side-effect-free — no connection is opened until getDb()
// is actually invoked, which keeps unit tests importable without a real db.
let _db: Kysely<DB> | null = null;

export function getDb(): Kysely<DB> {
  if (!_db) _db = makeDb();
  return _db;
}

// Closes the singleton pool if one was lazily created. Call this from CLI
// entrypoints after work completes — pg's Pool keeps the process alive
// (~10s default) until idle connections drain otherwise.
export async function closeDb(): Promise<void> {
  if (_db) {
    await _db.destroy();
    _db = null;
  }
}
