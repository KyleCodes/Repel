import { type InferResult, sql } from 'kysely';
import type { Tx } from '@repel/backend-db/types';
import { SyncEventType } from '@repel/enums';

export type GetLatestCompletedCursorInput = {
  providerAccount: { id: string };
};

// The resumption cursor for an account: the `cursor` payload of its most recent
// `completed` sync_task_event. Cursor persistence was dropped from
// provider_account (REP-56) and re-homed to the completed event, so "resume from
// last sync" reads it here. Join sync_task to filter by providerAccountId, take
// the newest completed event across all that account's tasks. RLS scopes to the
// current org — no orgId predicate (idx_sync_task_provider_account covers it).
export const buildGetLatestCompletedCursor = (
  trx: Tx,
  input: GetLatestCompletedCursorInput
) =>
  trx
    .selectFrom('syncTaskEvent as e')
    .innerJoin('syncTask as t', 't.id', 'e.taskId')
    .where('t.providerAccountId', '=', input.providerAccount.id)
    .where('e.type', '=', SyncEventType.completed)
    .orderBy('e.createdAt', 'desc')
    .limit(1)
    .select(sql<unknown>`e.payload->'cursor'`.as('cursor'));

export type LatestCompletedCursorRow = InferResult<
  ReturnType<typeof buildGetLatestCompletedCursor>
>[number];

// undefined when the account has no completed sync yet — the caller maps that to
// a typed "nothing to resume from" error.
export async function getLatestCompletedCursor(
  trx: Tx,
  input: GetLatestCompletedCursorInput
): Promise<LatestCompletedCursorRow | undefined> {
  return buildGetLatestCompletedCursor(trx, input).executeTakeFirst();
}
