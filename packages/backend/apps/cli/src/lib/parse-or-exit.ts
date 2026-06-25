import type { z } from 'zod';
import { logger } from '@repel/logger/logger';

// Commander `.action()` parse boundary per ADR-012. Build a raw input object
// from positional args + options, hand it here, and the caller receives a
// typed `z.infer<S>`. Validation failures print zod issues to stderr and exit
// non-zero so the CLI doesn't proceed with bad input.
export function parseOrExit<S extends z.ZodTypeAny>(
  schema: S,
  raw: unknown
): z.infer<S> {
  const result = schema.safeParse(raw);
  if (!result.success) {
    for (const issue of result.error.issues) {
      const path = issue.path.length ? issue.path.join('.') + ': ' : '';
      logger.error(`${path}${issue.message}`);
    }
    process.exit(1);
  }
  return result.data;
}
