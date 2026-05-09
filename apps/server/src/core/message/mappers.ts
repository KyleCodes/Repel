import type { MessageRow, ThreadRow } from '../../db/types.ts';
import type { Message, Thread } from './types.ts';

export function messageRowToMessage(row: MessageRow): Message {
  return {
    id: row.id,
    orgId: row.orgId,
    threadId: row.threadId,
    providerAccountId: row.providerAccountId,
    channel: row.channel,
    externalMessageId: row.externalMessageId,
    senderAddress: row.senderAddress,
    senderName: row.senderName,
    recipientAddresses: row.recipientAddresses,
    ccAddresses: row.ccAddresses,
    bccAddresses: row.bccAddresses,
    subject: row.subject,
    bodyText: row.bodyText,
    bodyHtml: row.bodyHtml,
    direction: row.direction,
    sentAt: row.sentAt,
    receivedAt: row.receivedAt,
    isRead: row.isRead,
    isStarred: row.isStarred,
    isArchived: row.isArchived,
    isDeleted: row.isDeleted,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function threadRowToThread(row: ThreadRow): Thread {
  return {
    id: row.id,
    orgId: row.orgId,
    channel: row.channel,
    externalThreadId: row.externalThreadId,
    subject: row.subject,
    lastMessageAt: row.lastMessageAt,
    messageCount: row.messageCount,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
