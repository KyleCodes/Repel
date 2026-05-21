import { spawnSync } from 'node:child_process';
import { readDatabaseUrlFromEnvLocal } from './env-local.ts';

// Launches an interactive `pgcli` session against the worktree database.
//
// `stdio: 'inherit'` hands the real TTY (the three fds) straight to pgcli, so
// its full-screen UI, readline, colors, and signal handling all work — bun
// stays alive only as pgcli's parent, blocked in waitpid. When pgcli exits we
// propagate its exit code so a failed session surfaces to shell `&&` chains
// and CI.
//
// `spawnSync` over async `spawn`: nothing runs concurrently here, and it makes
// "exit with the child's code" trivially correct. The URL is passed as an
// argv element, never a shell string — no `shell: true`, no quoting bugs, no
// injection surface. Nothing is printed before the spawn: pgcli takes the
// screen immediately and a stray log line would be noise.
//
// `process.exit` is invoked here rather than returned because there is no
// meaningful work after an interactive session; this also keeps the handler a
// thin wrapper.
export function runConnect(): void {
  const databaseUrl = readDatabaseUrlFromEnvLocal();

  const result = spawnSync('pgcli', [databaseUrl], { stdio: 'inherit' });

  if (result.error) {
    // ENOENT: pgcli is not on PATH. It is a separate install (pip/brew), not
    // an npm dependency — give the dev the fix instead of a raw stack trace.
    if ((result.error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(
        'pgcli not found on PATH — install it with `brew install pgcli` (or `pip install pgcli`)'
      );
    }
    throw result.error;
  }

  // A signal-terminated child has a null status; treat that as a failure.
  process.exit(result.status ?? 1);
}
