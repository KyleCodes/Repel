import { z } from 'zod';

// Convention: zod schemas are exported as `*InputSchema`; the inferred type
// drops `Schema` and is exported as `*Input`.
//
// `--org`/`--user` are optional — when omitted, the CLI lib resolvers fall back
// to REPEL_ORG_ID / REPEL_USER_ID. v0 requires `--full`; the handler enforces
// it (so the error surfaces as a typed CLI error, not a zod issue). `--limit` is
// an optional positive-int dev cap; commander hands it over as a string, so it
// is coerced. `--enqueue` pushes the job onto the `sync` topic for the worker to
// run instead of running it in-process (REP-57).
export const SyncRunInputSchema = z.object({
  org: z.string().optional(),
  user: z.string().optional(),
  account: z.string().min(1, 'account is required'),
  full: z.boolean().default(false),
  limit: z.coerce.number().int().positive().optional(),
  enqueue: z.boolean().default(false),
});
export type SyncRunInput = z.infer<typeof SyncRunInputSchema>;
