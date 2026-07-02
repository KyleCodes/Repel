import { z } from 'zod';

// Convention: zod schemas are exported as `*InputSchema`; the inferred type
// drops `Schema` and is exported as `*Input`.
//
// `--org`/`--user` are optional — when omitted, the CLI lib resolvers fall back
// to REPEL_ORG_ID / REPEL_USER_ID. v0 requires `--full`; the handler enforces
// it (so the error surfaces as a typed CLI error, not a zod issue). `--limit` is
// an optional positive-int dev cap; commander hands it over as a string, so it
// is coerced. `--unbounded` opts a full sync out of the default cap (pull the
// whole mailbox); it is mutually exclusive with `--limit` (handler-enforced).
// `--enqueue` pushes the job onto the `sync` topic for the worker to run instead
// of running it in-process (REP-57).
export const SyncRunInputSchema = z.object({
  org: z.string().optional(),
  user: z.string().optional(),
  account: z.string().min(1, 'account is required'),
  full: z.boolean().default(false),
  limit: z.coerce.number().int().positive().optional(),
  unbounded: z.boolean().default(false),
  enqueue: z.boolean().default(false),
});
export type SyncRunInput = z.infer<typeof SyncRunInputSchema>;

// Read verbs. `syncs list` is org/user-scoped (env fallback); `syncs show` takes
// a required job id positional and is org-scoped.
export const SyncsListInputSchema = z.object({
  org: z.string().optional(),
  user: z.string().optional(),
});
export type SyncsListInput = z.infer<typeof SyncsListInputSchema>;

export const SyncsShowInputSchema = z.object({
  org: z.string().optional(),
  jobId: z.string().min(1, 'jobId is required'),
});
export type SyncsShowInput = z.infer<typeof SyncsShowInputSchema>;
