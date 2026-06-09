import { Provider, type ProviderSlug } from '@repel/shared';
import { accountsService } from '../../features/accounts/service.ts';
import type { GetProviderAccountResult } from '../../features/accounts/views/get-provider-account.ts';
import { AccountTokenSchema } from '../accounts/schemas/index.ts';

// Resolves a `<account>` CLI token to exactly one provider account.
//
// Classification (first match wins):
//   1. a uuid (the configuration id we assign) → look up by id.
//   2. `<provider>:<externalAccountId>` — a colon, with a valid Provider
//      slug before the first colon → external-id lookup.
//   3. anything else → alias lookup (including a colon-bearing token whose
//      prefix is not a known provider).
//
// 0 matches throws not-found; >1 throws an ambiguity error listing each
// candidate. Calls accountsService directly — the lookups hit the DB, so
// resolveAccount's behavior is verified end to end rather than unit-tested.

export type ResolveAccountContext = { orgId: string };

function isProviderSlug(value: string): value is ProviderSlug {
  return Object.values(Provider).includes(value as ProviderSlug);
}

// Renders one candidate for an ambiguity error.
function describe(account: GetProviderAccountResult): string {
  return `${account.id} (alias=${account.alias ?? '-'}, ${account.provider}:${account.externalAccountId})`;
}

export async function resolveAccount(
  token: string,
  ctx: ResolveAccountContext
): Promise<GetProviderAccountResult> {
  // 1. uuid → by id.
  if (AccountTokenSchema.safeParse(token).success) {
    const providerAccount = await accountsService.getProviderAccount({
      orgId: ctx.orgId,
      providerAccount: { id: token },
    });
    if (!providerAccount) {
      throw new Error(
        `account not found: no provider account with id ${token}`
      );
    }
    return providerAccount;
  }

  // 2/3. provider:ext when the prefix is a known provider, else alias.
  const colon = token.indexOf(':');
  let matches: GetProviderAccountResult[];
  if (colon > 0 && isProviderSlug(token.slice(0, colon))) {
    matches = await accountsService.findProviderAccountsByRef({
      orgId: ctx.orgId,
      providerAccount: {
        provider: token.slice(0, colon) as ProviderSlug,
        externalAccountId: token.slice(colon + 1),
      },
    });
  } else {
    matches = await accountsService.findProviderAccountsByRef({
      orgId: ctx.orgId,
      providerAccount: { alias: token },
    });
  }

  if (matches.length === 0) {
    throw new Error(`account not found: no provider account matching ${token}`);
  }
  if (matches.length > 1) {
    throw new Error(
      `account ambiguous: ${token} matches ${matches.length} accounts — ` +
        matches.map(describe).join('; ')
    );
  }
  return matches[0]!;
}
