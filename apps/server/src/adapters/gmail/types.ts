import { z } from 'zod';
import type { TokenSet } from '../lib/oauth2/types.ts';

// Gmail's persisted credentials are an OAuth2 token set. Aliased so the rest of
// the adapter names the domain concept, not the lib type.
export type GmailCredentials = TokenSet;

// The subset of users.getProfile we consume. emailAddress is the authenticated
// account address; the rest are informational.
export const GmailProfileSchema = z.object({
  emailAddress: z.string(),
  messagesTotal: z.number().optional(),
  threadsTotal: z.number().optional(),
  historyId: z.string().optional(),
});
export type GmailProfile = z.infer<typeof GmailProfileSchema>;
