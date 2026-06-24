import { spawnSync } from 'node:child_process';
import { closeSync, openSync } from 'node:fs';

// pg_dump / pg_restore for the per-worktree seed flow. The host has no postgres
// client tools (the only Postgres is the compose container), so both run INSIDE
// a stack's postgres container via `docker compose exec`. The archive crosses the
// boundary as the exec's stdin/stdout, captured to / streamed from a host file.
//
// db dump runs in the SOURCE worktree (its compose project); the archive is the
// persisted hand-off (./data/seed.dump). On a fresh worktree the postgres init
// hook restores it automatically (see ops/postgres/initdb). db restore is the
// manual escape hatch to re-seed an already-running stack.
//
// argv builders are pure and exported for unit testing.

// `docker compose exec -T postgres pg_dump -U <user> -Fc <db>` → stdout.
// -T disables TTY allocation so stdout is a clean binary stream we can redirect.
export function buildDumpArgv(input: {
  service: string;
  user: string;
  database: string;
}): string[] {
  return [
    'compose',
    'exec',
    '-T',
    input.service,
    'pg_dump',
    '-U',
    input.user,
    '--format=custom',
    input.database,
  ];
}

// `docker compose exec -T postgres pg_restore --clean --if-exists ... -d <db>`
// reads the archive from stdin (the trailing no-path pg_restore reads stdin).
// --clean/--if-exists drop existing objects; --no-owner/--no-privileges because
// the worktree cluster has a single `repel` superuser.
export function buildRestoreArgv(input: {
  service: string;
  user: string;
  database: string;
}): string[] {
  return [
    'compose',
    'exec',
    '-T',
    input.service,
    'pg_restore',
    '-U',
    input.user,
    '--clean',
    '--if-exists',
    '--no-owner',
    '--no-privileges',
    '-d',
    input.database,
  ];
}

const DOCKER_HINT =
  'docker not found on PATH — Docker Desktop must be installed and running';

function runDocker(
  argv: string[],
  io: { stdin?: number; stdout?: number }
): void {
  const result = spawnSync('docker', argv, {
    stdio: [io.stdin ?? 'inherit', io.stdout ?? 'inherit', 'inherit'],
  });
  if (result.error) {
    if ((result.error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(DOCKER_HINT);
    }
    throw result.error;
  }
  if ((result.status ?? 1) !== 0) {
    throw new Error(`docker ${argv[0]} exited with code ${result.status}`);
  }
}

// Dump the source stack's database to a host file. Run from the source worktree
// dir so `docker compose` resolves that worktree's project.
export function runDump(input: {
  service: string;
  user: string;
  database: string;
  outFile: string;
}): void {
  const fd = openSync(input.outFile, 'w');
  try {
    runDocker(
      buildDumpArgv({
        service: input.service,
        user: input.user,
        database: input.database,
      }),
      { stdout: fd }
    );
  } finally {
    closeSync(fd);
  }
}

// Restore a host archive file into the (running) stack's database via stdin.
export function runRestore(input: {
  service: string;
  user: string;
  database: string;
  inFile: string;
}): void {
  const fd = openSync(input.inFile, 'r');
  try {
    runDocker(
      buildRestoreArgv({
        service: input.service,
        user: input.user,
        database: input.database,
      }),
      { stdin: fd }
    );
  } finally {
    closeSync(fd);
  }
}
