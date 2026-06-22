import { z } from 'zod';

// The subset of users.getProfile we consume. emailAddress is the authenticated
// account address; the rest are informational.
export const GmailProfileSchema = z.object({
  emailAddress: z.string(),
  messagesTotal: z.number().optional(),
  threadsTotal: z.number().optional(),
  historyId: z.string().optional(),
});
export type GmailProfile = z.infer<typeof GmailProfileSchema>;
