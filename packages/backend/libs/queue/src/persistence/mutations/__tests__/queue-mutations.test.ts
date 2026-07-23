import { describe, expect, test } from 'bun:test';
import { buildClaimJobs } from '../claim-jobs';
import { buildCompleteJob } from '../complete-job';
import { buildDeadLetterJob } from '../dead-letter-job';
import { buildEnqueueJob } from '../enqueue-job';
import { buildReapCompletedJobs } from '../reap-completed-jobs';
import { buildRescheduleJob } from '../reschedule-job';

// Connection-free: a Prisma.Sql is plain text + bound values, so the SQL-shape
// invariants the queue depends on are asserted with no I/O — the successor of
// the old Kysely .compile() pattern. Status literals are now inline SQL (they
// were bound params under Kysely), so they are asserted on the text.

describe('buildEnqueueJob', function () {
  test('inserts a pending job with ON CONFLICT DO NOTHING on the partial dedup index', function () {
    const query = buildEnqueueJob({
      topic: 'sync',
      dedupKey: 'k-1',
      maxAttempts: 3,
      stored: { orgId: 'org-1', payload: { foo: 1 } },
    });
    const text = query.sql.toLowerCase();
    expect(text).toContain('insert into job_queue');
    expect(text).toContain('on conflict');
    expect(text).toContain('do nothing');
    expect(text).toContain('returning id');
    // The conflict target restates the partial index predicate so it arbitrates
    // against (topic, dedup_key) WHERE status IN (...) AND dedup_key IS NOT NULL.
    expect(text).toContain('(topic, dedup_key)');
    expect(text).toContain("where status in ('pending', 'processing')");
    expect(text).toContain('dedup_key is not null');
    // The stored payload (carrying orgId) is bound stringified with a jsonb cast.
    expect(text).toContain('::jsonb');
    expect(JSON.stringify(query.values)).toContain('org-1');
    expect(query.values).toContain('sync');
  });
});

describe('buildClaimJobs', function () {
  test('claims via FOR UPDATE SKIP LOCKED inside the subselect, oldest-first', function () {
    const query = buildClaimJobs({
      topic: 'sync',
      consumerId: 'c-1',
      limit: 5,
    });
    const text = query.sql.toLowerCase();
    expect(text).toContain('update job_queue');
    expect(text).toContain("status = 'processing'");
    expect(text).toContain('attempts = attempts + 1');
    // The lock clause must sit inside the id subselect, not on the UPDATE.
    const subselectStart = text.indexOf('where id in (');
    expect(subselectStart).toBeGreaterThan(-1);
    expect(text.indexOf('for update skip locked')).toBeGreaterThan(
      subselectStart
    );
    expect(text).toContain('order by scheduled_for');
    // Raw rows are returned verbatim — camelCase is aliased in the SQL.
    expect(query.sql).toContain('AS "scheduledFor"');
    expect(query.sql).toContain('AS "maxAttempts"');
    expect(query.values).toContain('sync');
    expect(query.values).toContain('c-1');
    expect(query.values).toContain(5);
  });
});

describe('buildCompleteJob', function () {
  test('sets completed + completed_at and releases the lock', function () {
    const query = buildCompleteJob({ id: 'j-1' });
    const text = query.sql.toLowerCase();
    expect(text).toContain("status = 'completed'");
    expect(text).toContain('completed_at = now()');
    expect(text).toContain('locked_at = null');
    expect(text).toContain('locked_by = null');
    expect(query.values).toContain('j-1');
  });
});

describe('buildRescheduleJob', function () {
  test('returns the job to pending with a backoff delay', function () {
    const query = buildRescheduleJob({
      id: 'j-1',
      backoffMs: 2000,
      lastError: 'boom',
    });
    const text = query.sql.toLowerCase();
    expect(text).toContain("status = 'pending'");
    expect(text).toContain("interval '1 millisecond'");
    expect(text).toContain('now() +');
    expect(query.values).toContain(2000);
    expect(query.values).toContain('boom');
  });
});

describe('buildDeadLetterJob', function () {
  test('sets status dead', function () {
    const query = buildDeadLetterJob({ id: 'j-1', lastError: 'fatal' });
    expect(query.sql.toLowerCase()).toContain("status = 'dead'");
    expect(query.values).toContain('fatal');
  });
});

describe('buildReapCompletedJobs', function () {
  test('deletes completed jobs older than the TTL, leaving dead rows', function () {
    const query = buildReapCompletedJobs({ ttlMs: 604_800_000 });
    const text = query.sql.toLowerCase();
    expect(text).toContain('delete from job_queue');
    expect(text).toContain("status = 'completed'");
    expect(text).toContain("interval '1 millisecond'");
    expect(text).toContain('now() -');
    // Only completed rows — not dead.
    expect(text).not.toContain("'dead'");
    expect(query.values).toContain(604_800_000);
  });
});
