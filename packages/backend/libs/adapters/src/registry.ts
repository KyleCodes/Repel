import { Provider, type ProviderSlug } from '@repel/enums';
import { ProviderNotFoundError } from './error.ts';
import { gmailAdapter } from './gmail/index.ts';
import type { IProviderAdapter } from './types.ts';

const adapters: Partial<Record<ProviderSlug, IProviderAdapter>> = {
  [Provider.gmail]: gmailAdapter,
};

export function resolveProviderAdapter(
  provider: ProviderSlug
): IProviderAdapter {
  const adapter = adapters[provider];
  if (!adapter) {
    throw new ProviderNotFoundError(`no adapter registered for "${provider}"`);
  }
  return adapter;
}
