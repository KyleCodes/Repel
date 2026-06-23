import { describe, expect, test } from 'bun:test';
import { backoffMs } from '../backoff';

const BASE_MS = 1000;
const FACTOR = 2;
const CAP_MS = 5 * 60 * 1000;

function ceiling(attempts: number): number {
  return Math.min(CAP_MS, BASE_MS * FACTOR ** Math.max(0, attempts - 1));
}

describe('backoffMs', function () {
  test('every sample falls within [0, ceiling(attempts)]', function () {
    for (let attempts = 1; attempts <= 12; attempts++) {
      const cap = ceiling(attempts);
      for (let i = 0; i < 200; i++) {
        const v = backoffMs(attempts);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(cap);
      }
    }
  });

  test('the ceiling is monotonic non-decreasing and clamps at the cap', function () {
    let prev = 0;
    for (let attempts = 1; attempts <= 20; attempts++) {
      const c = ceiling(attempts);
      expect(c).toBeGreaterThanOrEqual(prev);
      expect(c).toBeLessThanOrEqual(CAP_MS);
      prev = c;
    }
    // Far enough out, the ceiling is pinned at the cap.
    expect(ceiling(50)).toBe(CAP_MS);
  });

  test('first attempt is bounded by the base delay', function () {
    for (let i = 0; i < 200; i++) {
      expect(backoffMs(1)).toBeLessThanOrEqual(BASE_MS);
    }
  });
});
