import { describe, expect, test } from 'bun:test';
import { CamelCasePlugin, Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import type { DB } from '@repel/backend-db/generated';
import type { Tx } from '@repel/backend-db/types';
import { buildGetLatestCompletedCursor } from '../get-latest-completed-cursor';
import { buildListSyncJobs } from '../list-sync-jobs';
import { buildListTaskEvents } from '../list-task-events';

// Compile-only: a Kysely over a never-connected Pool so .compile() yields SQL +
// parameters with no I/O. These views are plain selects (no CTE), so the SQL
// shape is the unit under test — org scoping is enforced by RLS (no explicit
// predicate), ordering and the taskId filter are explicit and asserted here.
const db = new Kysely<DB>({
  dialect: new PostgresDialect({
    pool: new Pool({ connectionString: 'postgres://unused' }),
  }),
  plugins: [new CamelCasePlugin()],
});
const trx = db as unknown as Tx;

describe('listSyncJobs', function () {
  test('selects the bare job columns, newest first, with no explicit org filter', function () {
    const compiled = buildListSyncJobs(trx).compile();
    expect(compiled.sql).toContain('sync_job');
    expect(compiled.sql).toContain('order by');
    expect(compiled.sql).toContain('desc');
    // RLS scopes the org — the query carries no org_id predicate of its own.
    expect(compiled.sql).not.toContain('where');
    // No status/processed fold in SQL — that is the service's N+1 loop.
    expect(compiled.sql).not.toContain('sync_task_event');
  });
});

describe('listTaskEvents', function () {
  test('selects the raw event columns for one task, oldest first', function () {
    const compiled = buildListTaskEvents(trx, {
      syncTask: { id: 'task-1' },
    }).compile();
    expect(compiled.sql).toContain('sync_task_event');
    expect(compiled.sql).toContain('task_id');
    expect(compiled.parameters).toContain('task-1');
    expect(compiled.sql).toContain('order by');
    // The audit trail keeps every event — no distinctOn collapse.
    expect(compiled.sql).not.toContain('distinct on');
  });
});

describe('getLatestCompletedCursor', function () {
  test('selects the newest completed event cursor for an account, join-scoped, RLS-org', function () {
    const compiled = buildGetLatestCompletedCursor(trx, {
      providerAccount: { id: 'pa-1' },
    }).compile();
    // Reads the event log joined to sync_task to filter by the account.
    expect(compiled.sql).toContain('sync_task_event');
    expect(compiled.sql).toContain('inner join "sync_task"');
    expect(compiled.sql).toContain('provider_account_id');
    expect(compiled.parameters).toContain('pa-1');
    // Latest completed event only.
    expect(compiled.sql).toContain('order by');
    expect(compiled.sql).toContain('desc');
    expect(compiled.sql).toContain('limit');
    // Extracts the cursor JSON object (-> not ->>).
    expect(compiled.sql).toContain("payload->'cursor'");
    // RLS scopes the org — no org_id predicate of its own.
    expect(compiled.sql).not.toContain('org_id');
  });
});
