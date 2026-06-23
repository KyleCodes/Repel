import { describe, expect, spyOn, test } from 'bun:test';
import type { Tx } from '@repel/backend-db/types';
import { enqueue } from '../enqueue';

// enqueue runs its insert through the caller's tx when one is supplied, so a
// stub Tx whose insertInto().…executeTakeFirst() resolves to a chosen row drives
// both branches without a DB. The chain only needs the methods enqueueJob calls.
function stubTx(returnedRow: { id: string } | undefined): Tx {
  const builder = {
    values: () => builder,
    onConflict: () => builder,
    returning: () => builder,
    executeTakeFirst: async () => returnedRow,
  };
  return { insertInto: () => builder } as unknown as Tx;
}

describe('enqueue', function () {
  test('returns the inserted id on a fresh enqueue', async function () {
    const result = await enqueue(
      'sync',
      { foo: 1 },
      { orgId: 'org-1', dedupKey: 'k-1', tx: stubTx({ id: 'job-1' }) }
    );
    expect(result).toEqual({ enqueued: true, id: 'job-1' });
  });

  test('a deduped enqueue returns the dedup result and warns', async function () {
    const warn = spyOn(console, 'warn').mockReturnValue(undefined);
    let result;
    let warned: string[] = [];
    try {
      result = await enqueue(
        'sync',
        { foo: 1 },
        { orgId: 'org-1', dedupKey: 'k-1', tx: stubTx(undefined) }
      );
      // Capture before restore — mockRestore() clears the recorded calls.
      warned = warn.mock.calls.map((c) => String(c[0]));
    } finally {
      warn.mockRestore();
    }
    expect(result).toEqual({ enqueued: false, reason: 'dedup' });
    expect(warned.some((line) => line.includes('duplicate enqueue'))).toBe(
      true
    );
    expect(warned.some((line) => line.includes('k-1'))).toBe(true);
  });
});
