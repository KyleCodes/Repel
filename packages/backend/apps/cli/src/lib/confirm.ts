import { createInterface } from 'node:readline';

// Interactive yes/no prompt for destructive CLI verbs. Writes the question
// to stderr (stdout is reserved for structured JSON output), reads a single
// line from stdin, and returns true only on a trimmed, lowercased `y`/`yes`.
//
// EOF / no input (a closed or non-TTY stdin) returns false — the safe
// default for a destructive action is "declined". `input` is injectable so
// the unit tests can drive it with a fake stream and skip the real TTY.

export async function confirm(
  question: string,
  input: NodeJS.ReadableStream = process.stdin
): Promise<boolean> {
  process.stderr.write(question);

  // Pull exactly one line from readline's async iterator. `.next()` resolves
  // with `{ done: true }` on EOF (closed / non-TTY stdin) — treated as a
  // declined prompt. Closing the interface releases the rest of the stream.
  const rl = createInterface({ input });
  const { value, done } = await rl[Symbol.asyncIterator]().next();
  rl.close();

  const line = done ? '' : (value as string);
  const answer = line.trim().toLowerCase();
  return answer === 'y' || answer === 'yes';
}
