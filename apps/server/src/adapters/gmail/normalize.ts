import { Channel } from '@repel/shared';
import type { Json } from '../../infra/db/generated.ts';
import type {
  NormalizedAttachment,
  NormalizedMessage,
  NormalizedParticipant,
  RawMessage,
} from '../types.ts';
import {
  type GmailMessage,
  GmailMessageSchema,
  type GmailPart,
} from './queries/messages.ts';

// The payload-schema tag stamped on every raw row. Bump the version when the
// stored payload contract changes so a re-normalization can tell vintages apart.
export const GMAIL_PAYLOAD_SCHEMA = 'gmail.messages.get.full.v1';

// Build the persistable raw row from a fetched message + account context. The
// full get response is stored verbatim as `payload` so normalize() can be re-run
// over it later without re-fetching. The runner assigns id / createdAt /
// syncTaskId (omitted from RawMessage).
export function buildGmailRawMessage(
  msg: GmailMessage,
  ctx: { orgId: string; userId: string; providerAccountId: string }
): RawMessage {
  return {
    orgId: ctx.orgId,
    userId: ctx.userId,
    providerAccountId: ctx.providerAccountId,
    channel: Channel.email,
    externalMessageId: msg.id,
    payload: msg as unknown as Json,
    payloadSchema: GMAIL_PAYLOAD_SCHEMA,
  };
}

// Body precedence: walk the MIME tree depth-first and keep the FIRST text/plain
// leaf for bodyText and the FIRST text/html leaf for bodyHtml. Both are captured
// (multipart/alternative offers equivalent renderings; the schema has columns for
// each and downstream/UI decides which to show). Attachment parts are skipped as
// body candidates even when they are text/* (an attached .txt is content, not the
// message body). Containers (multipart/*) are recursed, never emitted.
//
// Pure: the only input is the stored raw payload. No I/O. Attachment *bytes* are
// not here — Gmail's payload carries only an attachmentId; the bytes are fetched
// during ingest and travel on the message event, keyed by externalAttachmentId.

export function normalizeGmailMessage(raw: RawMessage): NormalizedMessage {
  // Re-validate the stored payload so a corrupt/old row fails loudly on
  // re-normalization rather than yielding a malformed record.
  const msg = GmailMessageSchema.parse(raw.payload);

  const body = { text: null as string | null, html: null as string | null };
  const attachments: NormalizedAttachment[] = [];
  walk(msg.payload, body, attachments);

  return {
    channel: Channel.email,
    externalMessageId: msg.id,
    externalThreadId: msg.threadId,
    subject: header(msg.payload, 'subject'),
    snippet: msg.snippet ?? null,
    bodyText: body.text,
    bodyHtml: body.html,
    messageIdHeader: header(msg.payload, 'message-id'),
    inReplyTo: header(msg.payload, 'in-reply-to'),
    references: parseReferences(header(msg.payload, 'references')),
    sentAt: new Date(Number(msg.internalDate)),
    receivedAt: null,
    participants: parseParticipants(msg.payload),
    attachments,
  };
}

// Depth-first walk filling body slots and collecting attachments.
function walk(
  part: GmailPart,
  body: { text: string | null; html: string | null },
  attachments: NormalizedAttachment[]
): void {
  if (isAttachment(part)) {
    attachments.push(toAttachment(part));
    return; // an attachment subtree is not body content
  }
  if (part.parts && part.parts.length > 0) {
    for (const child of part.parts) walk(child, body, attachments);
    return;
  }
  const data = part.body?.data;
  if (data === undefined) return;
  if (part.mimeType === 'text/plain' && body.text === null) {
    body.text = decodeBody(data);
  } else if (part.mimeType === 'text/html' && body.html === null) {
    body.html = decodeBody(data);
  }
}

// A part is an attachment if it names a file, carries an attachmentId, or its
// Content-Disposition is `attachment`. Inline images (disposition `inline` with a
// Content-ID) match via filename/attachmentId and are captured too.
function isAttachment(part: GmailPart): boolean {
  if (part.filename !== undefined && part.filename !== '') return true;
  if (part.body?.attachmentId !== undefined) return true;
  const disposition = header(part, 'content-disposition');
  return (
    disposition !== null && disposition.toLowerCase().startsWith('attachment')
  );
}

function toAttachment(part: GmailPart): NormalizedAttachment {
  const disposition = header(part, 'content-disposition');
  return {
    filename: part.filename ?? '',
    contentType: part.mimeType ?? null,
    sizeBytes: part.body?.size ?? null,
    externalAttachmentId: part.body?.attachmentId ?? null,
    contentId: header(part, 'content-id'),
    disposition: disposition === null ? null : dispositionKind(disposition),
  };
}

// Reduce a Content-Disposition header to its kind (`attachment` / `inline`),
// dropping params like `; filename="x"`.
function dispositionKind(value: string): string {
  return value.split(';')[0]!.trim().toLowerCase();
}

// base64url decode to UTF-8 text. Gmail bodies are base64url (- and _ , no pad).
function decodeBody(data: string): string {
  return Buffer.from(data, 'base64url').toString('utf8');
}

// Case-insensitive header lookup; returns the first match or null.
function header(part: GmailPart, name: string): string | null {
  const lower = name.toLowerCase();
  for (const h of part.headers ?? []) {
    if (h.name.toLowerCase() === lower) return h.value;
  }
  return null;
}

// References is a whitespace-separated list of message ids; null when absent.
function parseReferences(value: string | null): string[] | null {
  if (value === null) return null;
  const ids = value.split(/\s+/).filter((s) => s.length > 0);
  return ids.length > 0 ? ids : null;
}

// Extract participants from the address headers, in From, To, Cc, Bcc order.
function parseParticipants(payload: GmailPart): NormalizedParticipant[] {
  const out: NormalizedParticipant[] = [];
  const roles = [
    { role: 'from', header: 'from' },
    { role: 'to', header: 'to' },
    { role: 'cc', header: 'cc' },
    { role: 'bcc', header: 'bcc' },
  ] as const;
  for (const { role, header: name } of roles) {
    const value = header(payload, name);
    if (value === null) continue;
    for (const addr of splitAddressList(value)) {
      const parsed = parseAddress(addr);
      if (parsed !== null) out.push({ role, ...parsed });
    }
  }
  return out;
}

// Split a comma-separated address list, ignoring commas inside quotes or angle
// brackets (e.g. a quoted display name `"Last, First" <a@b>`).
function splitAddressList(value: string): string[] {
  const parts: string[] = [];
  let current = '';
  let inQuotes = false;
  let inAngle = false;
  for (const ch of value) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (ch === '<') inAngle = true;
    else if (ch === '>') inAngle = false;
    if (ch === ',' && !inQuotes && !inAngle) {
      parts.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  parts.push(current);
  return parts.map((p) => p.trim()).filter((p) => p.length > 0);
}

// Parse one address into { handle, displayName }. Handles `Name <addr>`,
// `"Quoted, Name" <addr>`, and bare `addr`. Returns null if no handle is found.
function parseAddress(
  raw: string
): { handle: string; displayName: string | null } | null {
  const angle = raw.match(/^(.*)<([^>]+)>\s*$/);
  if (angle) {
    const handle = angle[2]!.trim();
    if (handle === '') return null;
    const name = unquote(angle[1]!.trim());
    return { handle, displayName: name.length > 0 ? name : null };
  }
  const handle = raw.trim();
  return handle.length > 0 ? { handle, displayName: null } : null;
}

// Strip surrounding double quotes from a display name, if present.
function unquote(s: string): string {
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
    return s.slice(1, -1);
  }
  return s;
}
