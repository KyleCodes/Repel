import { z } from 'zod';

// Convention: zod schemas are exported as `*InputSchema`; the inferred TS type
// drops `Schema` and is exported as `*Input`. `DumpInputSchema` (the validator)
// → `DumpInput` (the type).

const DEFAULT_TEMPLATE = 'repel_dev';

// `db dump` execs pg_dump inside the source stack's postgres container and writes
// the archive to --out. Run from the source worktree dir so `docker compose`
// resolves that worktree's project. --database defaults to the stack DB (repel).
export const DumpInputSchema = z.object({
  out: z.string().min(1, 'out file path is required'),
  database: z.string().min(1).default('repel'),
});
export type DumpInput = z.infer<typeof DumpInputSchema>;

// `db restore` execs pg_restore inside THIS worktree's postgres container, reading
// the archive from --from-file. Manual escape hatch — the postgres init hook is
// the automatic path on a fresh worktree.
export const RestoreInputSchema = z.object({
  fromFile: z.string().min(1, 'from-file path is required'),
  database: z.string().min(1).default('repel'),
});
export type RestoreInput = z.infer<typeof RestoreInputSchema>;

export const RefreshTemplateInputSchema = z.object({
  template: z.string().min(1).default(DEFAULT_TEMPLATE),
});
export type RefreshTemplateInput = z.infer<typeof RefreshTemplateInputSchema>;

export const StatusInputSchema = z.object({});
export type StatusInput = z.infer<typeof StatusInputSchema>;

export const NukeInputSchema = z.object({
  yes: z.boolean().default(false),
});
export type NukeInput = z.infer<typeof NukeInputSchema>;

export const CodegenInputSchema = z.object({});
export type CodegenInput = z.infer<typeof CodegenInputSchema>;

export const ConnectInputSchema = z.object({});
export type ConnectInput = z.infer<typeof ConnectInputSchema>;

export const QueryInputSchema = z.object({
  // The literal `-` is the stdin sentinel (DR-REP-40-2); the handler reads SQL
  // from stdin when it sees it. Any other non-empty string is literal SQL.
  sql: z.string().min(1, 'sql is required'),
});
export type QueryInput = z.infer<typeof QueryInputSchema>;
