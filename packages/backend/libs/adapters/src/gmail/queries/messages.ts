import { z } from 'zod';
import { type HttpDeps, httpRequest } from '@repel/http/client';

const GMAIL_MESSAGES_ENDPOINT =
  'https://gmail.googleapis.com/gmail/v1/users/me/messages';

// One header on a Gmail message part: a name/value pair. Gmail returns the
// canonical casing, but consumers must match case-insensitively.
export const GmailHeaderSchema = z.object({
  name: z.string(),
  value: z.string(),
});

// A part's body. `data` (base64url) is present on leaf content parts; absent on
// containers and on attachment parts, which instead carry an `attachmentId` to
// fetch the bytes separately. `size` is the decoded byte length.
export const GmailBodySchema = z.object({
  data: z.string().optional(),
  size: z.number().optional(),
  attachmentId: z.string().optional(),
});

// A node in the MIME tree. Recursive: a multipart container nests `parts`, each
// of which may itself be a container. Typed explicitly so z.lazy keeps the
// self-reference.
export interface GmailPart {
  readonly partId?: string;
  readonly mimeType?: string;
  readonly filename?: string;
  readonly headers?: readonly z.infer<typeof GmailHeaderSchema>[];
  readonly body?: z.infer<typeof GmailBodySchema>;
  readonly parts?: readonly GmailPart[];
}

export const GmailPartSchema: z.ZodType<GmailPart> = z.lazy(function () {
  return z.object({
    partId: z.string().optional(),
    mimeType: z.string().optional(),
    filename: z.string().optional(),
    headers: z.array(GmailHeaderSchema).optional(),
    body: GmailBodySchema.optional(),
    parts: z.array(GmailPartSchema).optional(),
  });
});

// A full Gmail message (format=full). `internalDate` is epoch milliseconds as a
// string — Gmail's server receipt time, the source for the normalized `sentAt`.
export const GmailMessageSchema = z.object({
  id: z.string(),
  threadId: z.string(),
  internalDate: z.string(),
  snippet: z.string().optional(),
  historyId: z.string().optional(),
  labelIds: z.array(z.string()).optional(),
  payload: GmailPartSchema,
});
export type GmailMessage = z.infer<typeof GmailMessageSchema>;

// A reference returned by messages.list — just the ids; the full message is a
// separate get.
export const GmailMessageRefSchema = z.object({
  id: z.string(),
  threadId: z.string(),
});

// One page of messages.list. `messages` is absent (not empty) on an empty
// mailbox or a page past the end.
export const GmailMessageListSchema = z.object({
  messages: z.array(GmailMessageRefSchema).optional(),
  nextPageToken: z.string().optional(),
  resultSizeEstimate: z.number().optional(),
});
export type GmailMessageList = z.infer<typeof GmailMessageListSchema>;

// List a single page of message ids. Pagination (following nextPageToken up to a
// cap) is the caller's job; this is one request. `maxResults` bounds the page
// size; `pageToken` resumes a prior list. deps.fetchImpl is a test seam.
export function listGmailMessages(
  args: { accessToken: string; pageToken?: string; maxResults?: number },
  deps: HttpDeps = {}
): Promise<GmailMessageList> {
  const params: Record<string, string> = {};
  if (args.pageToken !== undefined) params.pageToken = args.pageToken;
  if (args.maxResults !== undefined)
    params.maxResults = String(args.maxResults);
  return httpRequest(
    {
      url: GMAIL_MESSAGES_ENDPOINT,
      params,
      headers: { authorization: `Bearer ${args.accessToken}` },
      schema: GmailMessageListSchema,
    },
    deps
  );
}

// Fetch one message in full (the parsed MIME tree). format=full gives Gmail's
// pre-parsed payload tree — no raw RFC822 to re-parse. deps.fetchImpl is a test
// seam.
export function getGmailMessage(
  args: { accessToken: string; id: string },
  deps: HttpDeps = {}
): Promise<GmailMessage> {
  return httpRequest(
    {
      url: `${GMAIL_MESSAGES_ENDPOINT}/${args.id}`,
      params: { format: 'full' },
      headers: { authorization: `Bearer ${args.accessToken}` },
      schema: GmailMessageSchema,
    },
    deps
  );
}
