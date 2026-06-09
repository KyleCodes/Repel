// Each provider gets a directory here (gmail/, icloud/, …) implementing the
// contract in types.ts. Concrete adapter instances are re-exported from this
// barrel; the CLI and runner consume adapters through it.
export { gmailAdapter, gmailCapabilities } from './gmail/index.ts';
export { resolveProviderAdapter } from './registry.ts';
export { ProviderNotFoundError } from './error.ts';
export { runLoopbackFlow } from './lib/oauth2/loopback.ts';
export type {
  IProviderAdapter,
  ProviderAuth,
  ProviderAuthContext,
  ProviderAuthorization,
} from './types.ts';
