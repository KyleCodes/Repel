import type {
  NormalizedAttachment,
  NormalizedMessage,
  NormalizedParticipant,
} from '@repel/backend-adapters/types';
import type { Prisma } from '@repel/backend-db/prisma/client';
import type {
  AttachmentUncheckedCreateInput,
  MessageParticipantUncheckedCreateInput,
  MessageRawUncheckedCreateInput,
} from '@repel/backend-db/prisma/models';
import type { Json, Tx } from '@repel/backend-db/types';
import { SyncEventType } from '@repel/enums';

// Persist one message event's graph: message_raw → message → participants ×N →
// attachments ×M → a message-type sync_task_event. Input is DB-shaped; the
// handler maps the AdapterEvent before calling.
//
// Idempotent via upsert with an empty update: Prisma compiles it to a native
// ON CONFLICT on (provider_account_id, external_message_id), so a resync
// resolves to the existing raw id without erroring. try/create-catch-P2002 is
// NOT usable here — a unique violation aborts the whole Postgres transaction
// (25P02), poisoning the ambient runInOrgTx. Whether this call actually
// inserted is derived from the 1:1 message row (UNIQUE raw_message_id): raw
// and message are only ever written together in this same transaction, so a
// raw without a message cannot be observed. All statements run inside the
// ambient tenant transaction, so the graph write stays atomic.

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

export type PersistMessageResult = {
  rawMessageId: string;
  // False when the raw already existed and the graph write was skipped.
  persisted: boolean;
};

export async function persistMessage(
  trx: Tx,
  input: PersistMessageInput
): Promise<PersistMessageResult> {
  const raw = await trx.messageRaw.upsert({
    where: {
      providerAccountId_externalMessageId: {
        providerAccountId: input.providerAccountId,
        externalMessageId: input.raw.externalMessageId,
      },
    },
    create: {
      ...input.raw,
      payload: input.raw.payload as Prisma.InputJsonValue,
      syncTaskId: input.taskId,
    },
    update: {},
    select: { id: true },
  });
  const rawMessageId = raw.id;

  const existingMessage = await trx.message.findUnique({
    where: { rawMessageId },
    select: { id: true },
  });
  const persisted = existingMessage === null;

  if (persisted) {
    const message = await trx.message.create({
      data: {
        rawMessageId,
        orgId: input.orgId,
        userId: input.userId,
        providerAccountId: input.providerAccountId,
        direction: 'inbound',
        threadId: null,
        channel: input.message.channel,
        externalMessageId: input.message.externalMessageId,
        sentAt: input.message.sentAt,
        receivedAt: input.message.receivedAt ?? null,
        subject: input.message.subject ?? null,
        snippet: input.message.snippet ?? null,
        bodyText: input.message.bodyText ?? null,
        bodyHtml: input.message.bodyHtml ?? null,
        inReplyTo: input.message.inReplyTo ?? null,
        // A list column cannot be set to NULL through the query API; omitting
        // it leaves the column NULL, matching the previous behavior.
        ...(input.message.references != null && {
          references: input.message.references,
        }),
        messageIdHeader: input.message.messageIdHeader ?? null,
      },
      select: { id: true },
    });

    if (input.participants.length > 0) {
      await trx.messageParticipant.createMany({
        data: input.participants.map(
          (p): MessageParticipantUncheckedCreateInput => ({
            ...p,
            orgId: input.orgId,
            userId: input.userId,
            messageId: message.id,
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
            messageId: message.id,
          })
        ),
      });
    }
  }

  // Always appended (even on a noop'd graph) — the resync is still an event.
  await trx.syncTaskEvent.create({
    data: {
      orgId: input.orgId,
      userId: input.userId,
      taskId: input.taskId,
      type: SyncEventType.message,
      rawMessageId,
    },
  });

  return { rawMessageId, persisted };
}
