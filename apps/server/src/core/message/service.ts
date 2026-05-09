import { runInOrgTx } from '../../db/tx.ts';
import type { Repos } from '../../db/repos.ts';
import { messageRowToMessage, threadRowToThread } from './mappers.ts';
import type {
  GetMessageByExternalIdInput,
  GetOrCreateThreadInput,
  InsertMessageWithRawInput,
  ListMessagesByAccountInput,
  Message,
  Thread,
} from './types.ts';

// Internal helper: resolve-or-create a thread by (orgId, channel,
// externalThreadId). Used directly from insertMessageWithRaw to stay inside
// the same tx without re-decorating through runInOrgTx. The public
// getOrCreateThread service method wraps this same logic.
async function resolveThread(
  repos: Repos,
  input: {
    orgId: string;
    channel: GetOrCreateThreadInput['channel'];
    externalThreadId: string;
    subject?: string | null;
  },
) {
  const existing = await repos.messages.findThreadByExternalId(
    input.orgId,
    input.channel,
    input.externalThreadId,
  );
  if (existing) return existing;
  return repos.messages.insertThread({
    orgId: input.orgId,
    channel: input.channel,
    externalThreadId: input.externalThreadId,
    subject: input.subject ?? null,
  });
}

export const messageService = {
  insertMessageWithRaw: runInOrgTx(async function (
    repos,
    input: InsertMessageWithRawInput,
  ): Promise<Message> {
    const { orgId, message, rawPayload } = input;
    const thread = await resolveThread(repos, {
      orgId,
      channel: message.channel,
      externalThreadId: message.externalThreadId,
      subject: message.threadSubject ?? message.subject ?? null,
    });

    const inserted = await repos.messages.insertMessage({
      orgId,
      threadId: thread.id,
      providerAccountId: message.providerAccountId,
      channel: message.channel,
      externalMessageId: message.externalMessageId,
      senderAddress: message.senderAddress,
      senderName: message.senderName ?? null,
      recipientAddresses: message.recipientAddresses,
      ccAddresses: message.ccAddresses ?? null,
      bccAddresses: message.bccAddresses ?? null,
      subject: message.subject ?? null,
      bodyText: message.bodyText ?? null,
      bodyHtml: message.bodyHtml ?? null,
      direction: message.direction,
      sentAt: message.sentAt,
      receivedAt: message.receivedAt ?? null,
    });

    await repos.messages.insertMessageRaw({
      messageId: inserted.id,
      payload: rawPayload.payload,
      contentType: rawPayload.contentType,
    });

    await repos.messages.incrementThreadCounter(thread.id, message.sentAt);

    return messageRowToMessage(inserted);
  }),

  getMessageById: runInOrgTx(async function (
    repos,
    input: { orgId: string; id: string },
  ): Promise<Message> {
    // RLS owns cross-org isolation — we deliberately do not filter by orgId
    // here. The current_org_id GUC scopes the row visibility.
    const row = await repos.messages.findMessageById(input.id);
    if (!row) throw new Error(`Message ${input.id} not found`);
    return messageRowToMessage(row);
  }),

  listMessagesByAccount: runInOrgTx(async function (
    repos,
    input: ListMessagesByAccountInput,
  ): Promise<Message[]> {
    const rows = await repos.messages.listMessagesByAccount(input.providerAccountId, {
      limit: input.limit,
      cursor: input.cursor,
    });
    return rows.map(messageRowToMessage);
  }),

  getMessageByExternalId: runInOrgTx(async function (
    repos,
    input: GetMessageByExternalIdInput,
  ): Promise<Message | null> {
    const row = await repos.messages.findMessageByExternalId(
      input.providerAccountId,
      input.externalMessageId,
    );
    return row ? messageRowToMessage(row) : null;
  }),

  getOrCreateThread: runInOrgTx(async function (
    repos,
    input: GetOrCreateThreadInput,
  ): Promise<Thread> {
    const row = await resolveThread(repos, input);
    return threadRowToThread(row);
  }),
};
