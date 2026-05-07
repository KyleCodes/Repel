import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Reads DATABASE_URL from the worktree's .env.local. This file is the sole
// source of DATABASE_URL for CLI commands per the REP-19 plan — there is no
// process.env fallback. Throws if the file is missing or has no
// DATABASE_URL line.
export function readDatabaseUrlFromEnvLocal(envFile: string = '.env.local'): string {
  const path = resolve(process.cwd(), envFile);
  let contents: string;
  try {
    contents = readFileSync(path, 'utf8');
  } catch {
    throw new Error(`${envFile} not found at ${path} — run \`repel db clone\` first`);
  }

  for (const line of contents.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    if (key !== 'DATABASE_URL') continue;
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!value) throw new Error(`DATABASE_URL is empty in ${envFile}`);
    return value;
  }
  throw new Error(`DATABASE_URL not set in ${envFile}`);
}
