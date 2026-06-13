import { type HttpDeps, httpRequest } from '../../../lib/http/client.ts';
import { type GmailProfile, GmailProfileSchema } from '../types.ts';

const GMAIL_PROFILE_ENDPOINT =
  'https://gmail.googleapis.com/gmail/v1/users/me/profile';

// Fetch the authenticated account's profile. deps.fetchImpl is a test seam,
// defaulting to the global fetch.
export function getGmailProfile(
  args: { accessToken: string },
  deps: HttpDeps = {}
): Promise<GmailProfile> {
  return httpRequest(
    {
      url: GMAIL_PROFILE_ENDPOINT,
      headers: { authorization: `Bearer ${args.accessToken}` },
      schema: GmailProfileSchema,
    },
    deps
  );
}
