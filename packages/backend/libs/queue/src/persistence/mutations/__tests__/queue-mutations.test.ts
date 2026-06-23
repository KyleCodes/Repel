import { describe, expect, test } from 'bun:test';
import { CamelCasePlugin, Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import type { DB } from '@repel/backend-db/generated';
import type { Tx } from '@repel/backend-db/types';
import { buildClaimJobs } from '../claim-jobs';
import { buildCompleteJob } from '../complete-job';
import { buildDeadLetterJob } from '../dead-letter-job';
import { buildEnqueueJob } from '../enqueue-job';
import { buildReapCompletedJobs } from '../reap-completed-jobs';
import { buildRescheduleJob } from '../reschedule-job';

// Compile-only: a Kysely over a never-connected Pool so .compile() yields SQL +
// parameters with no I/O. Asserts the SQL-shape invariants the queue depends on.
const db = new Kysely<DB>({
  dialect: new PostgresDialect({
    pool: new Pool({ connectionString: 'postgres://unused' }),
  }),
  plugins: [new CamelCasePlugin()],
});
const trx = db as unknown as Tx;

describe('buildEnqueueJob', function () {
  test('inserts a pending job with ON CONFLICT DO NOTHING on the partial dedup index', function () {
    const compiled = buildEnqueueJob(trx, {
      topic: 'sync',
      dedupKey: 'k-1',
      maxAttempts: 3,
      stored: { orgId: 'org-1', payload: { foo: 1 } },
    }).compile();
    expect(compiled.sql).toContain('insert into "job_queue"');
    expect(compiled.sql).toContain('on conflict');
    expect(compiled.sql).toContain('do nothing');
    expect(compiled.sql).toContain('returning "id"');
    // The conflict target restates the partial index predicate so it arbitrates
    // against (topic, dedup_key) WHERE status IN (...) AND dedup_key IS NOT NULL.
    expect(compiled.sql.toLowerCase()).toContain('("topic", "dedup_key")');
    expect(compiled.sql.toLowerCase()).toContain('where');
    // The stored payload (carrying orgId) is a bound jsonb parameter.
    expect(JSON.stringify(compiled.parameters)).toContain('org-1');
    expect(compiled.parameters).toContain('sync');
  });
});

describe('buildClaimJobs', function () {
  test('claims via FOR UPDATE SKIP LOCKED inside the subselect, oldest-first', function () {
    const compiled = buildClaimJobs(trx, {
      topic: 'sync',
      consumerId: 'c-1',
      limit: 5,
    }).compile();
    const sql = compiled.sql.toLowerCase();
    expect(sql).toContain('update "job_queue"');
    expect(sql).toContain('set "status" =');
    expect(sql).toContain('"attempts" = attempts + 1');
    // The lock clause must sit inside the id subselect, not on the UPDATE.
    const subselectStart = sql.indexOf('where "id" in (select');
    expect(subselectStart).toBeGreaterThan(-1);
    expect(sql.indexOf('for update skip locked')).toBeGreaterThan(
      subselectStart
    );
    expect(sql).toContain('order by "scheduled_for"');
    expect(compiled.parameters).toContain('sync');
    expect(compiled.parameters).toContain('c-1');
    expect(compiled.parameters).toContain(5);
  });
});

describe('buildCompleteJob', function () {
  test('sets completed + completed_at and releases the lock', function () {
    const compiled = buildCompleteJob(trx, { id: 'j-1' }).compile();
    const sql = compiled.sql.toLowerCase();
    expect(sql).toContain('set "status" =');
    expect(sql).toContain('"completed_at" = now()');
    expect(sql).toContain('"locked_at" = ');
    expect(compiled.parameters).toContain('completed');
    expect(compiled.parameters).toContain('j-1');
  });
});

describe('buildRescheduleJob', function () {
  test('returns the job to pending with a backoff delay', function () {
    const compiled = buildRescheduleJob(trx, {
      id: 'j-1',
      backoffMs: 2000,
      lastError: 'boom',
    }).compile();
    const sql = compiled.sql.toLowerCase();
    expect(sql).toContain("interval '1 millisecond'");
    expect(sql).toContain('now() +');
    expect(compiled.parameters).toContain('pending');
    expect(compiled.parameters).toContain(2000);
    expect(compiled.parameters).toContain('boom');
  });
});

describe('buildDeadLetterJob', function () {
  test('sets status dead', function () {
    const compiled = buildDeadLetterJob(trx, {
      id: 'j-1',
      lastError: 'fatal',
    }).compile();
    expect(compiled.parameters).toContain('dead');
    expect(compiled.parameters).toContain('fatal');
    expect(compiled.sql.toLowerCase()).toContain('set "status" =');
  });
});

describe('buildReapCompletedJobs', function () {
  test('deletes completed jobs older than the TTL, leaving dead rows', function () {
    const compiled = buildReapCompletedJobs(trx, {
      ttlMs: 604_800_000,
    }).compile();
    const sql = compiled.sql.toLowerCase();
    expect(sql).toContain('delete from "job_queue"');
    expect(sql).toContain('"status" =');
    expect(sql).toContain("interval '1 millisecond'");
    expect(sql).toContain('now() -');
    // Only completed rows — not dead.
    expect(compiled.parameters).toContain('completed');
    expect(compiled.parameters).not.toContain('dead');
    expect(compiled.parameters).toContain(604_800_000);
  });
});
