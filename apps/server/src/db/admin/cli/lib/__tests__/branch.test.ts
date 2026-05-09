import { describe, expect, test } from 'bun:test';
import { extractTicketSlug } from '../branch.ts';

describe('extractTicketSlug', function () {
  test('extracts upper-case slug from a typical user-prefixed branch', function () {
    expect(extractTicketSlug('kylemuldoon15/rep-38-t1-foundation')).toBe(
      'REP-38'
    );
  });

  test('upper-cases an already lower-case match', function () {
    expect(extractTicketSlug('feature/proj-1234-fix-thing')).toBe('PROJ-1234');
  });

  test('returns slug as-is when already upper-case', function () {
    expect(extractTicketSlug('REP-9/initial')).toBe('REP-9');
  });

  test('returns null when no ticket pattern is present', function () {
    expect(extractTicketSlug('main')).toBeNull();
    expect(extractTicketSlug('feature/no-ticket-here')).toBeNull();
  });

  test('matches the first ticket-like pattern in the branch', function () {
    expect(extractTicketSlug('rep-1-and-rep-2')).toBe('REP-1');
  });
});
