import { z } from 'zod';
import { Provider, type ProviderSlug } from '@repel/shared';

// The Provider enum values as a non-empty tuple typed to ProviderSlug, so
// z.enum infers the ProviderSlug union (not bare string). This is the single
// boundary cast — `Object.values` widens to string[], and the tuple form is
// what z.enum needs. Downstream consumers get ProviderSlug with no further cast.
const PROVIDER_VALUES = Object.values(Provider) as [
  ProviderSlug,
  ...ProviderSlug[],
];

// Convention: zod schemas are exported as `*InputSchema`; the inferred TS type
// drops `Schema` and is exported as `*Input`. `AccountListInputSchema` (the
// validator) → `AccountListInput` (the type).

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
// truth for the enum. `--alias` is an optional human label for the account; an
// empty string is rejected so `--alias ''` fails fast rather than storing blank.
export const AccountAddInputSchema = z.object({
  org: z.string().optional(),
  user: z.string().optional(),
  provider: z.enum(PROVIDER_VALUES),
  alias: z.string().min(1).optional(),
});
export type AccountAddInput = z.infer<typeof AccountAddInputSchema>;

// The `<account>` positional resolves by one of three forms: the uuid we
// assign (configuration id), the provider's external id, or an alias.
// AccountTokenSchema validates the uuid form so resolveAccount can branch
// on it; a non-match falls through to the external-id / alias lookups.
export const AccountTokenSchema = z.string().uuid();
export type AccountToken = z.infer<typeof AccountTokenSchema>;
