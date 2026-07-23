import { describe, expect, spyOn, test } from 'bun:test';
import type { Tx } from '@repel/backend-db/types';
import { runWithLogContext } from '@repel/logger/context';
import type { StoredPayload } from '../../types';
import { enqueue } from '../enqueue';

// enqueue runs its insert through the caller's tx when one is supplied, so a
// stub Tx whose $queryRaw resolves to a chosen row set drives both branches
// without a DB (the dedup path is an empty result set).
function stubTx(returnedRow: { id: string } | undefined): Tx {
  return {
    $queryRaw: async () => (returnedRow ? [returnedRow] : []),
  } as unknown as Tx;
}

// A stub Tx that records the Sql handed to $queryRaw, so a test can assert what
// was serialized into the payload wrapper (orgId, traceId, …). The stored
// payload is the one stringified-jsonb bound value.
function capturingTx(returnedRow: { id: string } | undefined): {
  tx: Tx;
  stored(): StoredPayload;
} {
  let values: unknown[] = [];
  return {
    tx: {
      $queryRaw: async (query: { values: unknown[] }) => {
        values = query.values;
        return returnedRow ? [returnedRow] : [];
      },
    } as unknown as Tx,
    stored: () => {
      const json = values.find(
        (v): v is string => typeof v === 'string' && v.startsWith('{')
      );
      return JSON.parse(json!) as StoredPayload;
    },
  };
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
    const write = spyOn(process.stderr, 'write').mockReturnValue(true);
    let result;
    let warned: string[] = [];
    try {
      result = await enqueue(
        'sync',
        { foo: 1 },
        { orgId: 'org-1', dedupKey: 'k-1', tx: stubTx(undefined) }
      );
      // Capture before restore — mockRestore() clears the recorded calls.
      warned = write.mock.calls.map((c) => String(c[0]));
    } finally {
      write.mockRestore();
    }
    expect(result).toEqual({ enqueued: false, reason: 'dedup' });
    expect(warned.some((line) => line.includes('duplicate enqueue'))).toBe(
      true
    );
    expect(warned.some((line) => line.includes('k-1'))).toBe(true);
  });

  test('inherits the ambient traceId into the stored payload', async function () {
    const cap = capturingTx({ id: 'job-1' });
    await runWithLogContext({ traceId: 'trace-abc' }, () =>
      enqueue('sync', { foo: 1 }, { orgId: 'org-1', tx: cap.tx })
    );
    expect(cap.stored().traceId).toBe('trace-abc');
  });

  test('opts.traceId overrides the ambient traceId', async function () {
    const cap = capturingTx({ id: 'job-1' });
    await runWithLogContext({ traceId: 'ambient' }, () =>
      enqueue(
        'sync',
        { foo: 1 },
        { orgId: 'org-1', traceId: 'explicit', tx: cap.tx }
      )
    );
    expect(cap.stored().traceId).toBe('explicit');
  });

  test('omits traceId when there is no ambient trace and none passed', async function () {
    const cap = capturingTx({ id: 'job-1' });
    await enqueue('sync', { foo: 1 }, { orgId: 'org-1', tx: cap.tx });
    expect(cap.stored().traceId).toBeUndefined();
    expect('traceId' in cap.stored()).toBe(false);
  });
});
