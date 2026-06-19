import { z } from 'zod';
import { type HttpDeps, httpRequest } from '@repel/http/client';
import { OAuth2NoRefreshTokenError, OAuth2RefreshError } from './error.ts';
import type { OAuth2Config, TokenSet } from './types.ts';

// Refresh the access token once it expires within this window, not only after it
// has already expired — avoids a token dying mid-operation moments after a check.
const DEFAULT_EXPIRY_SKEW_MS = 60_000;

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

// Return a TokenSet with a usable access token, refreshing only when the current
// one is expired/near-expiry (or `force` is set). The shared "don't refresh if we
// don't need to" policy — identical for every OAuth2 adapter, so it lives here
// rather than in any one adapter. `refreshed` tells the caller whether the set
// rotated (and thus needs persisting). Throws OAuth2NoRefreshTokenError when a
// refresh is needed but no refresh token is present, OAuth2RefreshError when the
// grant is rejected.
export async function refreshIfExpired(
  args: {
    config: OAuth2Config;
    tokens: TokenSet;
    force?: boolean;
    skewMs?: number;
  },
  deps: HttpDeps = {}
): Promise<{ tokens: TokenSet; refreshed: boolean }> {
  const { config, tokens, force } = args;
  const skewMs = args.skewMs ?? DEFAULT_EXPIRY_SKEW_MS;

  if (!force && tokens.expiresAt > Date.now() + skewMs) {
    return { tokens, refreshed: false };
  }
  if (tokens.refreshToken === undefined) {
    throw new OAuth2NoRefreshTokenError(
      'credentials have no refresh token; re-auth required'
    );
  }
  let refreshed: TokenSet;
  try {
    refreshed = await refreshTokens(
      { config, refreshToken: tokens.refreshToken },
      deps
    );
  } catch (cause) {
    throw new OAuth2RefreshError('token refresh failed; re-auth required', {
      cause,
    });
  }
  return { tokens: refreshed, refreshed: true };
}
