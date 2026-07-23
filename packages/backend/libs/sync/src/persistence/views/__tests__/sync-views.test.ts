import { describe, expect, test } from 'bun:test';
import { buildGetSyncTaskResults } from '../get-sync-task-results';

// Connection-free: a Prisma.Sql is plain text + bound values, so the SQL-shape
// invariants are asserted with no I/O. The two list views moved to the Prisma
// query API (their shape is compile-time checked); the event-log fold below is
// the one raw statement left in views/, and the Postgres-only constructs it
// leans on are pinned here.

describe('buildGetSyncTaskResults', function () {
  const query = buildGetSyncTaskResults({ syncTask: { jobId: 'job-1' } });

  test('collapses the event log with DISTINCT ON and folds the terminal via LATERAL', function () {
    expect(query.sql).toContain('DISTINCT ON (e.task_id, e.type)');
    expect(query.sql).toContain('LEFT JOIN LATERAL');
    // Terminal = newest of completed|failed.
    expect(query.sql).toContain("IN ('completed', 'failed')");
  });

  test('reads processed/cursor/error from jsonb payload paths', function () {
    expect(query.sql).toContain("payload->>'processed'");
    expect(query.sql).toContain("payload->'cursor'");
    expect(query.sql).toContain("payload->>'error'");
  });

  test('scopes to the job id and aliases camelCase in-SQL', function () {
    expect(query.values).toContain('job-1');
    expect(query.sql).toContain('"providerAccountId"');
    expect(query.sql).toContain('"terminalType"');
    expect(query.sql).toContain('"startedAt"');
    expect(query.sql).toContain('"completedAt"');
  });
});
