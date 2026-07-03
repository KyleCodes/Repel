import { describe, expect, test } from 'bun:test';
import { DateTime } from 'luxon';
import { GmailRangeBoundsError } from '../../error';
import { buildRangeQuery, gmailAfter, gmailBefore } from '../query-date';

// A fixed instant: 2023-11-14T22:13:20Z === 1700000000 epoch-seconds.
const T = DateTime.fromISO('2023-11-14T22:13:20.000Z', { zone: 'utc' });
const T_SECS = 1_700_000_000;

describe('gmailAfter / gmailBefore', function () {
  test('emit the epoch-seconds operator form', function () {
    expect(gmailAfter(T)).toBe(`after:${T_SECS}`);
    expect(gmailBefore(T)).toBe(`before:${T_SECS}`);
  });

  test('floor sub-second precision (Gmail takes whole seconds)', function () {
    const withMillis = T.plus({ milliseconds: 750 });
    expect(gmailAfter(withMillis)).toBe(`after:${T_SECS}`);
  });

  test('are timezone-independent (same instant, different zone)', function () {
    const sameInstantNy = T.setZone('America/New_York');
    expect(gmailAfter(sameInstantNy)).toBe(gmailAfter(T));
  });
});

describe('buildRangeQuery', function () {
  test('both bounds → after then before, space-joined', function () {
    const before = T.plus({ days: 1 });
    expect(buildRangeQuery({ after: T, before })).toBe(
      `after:${T_SECS} before:${T_SECS + 86_400}`
    );
  });

  test('after only → just the after term', function () {
    expect(buildRangeQuery({ after: T })).toBe(`after:${T_SECS}`);
  });

  test('before only → just the before term', function () {
    expect(buildRangeQuery({ before: T })).toBe(`before:${T_SECS}`);
  });

  test('both omitted → throws GmailRangeBoundsError', function () {
    expect(() => buildRangeQuery({})).toThrow(GmailRangeBoundsError);
  });
});
