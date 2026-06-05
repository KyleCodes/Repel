import { z } from 'zod';
import { type HttpDeps, httpRequest } from '../../../lib/http/client.ts';
import type { OAuth2Config, TokenSet } from './types.ts';

// The provider token response. expires_in is seconds; refresh_token is optional
// because a refresh grant returns none.
const TokenResponseSchema = z.object({
  access_token: z.string(),
  expires_in: z.number(),
  refresh_token: z.string().optional(),
  scope: z.string().optional(),
  token_type: z.string(),
});

type TokenResponse = z.infer<typeof TokenResponseSchema>;

// Build the consent URL. Pure: state and challenge are supplied by the caller so
// this stays deterministic and testable. The code_verifier is never included.
export function buildAuthUrl(args: {
  config: OAuth2Config;
  state: string;
  challenge: string;
}): string {
  const { config, state, challenge } = args;
  const url = new URL(config.authEndpoint);
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', config.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', config.scopes.join(' '));
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  for (const [key, value] of Object.entries(config.extraAuthParams ?? {})) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

function toTokenSet(
  res: TokenResponse,
  fallbackRefreshToken?: string
): TokenSet {
  return {
    accessToken: res.access_token,
    refreshToken: res.refresh_token ?? fallbackRefreshToken,
    expiresAt: Date.now() + res.expires_in * 1000,
    scope: res.scope,
    tokenType: res.token_type,
  };
}

// Exchange an authorization code for tokens. The redirect_uri MUST byte-match
// the one used in buildAuthUrl — the caller threads the same config. deps.fetchImpl
// is a test seam, defaulting to the global fetch.
export async function exchangeCode(
  args: {
    config: OAuth2Config;
    code: string;
    verifier: string;
  },
  deps: HttpDeps = {}
): Promise<TokenSet> {
  const { config, code, verifier } = args;
  const res = await httpRequest(
    {
      method: 'POST',
      url: config.tokenEndpoint,
      encoding: 'form',
      schema: TokenResponseSchema,
      body: {
        grant_type: 'authorization_code',
        code,
        redirect_uri: config.redirectUri,
        client_id: config.clientId,
        client_secret: config.clientSecret,
        code_verifier: verifier,
      },
    },
    deps
  );
  return toTokenSet(res);
}

// Exchange a refresh token for a fresh access token. The provider does not
// return a new refresh token, so the existing one is preserved on the result.
// deps.fetchImpl is a test seam, defaulting to the global fetch.
export async function refreshTokens(
  args: {
    config: OAuth2Config;
    refreshToken: string;
  },
  deps: HttpDeps = {}
): Promise<TokenSet> {
  const { config, refreshToken } = args;
  const res = await httpRequest(
    {
      method: 'POST',
      url: config.tokenEndpoint,
      encoding: 'form',
      schema: TokenResponseSchema,
      body: {
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: config.clientId,
        client_secret: config.clientSecret,
      },
    },
    deps
  );
  return toTokenSet(res, refreshToken);
}
