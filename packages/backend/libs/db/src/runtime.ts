import { makeDb } from './client';
import type { PrismaClient } from './prisma/client';

// Lazy process-level singleton. The first caller instantiates the pool and
// Prisma client; every subsequent caller gets the same reference. Importing
// this module is side-effect-free — no connection is opened until getDb()
// is actually invoked, which keeps unit tests importable without a real db.
let _db: PrismaClient | null = null;

export function getDb(): PrismaClient {
  if (!_db) _db = makeDb();
  return _db;
}

// Closes the singleton pool if one was lazily created. Call this from CLI
// entrypoints after work completes — the underlying pg Pool keeps the process
// alive (~10s default) until idle connections drain otherwise.
export async function closeDb(): Promise<void> {
  if (_db) {
    await _db.$disconnect();
    _db = null;
  }
}
