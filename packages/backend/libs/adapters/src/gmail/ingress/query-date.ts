import type { DateTime } from 'luxon';
import { GmailRangeBoundsError } from '../error';

// Gmail's `after:` / `before:` query operators. We emit the epoch-seconds form
// (`after:1700000000`) rather than `YYYY/MM/DD`: seconds are timezone-independent
// and avoid the day-granularity ambiguity of the date form. Gmail still rounds
// internally, but this is the precise documented input.
//
// These take a DateTime, never a JS Date — the ingest boundary deserializes the
// spec's Iso8601String to a DateTime once, and everything inward works with that.

export function gmailAfter(dt: DateTime): string {
  return `after:${Math.floor(dt.toSeconds())}`;
}

export function gmailBefore(dt: DateTime): string {
  return `before:${Math.floor(dt.toSeconds())}`;
}

// Build the `q` for a windowed list from its bounds. Each present bound adds its
// operator; an omitted bound is left open (no operator). Both omitted is a
// caller bug — an unbounded range would scan the whole mailbox — so it throws.
export function buildRangeQuery(bounds: {
  after?: DateTime;
  before?: DateTime;
}): string {
  const terms: string[] = [];
  if (bounds.after !== undefined) terms.push(gmailAfter(bounds.after));
  if (bounds.before !== undefined) terms.push(gmailBefore(bounds.before));
  if (terms.length === 0) {
    throw new GmailRangeBoundsError(
      'range sync requires at least one of from/to; use a full sync for an unbounded pull'
    );
  }
  return terms.join(' ');
}
