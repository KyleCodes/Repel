import { z } from 'zod';

// Convention: zod schemas are exported as `*InputSchema`; the inferred TS type
// drops `Schema` and is exported as `*Input`.

// `--org`/`--user` are optional — when omitted, the CLI lib resolvers fall back
// to REPEL_ORG_ID / REPEL_USER_ID.

// `full` is a required literal true: this POC only drives a full sync. A false
// or absent flag is rejected with a message pointing at the ticket that adds
// the incremental/range variants. `limit` arrives as a string from commander, so
// it is coerced; only a positive integer is accepted.
export const SyncRunInputSchema = z.object({
  accountRef: z.string().min(1, 'accountRef is required'),
  full: z.literal(true, {
    message:
      'sync run only supports --full today; incremental/range sync lands in REP-53',
  }),
  limit: z.coerce.number().int().positive().optional(),
  org: z.string().optional(),
  user: z.string().optional(),
});
export type SyncRunInput = z.infer<typeof SyncRunInputSchema>;
