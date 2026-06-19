import { z } from 'zod';
import type { TokenSet } from '../lib/oauth2/types';

// Gmail's credentials as handed to the adapter at ingest time: the OAuth2 token
// set, tagged with the provider so ProviderCredentials narrows without a cast.
// The `provider` tag is in-memory only — the runner stamps it from the
// provider_account.provider column after decrypting. What's stored at rest is a
// bare TokenSet (see cli/accounts/handler.ts), so the stored shape is unchanged.
export interface GmailCredentials {
  readonly provider: 'gmail';
  readonly tokens: TokenSet;
}

// The subset of users.getProfile we consume. emailAddress is the authenticated
// account address; the rest are informational.
export const GmailProfileSchema = z.object({
  emailAddress: z.string(),
  messagesTotal: z.number().optional(),
  threadsTotal: z.number().optional(),
  historyId: z.string().optional(),
});
export type GmailProfile = z.infer<typeof GmailProfileSchema>;
