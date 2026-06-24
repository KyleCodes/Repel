#!/usr/bin/env bun
// Wrapper for `cli:debug`: launch the CLI under Bun's inspector (--inspect),
// then auto-open the printed debug.bun.sh URL in a browser so you don't have to
// copy/paste it. Bun prints the inspector banner to STDERR; we tee stderr
// through to the terminal unchanged while watching for the URL, open it once,
// and otherwise stay out of the way. stdout (the CLI's JSON output) is inherited
// untouched. Exits with the child's exit code.
//
// Uses --inspect (not --inspect-brk): the inspector attaches and your own
// breakpoints fire, but execution does NOT halt on the entry module's first
// line (--inspect-brk injects a synthetic line-1 break, unwanted noise here).
//
// Usage: bun run cli:debug <cli args…>   e.g. `bun run cli:debug accounts show personal`
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// The CLI entrypoint, resolved relative to this script (bin/ -> ../src) so the
// wrapper works regardless of the caller's cwd.
const CLI_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CLI_ENTRY = resolve(CLI_ROOT, 'src/index.ts');

// The backend platform root holds the dev env files (.env.development,
// .env.local). bin/ -> apps/cli -> apps -> backend.
const BACKEND_ROOT = resolve(CLI_ROOT, '..', '..');

// Bun decorates the inspector URL with ANSI color (SGR) and an OSC 8 terminal
// hyperlink, so the raw stderr bytes contain escape sequences and the URL twice.
// Strip those escapes before matching, and bound the match to the URL's actual
// charset (host:port/<alphanumeric token>) so it can't run into trailing junk.
const ANSI_ESCAPES =
  /\x1B(?:\][^\x07\x1B]*(?:\x07|\x1B\\)|\[[0-9;]*[A-Za-z]|\\)/g;
const DEBUG_URL = /https:\/\/debug\.bun\.sh\/#localhost:\d+\/[A-Za-z0-9]+/;

// macOS: open in Chrome specifically (the inspector is best-tested there). Falls
// back to the default browser if Chrome isn't installed.
function openInBrowser(url: string): void {
  const child = spawn('open', ['-a', 'Google Chrome', url], {
    stdio: 'ignore',
  });
  child.on('error', function () {
    spawn('open', [url], { stdio: 'ignore' });
  });
}

const args = process.argv.slice(2);

const child = spawn(
  'bun',
  [
    '--inspect',
    '--env-file=.env.development',
    '--env-file=.env.local',
    'run',
    CLI_ENTRY,
    ...args,
  ],
  // Run from the backend root so the relative --env-file paths resolve regardless
  // of the caller's cwd. stdin/stdout inherited; stderr piped so we can scrape
  // the URL while still echoing it to the terminal.
  { cwd: BACKEND_ROOT, stdio: ['inherit', 'inherit', 'pipe'] }
);

let opened = false;
child.stderr.on('data', function (chunk: Buffer) {
  const text = chunk.toString();
  process.stderr.write(text); // echo Bun's banner through unchanged
  if (!opened) {
    const match = text.replace(ANSI_ESCAPES, '').match(DEBUG_URL);
    if (match) {
      opened = true;
      openInBrowser(match[0]);
    }
  }
});

child.on('exit', function (code, signal) {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
