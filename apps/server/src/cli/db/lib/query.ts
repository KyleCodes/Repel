import { Client } from 'pg';
import type { QueryInput } from '../schemas/index.ts';
import { readDatabaseUrlFromEnvLocal } from './env-local.ts';

// The literal `-` positional means "read the SQL from stdin" (DR-REP-40-2) —
// the standard UNIX stdin sentinel, so heredocs can be piped without quoting.
const STDIN_SENTINEL = '-';

// Drains process stdin to a string. Used when the SQL arg is `-`.
async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

// Resolves the SQL text to execute: literal arg, or stdin when the arg is `-`.
async function resolveSql(input: QueryInput): Promise<string> {
  if (input.sql === STDIN_SENTINEL) {
    return readStdin();
  }
  return input.sql;
}

// Executes a single SQL statement against the worktree database and writes
// `JSON.stringify(rows)` to stdout — JSON is the lingua franca for piping into
// `jq`, scripts, and tests (DR-REP-40-2).
//
// A raw `pg` Client is used directly rather than the Kysely instance from
// runtime.ts: Kysely is schema-typed and applies CamelCasePlugin, which would
// rewrite result column names. `db query` runs arbitrary SQL and must return
// rows verbatim.
//
// Throws on SQL error so the CLI entrypoint sets a non-zero exit code, keeping
// the command composable with shell `&&` chains and CI.
export async function runQuery(input: QueryInput): Promise<void> {
  const sql = await resolveSql(input);
  const client = new Client({
    connectionString: readDatabaseUrlFromEnvLocal(),
  });
  await client.connect();
  try {
    const result = await client.query(sql);
    process.stdout.write(JSON.stringify(result.rows) + '\n');
  } finally {
    await client.end();
  }
}
