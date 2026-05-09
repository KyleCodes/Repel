import { sql } from 'kysely';
import type { ChannelSlug } from '@repel/shared';
import type {
  DbExecutor,
  MessageRow,
  NewMessage,
  NewMessageRaw,
  NewThread,
  ThreadRow,
} from '../../db/types.ts';

// Single repo for the message vertical. Owns `message`, `message_raw`, AND
// the thread helpers consumed by messageService — there is no separate
// threadRepo. Service-layer methods always run inside runInOrgTx, so the
// DbExecutor passed here is the per-tx Kysely Transaction with
// app.current_org_id already set.

export function makeMessageRepo(q: DbExecutor) {
  return {
    async insertMessage(data: NewMessage): Promise<MessageRow> {
      return q
        .insertInto('message')
        .values(data)
        .returningAll()
        .executeTakeFirstOrThrow();
    },

    async insertMessageRaw(data: NewMessageRaw): Promise<void> {
      await q.insertInto('message_raw').values(data).execute();
    },

    async findMessageById(id: string): Promise<MessageRow | undefined> {
      return q
        .selectFrom('message')
        .selectAll()
        .where('id', '=', id)
        .executeTakeFirst();
    },

    async findMessageByExternalId(
      providerAccountId: string,
      externalMessageId: string,
    ): Promise<MessageRow | undefined> {
      return q
        .selectFrom('message')
        .selectAll()
        .where('providerAccountId', '=', providerAccountId)
        .where('externalMessageId', '=', externalMessageId)
        .executeTakeFirst();
    },

    async listMessagesByAccount(
      providerAccountId: string,
      opts: { limit?: number; cursor?: { sentAt: Date; id: string } } = {},
    ): Promise<MessageRow[]> {
      let query = q
        .selectFrom('message')
        .selectAll()
        .where('providerAccountId', '=', providerAccountId)
        .orderBy('sentAt', 'desc')
        .orderBy('id', 'desc');
      if (opts.cursor) {
        // Keyset pagination: return rows strictly older than cursor
        // ((sent_at, id) < (cursor.sentAt, cursor.id) lexicographically).
        // Postgres supports row-tuple comparisons natively.
        query = query.where(
          sql<boolean>`(sent_at, id) < (${opts.cursor.sentAt}, ${opts.cursor.id})`,
        );
      }
      if (opts.limit !== undefined) query = query.limit(opts.limit);
      return query.execute();
    },

    async findThreadByExternalId(
      orgId: string,
      channel: ChannelSlug,
      externalThreadId: string,
    ): Promise<ThreadRow | undefined> {
      return q
        .selectFrom('thread')
        .selectAll()
        .where('orgId', '=', orgId)
        .where('channel', '=', channel)
        .where('externalThreadId', '=', externalThreadId)
        .executeTakeFirst();
    },

    async insertThread(data: NewThread): Promise<ThreadRow> {
      return q
        .insertInto('thread')
        .values(data)
        .returningAll()
        .executeTakeFirstOrThrow();
    },

    async incrementThreadCounter(threadId: string, sentAt: Date): Promise<void> {
      // GREATEST guards against out-of-order ingress: if a message arrives
      // with sent_at older than the thread's current last_message_at, we keep
      // the newer timestamp. Counter increments unconditionally.
      await q
        .updateTable('thread')
        .set({
          messageCount: sql<number>`message_count + 1`,
          lastMessageAt: sql<Date>`GREATEST(last_message_at, ${sentAt})`,
          updatedAt: sql<Date>`now()`,
        })
        .where('id', '=', threadId)
        .execute();
    },
  };
}

export type MessageRepo = ReturnType<typeof makeMessageRepo>;
