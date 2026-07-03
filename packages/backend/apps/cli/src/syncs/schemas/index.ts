import { DateTime } from 'luxon';
import { z } from 'zod';

// Convention: zod schemas are exported as `*InputSchema`; the inferred type
// drops `Schema` and is exported as `*Input`.
//
// `syncs run` splits into three subcommands (full / incremental / range). The
// shared options live on the parent command; each subcommand's own flags parse
// against its per-mode schema below. `--org`/`--user` are optional — when
// omitted, the CLI lib resolvers fall back to REPEL_ORG_ID / REPEL_USER_ID.
// `--enqueue` pushes the job onto the `sync` topic for the worker to run instead
// of running it in-process (REP-57). Cross-field rules (limit+unbounded,
// range both-omitted, incremental no-cursor) are enforced as typed CLI errors in
// the handler, not here (house style — no zod superRefine for those).

// An ISO 8601 instant, validated by parseability. Commander hands over the raw
// string; the adapter deserializes to a Luxon DateTime at its boundary, so a
// string that DateTime can't parse would fail there — reject it here instead.
const isoString = z
  .string()
  .refine((s) => DateTime.fromISO(s).isValid, 'must be an ISO 8601 datetime');

// Shared parent options every `syncs run` subcommand resolves.
export const SyncRunSharedInputSchema = z.object({
  org: z.string().optional(),
  user: z.string().optional(),
  account: z.string().min(1, 'account is required'),
  enqueue: z.boolean().default(false),
});
export type SyncRunSharedInput = z.infer<typeof SyncRunSharedInputSchema>;

// `full`: `--limit` is an optional positive-int dev cap (commander hands it over
// as a string, so it is coerced); `--unbounded` opts out of the default cap
// (pull the whole mailbox), mutually exclusive with `--limit` (handler-enforced).
export const SyncRunFullInputSchema = z.object({
  limit: z.coerce.number().int().positive().optional(),
  unbounded: z.boolean().default(false),
});
export type SyncRunFullInput = z.infer<typeof SyncRunFullInputSchema>;

// `incremental`: both override the auto-resumed cursor. `--since` is an ISO
// start (→ `{ lastInternalDate }`); `--cursor` is raw cursor JSON, parsed in the
// handler. Neither given → resume from the last completed sync (handler).
export const SyncRunIncrementalInputSchema = z.object({
  since: isoString.optional(),
  cursor: z.string().optional(),
});
export type SyncRunIncrementalInput = z.infer<
  typeof SyncRunIncrementalInputSchema
>;

// `range`: a bounded window; `--from`/`--to` are ISO, both optional, but at least
// one is required (handler-enforced — an unbounded range is a full sync).
export const SyncRunRangeInputSchema = z.object({
  from: isoString.optional(),
  to: isoString.optional(),
});
export type SyncRunRangeInput = z.infer<typeof SyncRunRangeInputSchema>;

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
