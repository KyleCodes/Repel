// CLI error boundary. The CLI is a developer tool — print the full error,
// stack frames included, unconditionally. More signal is always better when
// the audience is the engineer running the command. `console.error` renders
// an Error with its message and stack; non-Error throws are printed as-is.
export function handleCliError(err: unknown): void {
  console.error(err);
}
