import type { InferResult, Insertable } from 'kysely';
import type {
  NormalizedAttachment,
  NormalizedMessage,
  NormalizedParticipant,
} from '@repel/backend-adapters/types';
import type {
  Attachment,
  Message,
  MessageParticipant,
  MessageRaw,
} from '@repel/backend-db/generated';
import type { Tx } from '@repel/backend-db/types';
import { SyncEventType } from '@repel/enums';

// Persist one message event's graph: message_raw → message → participants ×N →
// attachments ×M → a message-type sync_task_event. Input is DB-shaped; the
// handler maps the AdapterEvent before calling.
//
// Idempotent: the message_raw insert uses ON CONFLICT DO NOTHING on
// UNIQUE (provider_account_id, external_message_id). A resync skips the graph
// write but still appends the message event.
//
// Two statements: the raw/message/event core is one writeable CTE (idempotency
// resolved in-SQL via a union select-back); participants/attachments are a
// second batched insert because their rows mix the CTE-derived messageId with a
// JS array of per-row data, which a single statement can't express in kysely.

export type PersistMessageRaw = Omit<
  Insertable<MessageRaw>,
  'id' | 'createdAt' | 'syncTaskId'
>;

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
  bytes: Insertable<Attachment>['bytes'];
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

type PersistMessageCoreRow = InferResult<
  ReturnType<typeof buildPersistMessageCore>
>[number];

// rawMessageId is inferred from the core builder; persisted is derived in app
// code (messageId !== null), not a query column.
export type PersistMessageResult = Pick<
  PersistMessageCoreRow,
  'rawMessageId'
> & {
  // False when the raw already existed and the graph write was skipped.
  persisted: boolean;
};

// Statement 1: raw (idempotent) + resolved id + conditional message + the
// always-on message event, in one round trip.
export function buildPersistMessageCore(trx: Tx, input: PersistMessageInput) {
  return (
    trx
      .with('ins_raw', (qb) =>
        qb
          .insertInto('messageRaw')
          .values({ ...input.raw, syncTaskId: input.taskId })
          .onConflict((oc) =>
            oc.columns(['providerAccountId', 'externalMessageId']).doNothing()
          )
          .returning('id')
      )
      // The resolved raw id, new or pre-existing: ins_raw is empty exactly on the
      // conflict path, where the select-back finds the existing row. limit 1 is
      // belt-and-suspenders — the two branches are mutually exclusive.
      .with('raw_id', (qb) =>
        qb
          .selectFrom('ins_raw')
          .select('ins_raw.id')
          .unionAll(
            trx
              .selectFrom('messageRaw as r')
              .select('r.id')
              .where('r.providerAccountId', '=', input.providerAccountId)
              .where('r.externalMessageId', '=', input.raw.externalMessageId)
          )
          .limit(1)
      )
      // Writes only when the raw was newly inserted (ins_raw empty on conflict).
      // The message body columns the adapter owns are spread in via the typed
      // body object; the runner-owned columns (ids, direction, thread) are
      // selected from the resolved raw.
      .with('new_message', (qb) =>
        qb
          .insertInto('message')
          // Explicit column list: .expression() maps the select to columns by
          // position, not alias, so this must mirror the select's order exactly.
          .columns([
            'rawMessageId',
            'orgId',
            'userId',
            'providerAccountId',
            'direction',
            'threadId',
            'channel',
            'externalMessageId',
            'sentAt',
            'receivedAt',
            'subject',
            'snippet',
            'bodyText',
            'bodyHtml',
            'inReplyTo',
            'references',
            'messageIdHeader',
          ])
          .expression((eb) =>
            eb
              .selectFrom('ins_raw')
              .select((eb2) => [
                'ins_raw.id as rawMessageId',
                eb2.val(input.orgId).as('orgId'),
                eb2.val(input.userId).as('userId'),
                eb2.val(input.providerAccountId).as('providerAccountId'),
                eb2.val<'inbound'>('inbound').as('direction'),
                eb2.val<string | null>(null).as('threadId'),
                eb2.val(input.message.channel).as('channel'),
                eb2
                  .val(input.message.externalMessageId)
                  .as('externalMessageId'),
                eb2.val(input.message.sentAt).as('sentAt'),
                eb2.val(input.message.receivedAt ?? null).as('receivedAt'),
                eb2.val(input.message.subject ?? null).as('subject'),
                eb2.val(input.message.snippet ?? null).as('snippet'),
                eb2.val(input.message.bodyText ?? null).as('bodyText'),
                eb2.val(input.message.bodyHtml ?? null).as('bodyHtml'),
                eb2.val(input.message.inReplyTo ?? null).as('inReplyTo'),
                eb2.val(input.message.references ?? null).as('references'),
                eb2
                  .val(input.message.messageIdHeader ?? null)
                  .as('messageIdHeader'),
              ])
          )
          .returning('id')
      )
      // Always written (even on a noop'd graph); references the resolved raw id.
      .with('new_event', (qb) =>
        qb
          .insertInto('syncTaskEvent')
          .columns(['orgId', 'userId', 'taskId', 'type', 'rawMessageId'])
          .expression((eb) =>
            eb
              .selectFrom('raw_id')
              .select((eb2) => [
                eb2.val(input.orgId).as('orgId'),
                eb2.val(input.userId).as('userId'),
                eb2.val(input.taskId).as('taskId'),
                eb2.val(SyncEventType.message).as('type'),
                'raw_id.id as rawMessageId',
              ])
          )
      )
      .selectFrom('raw_id')
      .select((eb) => [
        'raw_id.id as rawMessageId',
        // null when the raw already existed (no new_message row written).
        eb.selectFrom('new_message').select('new_message.id').as('messageId'),
      ])
  );
}

export async function persistMessage(
  trx: Tx,
  input: PersistMessageInput
): Promise<PersistMessageResult> {
  const core = await buildPersistMessageCore(
    trx,
    input
  ).executeTakeFirstOrThrow();
  const { rawMessageId, messageId } = core;
  const persisted = messageId !== null;

  // Statement 2: children, keyed off the new message id. Not foldable into the
  // CTE — VALUES can't mix a CTE-derived messageId with a JS array of rows.
  // contact_id null — reconciler is a later ticket.
  if (persisted) {
    if (input.participants.length > 0) {
      await trx
        .insertInto('messageParticipant')
        .values(
          input.participants.map(
            (p): Insertable<MessageParticipant> => ({
              ...p,
              orgId: input.orgId,
              userId: input.userId,
              messageId,
              contactId: null,
            })
          )
        )
        .execute();
    }

    if (input.attachments.length > 0) {
      await trx
        .insertInto('attachment')
        .values(
          input.attachments.map(
            (a): Insertable<Attachment> => ({
              ...a,
              orgId: input.orgId,
              userId: input.userId,
              messageId,
            })
          )
        )
        .execute();
    }
  }

  return { rawMessageId, persisted };
}
