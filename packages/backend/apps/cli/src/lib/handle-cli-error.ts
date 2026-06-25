import { logger } from '@repel/logger/logger';

// CLI error boundary. The CLI is a developer tool — print the full error,
// stack frames included, unconditionally. More signal is always better when
// the audience is the engineer running the command. The logger captures the
// Error (message + stack) into the record; non-Error throws are wrapped.
export function handleCliError(err: unknown): void {
  logger.error('unhandled cli error', err);
}
