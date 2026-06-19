import { type HttpDeps, httpRequest } from '@repel/http/client';
import { type GmailProfile, GmailProfileSchema } from '../types';

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
