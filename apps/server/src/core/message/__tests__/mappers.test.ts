import { describe, expect, test } from 'bun:test';
import { Channel, MessageDirection } from '@repel/shared';
import type { MessageRow, ThreadRow } from '../../../db/types.ts';
import { messageRowToMessage, threadRowToThread } from '../mappers.ts';

describe('message mappers', function () {
  test('25: messageRowToMessage maps every column to the domain shape', function () {
    const row: MessageRow = {
      id: 'm1',
      orgId: 'o1',
      threadId: 't1',
      providerAccountId: 'p1',
      channel: Channel.email,
      externalMessageId: 'ext-1',
      senderAddress: 'a@example.com',
      senderName: 'A',
      recipientAddresses: ['b@example.com'],
      ccAddresses: ['c@example.com'],
      bccAddresses: null,
      subject: 'sub',
      bodyText: 'text',
      bodyHtml: '<p>html</p>',
      direction: MessageDirection.outbound,
      sentAt: new Date('2026-03-01T00:00:00Z'),
      receivedAt: new Date('2026-03-01T00:00:01Z'),
      isRead: true,
      isStarred: false,
      isArchived: false,
      isDeleted: false,
      createdAt: new Date('2026-03-01T00:00:02Z'),
      updatedAt: new Date('2026-03-01T00:00:03Z'),
    };

    expect(messageRowToMessage(row)).toEqual({
      id: 'm1',
      orgId: 'o1',
      threadId: 't1',
      providerAccountId: 'p1',
      channel: Channel.email,
      externalMessageId: 'ext-1',
      senderAddress: 'a@example.com',
      senderName: 'A',
      recipientAddresses: ['b@example.com'],
      ccAddresses: ['c@example.com'],
      bccAddresses: null,
      subject: 'sub',
      bodyText: 'text',
      bodyHtml: '<p>html</p>',
      direction: MessageDirection.outbound,
      sentAt: row.sentAt,
      receivedAt: row.receivedAt,
      isRead: true,
      isStarred: false,
      isArchived: false,
      isDeleted: false,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  });

  test('26: threadRowToThread maps every column to the domain shape', function () {
    const row: ThreadRow = {
      id: 't1',
      orgId: 'o1',
      channel: Channel.email,
      externalThreadId: 'ext-thread',
      subject: 'subj',
      lastMessageAt: new Date('2026-03-01T00:00:00Z'),
      messageCount: 7,
      createdAt: new Date('2026-03-01T00:00:00Z'),
      updatedAt: new Date('2026-03-01T00:00:00Z'),
    };

    expect(threadRowToThread(row)).toEqual({
      id: 't1',
      orgId: 'o1',
      channel: Channel.email,
      externalThreadId: 'ext-thread',
      subject: 'subj',
      lastMessageAt: row.lastMessageAt,
      messageCount: 7,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  });
});
