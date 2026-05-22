import { z } from 'zod';
import { Provider } from '@repel/shared';

// Convention: zod schemas are exported as `*InputSchema`; the inferred TS type
// drops `Schema` and is exported as `*Input`. `BootstrapInputSchema` (the
// validator) → `BootstrapInput` (the type).

export const BootstrapInputSchema = z.object({
  orgName: z.string().min(1, 'org name is required'),
  email: z.string().email('valid email is required'),
  name: z.string().min(1).optional(),
  dryRun: z.boolean().default(false),
});
export type BootstrapInput = z.infer<typeof BootstrapInputSchema>;

// `--org`/`--user` are optional on every verb — when omitted, the CLI lib
// resolvers fall back to REPEL_ORG_ID / REPEL_USER_ID.

export const AccountListInputSchema = z.object({
  org: z.string().optional(),
  user: z.string().optional(),
});
export type AccountListInput = z.infer<typeof AccountListInputSchema>;

export const AccountShowInputSchema = z.object({
  org: z.string().optional(),
  account: z.string().min(1, 'account is required'),
});
export type AccountShowInput = z.infer<typeof AccountShowInputSchema>;

export const AccountRmInputSchema = z.object({
  org: z.string().optional(),
  account: z.string().min(1, 'account is required'),
  yes: z.boolean().default(false),
});
export type AccountRmInput = z.infer<typeof AccountRmInputSchema>;

// Provider slug values are sourced from @repel/shared — the single source of
// truth for the enum. `add` is stubbed (the token flow lands in REP-22) but
// the provider is still validated here so the stub fails fast on a typo.
export const AccountAddInputSchema = z.object({
  org: z.string().optional(),
  user: z.string().optional(),
  provider: z.enum(Object.values(Provider) as [string, ...string[]]),
});
export type AccountAddInput = z.infer<typeof AccountAddInputSchema>;

// The `<account>` positional resolves by one of three forms: the uuid we
// assign (configuration id), the provider's external id, or an alias.
// AccountTokenSchema validates the uuid form so resolveAccount can branch
// on it; a non-match falls through to the external-id / alias lookups.
export const AccountTokenSchema = z.string().uuid();
export type AccountToken = z.infer<typeof AccountTokenSchema>;
