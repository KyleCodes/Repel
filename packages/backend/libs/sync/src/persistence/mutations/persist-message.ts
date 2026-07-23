import type {
  NormalizedAttachment,
  NormalizedMessage,
  NormalizedParticipant,
} from '@repel/backend-adapters/types';
import type {
  AttachmentUncheckedCreateInput,
  MessageParticipantUncheckedCreateInput,
  MessageRawUncheckedCreateInput,
} from '@repel/backend-db/prisma/models';
import { type Sql, sql } from '@repel/backend-db/sql';
import type { Json, Tx } from '@repel/backend-db/types';
import { SyncEventType } from '@repel/enums';

// Persist one message event's graph: message_raw → message → participants ×N →
// attachments ×M → a message-type sync_task_event. Input is DB-shaped; the
// handler maps the AdapterEvent before calling.
//
// Idempotent: the message_raw insert uses ON CONFLICT DO NOTHING on
// UNIQUE (provider_account_id, external_message_id). A resync skips the graph
// write but still appends the message event.
//
// The core is a 4-CTE writeable statement Prisma's query API cannot express
// (ON CONFLICT with a select-back union, INSERT ... SELECT across CTEs), so it
// is raw SQL — transcribed 1:1 from the Kysely-compiled statement, with
// camelCase aliases on the final projection (CamelCasePlugin used to do the
// row-key mapping; raw results are returned verbatim). Statements two and
// three batch-insert the children keyed off the new message id — their rows
// mix the returned messageId with per-row data, which one statement can't
// express.

export type PersistMessageRaw = Omit<
  MessageRawUncheckedCreateInput,
  // payload re-declared with the platform Json alias (see adapters RawMessage).
  'id' | 'createdAt' | 'syncTaskId' | 'payload'
> & { payload: Json };

// The message body, taken straight from the adapter's normalized shape minus the
// nested graph (participants/attachments) and the provider thread ref the
// reconciler resolves later.
export type PersistMessageBody = Omit<
  NormalizedMessage,
  'externalThreadId' | 'participants' | 'attachments'
>;

export type PersistMessageParticipant = NormalizedParticipant;

// Attachment metadata plus the fetched bytes the handler pairs in (normalize()
// is pure and can't fetch them).
export type PersistMessageAttachment = NormalizedAttachment & {
  bytes: Buffer;
};

export type PersistMessageInput = {
  orgId: string;
  userId: string;
  providerAccountId: string;
  // Feeds both message_raw.sync_task_id and sync_task_event.task_id.
  taskId: string;
  raw: PersistMessageRaw;
  message: PersistMessageBody;
  participants: readonly PersistMessageParticipant[];
  attachments: readonly PersistMessageAttachment[];
};

type PersistMessageCoreRow = {
  rawMessageId: string;
  // null when the raw already existed (no new message row written).
  messageId: string | null;
};

export type PersistMessageResult = Pick<
  PersistMessageCoreRow,
  'rawMessageId'
> & {
  // False when the raw already existed and the graph write was skipped.
  persisted: boolean;
};

// Statement 1: raw (idempotent) + resolved id + conditional message + the
// always-on message event, in one round trip. `raw_id` resolves the id on both
// branches: ins_raw is empty exactly on the conflict path, where the union's
// select-back finds the existing row; LIMIT 1 is belt-and-suspenders — the two
// branches are mutually exclusive.
export function buildPersistMessageCore(input: PersistMessageInput): Sql {
  return sql`
    WITH ins_raw AS (
      INSERT INTO message_raw
        (org_id, user_id, provider_account_id, sync_task_id, channel,
         external_message_id, payload_schema, payload)
      VALUES
        (${input.raw.orgId}, ${input.raw.userId},
         ${input.raw.providerAccountId}, ${input.taskId},
         ${input.raw.channel}::channel, ${input.raw.externalMessageId},
         ${input.raw.payloadSchema}, ${JSON.stringify(input.raw.payload)}::jsonb)
      ON CONFLICT (provider_account_id, external_message_id) DO NOTHING
      RETURNING id
    ), raw_id AS (
      SELECT ins_raw.id FROM ins_raw
      UNION ALL
      SELECT r.id FROM message_raw AS r
      WHERE r.provider_account_id = ${input.providerAccountId}
        AND r.external_message_id = ${input.raw.externalMessageId}
      LIMIT 1
    ), new_message AS (
      INSERT INTO message
        (raw_message_id, org_id, user_id, provider_account_id, direction,
         thread_id, channel, external_message_id, sent_at, received_at,
         subject, snippet, body_text, body_html, in_reply_to, "references",
         message_id_header)
      SELECT
        ins_raw.id,
        ${input.orgId}, ${input.userId}, ${input.providerAccountId},
        'inbound', NULL,
        ${input.message.channel}::channel,
        ${input.message.externalMessageId},
        ${input.message.sentAt},
        ${input.message.receivedAt ?? null},
        ${input.message.subject ?? null},
        ${input.message.snippet ?? null},
        ${input.message.bodyText ?? null},
        ${input.message.bodyHtml ?? null},
        ${input.message.inReplyTo ?? null},
        ${input.message.references ?? null}::text[],
        ${input.message.messageIdHeader ?? null}
      FROM ins_raw
      RETURNING id
    ), new_event AS (
      INSERT INTO sync_task_event (org_id, user_id, task_id, type, raw_message_id)
      SELECT ${input.orgId}, ${input.userId}, ${input.taskId},
             ${SyncEventType.message}::sync_event_type, raw_id.id
      FROM raw_id
    )
    SELECT
      raw_id.id AS "rawMessageId",
      (SELECT new_message.id FROM new_message) AS "messageId"
    FROM raw_id`;
}

export async function persistMessage(
  trx: Tx,
  input: PersistMessageInput
): Promise<PersistMessageResult> {
  const rows = await trx.$queryRaw<PersistMessageCoreRow[]>(
    buildPersistMessageCore(input)
  );
  const core = rows[0];
  if (!core) throw new Error('persistMessage: core statement returned no row');
  const { rawMessageId, messageId } = core;
  const persisted = messageId !== null;

  // Statements 2 and 3: children, keyed off the new message id. createMany is
  // one multi-row INSERT each, matching the previous compiled statement count.
  // contact_id null — reconciler is a later ticket.
  if (persisted) {
    if (input.participants.length > 0) {
      await trx.messageParticipant.createMany({
        data: input.participants.map(
          (p): MessageParticipantUncheckedCreateInput => ({
            ...p,
            orgId: input.orgId,
            userId: input.userId,
            messageId,
            contactId: null,
          })
        ),
      });
    }

    if (input.attachments.length > 0) {
      await trx.attachment.createMany({
        data: input.attachments.map(
          (a): AttachmentUncheckedCreateInput => ({
            ...a,
            bytes: a.bytes as Uint8Array<ArrayBuffer>,
            orgId: input.orgId,
            userId: input.userId,
            messageId,
          })
        ),
      });
    }
  }

  return { rawMessageId, persisted };
}
