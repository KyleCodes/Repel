import type {
  ChannelSlug,
  MessageDirectionSlug,
} from '@repel/shared';

// Domain types for the message vertical. Mappers translate DB rows to these
// shapes at the service boundary; callers never touch raw rows.

export interface Message {
  id: string;
  orgId: string;
  threadId: string | null;
  providerAccountId: string;
  channel: ChannelSlug;
  externalMessageId: string;
  senderAddress: string;
  senderName: string | null;
  recipientAddresses: string[];
  ccAddresses: string[] | null;
  bccAddresses: string[] | null;
  subject: string | null;
  bodyText: string | null;
  bodyHtml: string | null;
  direction: MessageDirectionSlug;
  sentAt: Date;
  receivedAt: Date | null;
  isRead: boolean;
  isStarred: boolean;
  isArchived: boolean;
  isDeleted: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface Thread {
  id: string;
  orgId: string;
  channel: ChannelSlug;
  externalThreadId: string | null;
  subject: string | null;
  lastMessageAt: Date | null;
  messageCount: number;
  createdAt: Date;
  updatedAt: Date;
}

// Input shape for inserting a message together with its raw payload.
// `externalThreadId` is required — channels without thread coords are out of
// scope for v0 (sync ingress always knows its thread coordinate).
export interface InsertMessageInput {
  providerAccountId: string;
  channel: ChannelSlug;
  externalMessageId: string;
  externalThreadId: string;
  threadSubject?: string | null;
  senderAddress: string;
  senderName?: string | null;
  recipientAddresses: string[];
  ccAddresses?: string[] | null;
  bccAddresses?: string[] | null;
  subject?: string | null;
  bodyText?: string | null;
  bodyHtml?: string | null;
  direction: MessageDirectionSlug;
  sentAt: Date;
  receivedAt?: Date | null;
}

export interface RawPayload {
  payload: unknown;
  contentType: string;
}

export interface InsertMessageWithRawInput {
  orgId: string;
  message: InsertMessageInput;
  rawPayload: RawPayload;
}

export interface ListMessagesByAccountInput {
  orgId: string;
  providerAccountId: string;
  limit?: number;
  cursor?: { sentAt: Date; id: string };
}

export interface GetMessageByExternalIdInput {
  orgId: string;
  providerAccountId: string;
  externalMessageId: string;
}

export interface GetOrCreateThreadInput {
  orgId: string;
  channel: ChannelSlug;
  externalThreadId: string;
  subject?: string | null;
}
