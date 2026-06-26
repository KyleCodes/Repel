export function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof document !== 'undefined';
}

// The logger writes diagnostics only to stderr, so TTY detection always keys
// off stderr.
export function isTTY(): boolean {
  return (
    typeof process !== 'undefined' &&
    !!process.stderr &&
    process.stderr.isTTY === true
  );
}
