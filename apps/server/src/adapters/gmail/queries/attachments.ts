import { z } from 'zod';
import { type HttpDeps, httpRequest } from '../../../lib/http/client.ts';

const GMAIL_MESSAGES_ENDPOINT =
  'https://gmail.googleapis.com/gmail/v1/users/me/messages';

// The attachments.get response: the bytes as base64url plus their length.
const GmailAttachmentSchema = z.object({
  data: z.string(),
  size: z.number().optional(),
});

// Fetch one attachment's bytes. Gmail only returns the bytes here (format=full
// gives the attachmentId, not the data), so this must run while the access token
// is live. Returns the decoded Buffer ready for the attachment row's bytea
// column. deps.fetchImpl is a test seam.
export async function getGmailAttachment(
  args: { accessToken: string; messageId: string; attachmentId: string },
  deps: HttpDeps = {}
): Promise<Buffer> {
  const res = await httpRequest(
    {
      url: `${GMAIL_MESSAGES_ENDPOINT}/${args.messageId}/attachments/${args.attachmentId}`,
      headers: { authorization: `Bearer ${args.accessToken}` },
      schema: GmailAttachmentSchema,
    },
    deps
  );
  return Buffer.from(res.data, 'base64url');
}
