import { getRequiredEnvVar } from '@repel/backend-env/accessors';
import type { OAuth2Config } from '../lib/oauth2/types';

export const GMAIL_AUTH_ENDPOINT =
  'https://accounts.google.com/o/oauth2/v2/auth';
export const GMAIL_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

// Read-only mailbox access. gmail.readonly also covers users.getProfile, which
// is how we resolve the authenticated account's email address.
export const GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
] as const;

// Build the Gmail OAuth2 config, minus the redirect URI. The redirect URI is
// only known after the loopback listener binds an ephemeral port, so the caller
// adds it with withRedirectUri once the port is up. Credentials come from the
// environment (loaded from .env.local at startup); access_type=offline +
// prompt=consent are required for Google to issue a refresh token.
export function loadGmailOAuthConfig(): Omit<OAuth2Config, 'redirectUri'> {
  return {
    clientId: getRequiredEnvVar('REPEL_GMAIL_CLIENT_ID'),
    clientSecret: getRequiredEnvVar('REPEL_GMAIL_CLIENT_SECRET'),
    authEndpoint: GMAIL_AUTH_ENDPOINT,
    tokenEndpoint: GMAIL_TOKEN_ENDPOINT,
    scopes: GMAIL_SCOPES,
    extraAuthParams: { access_type: 'offline', prompt: 'consent' },
  };
}

// Complete an OAuth2 config with the bound redirect URI. Kept tiny so the
// byte-exact redirect URI flows unchanged from the consent URL into the token
// exchange.
export function withRedirectUri(
  config: Omit<OAuth2Config, 'redirectUri'>,
  redirectUri: string
): OAuth2Config {
  return { ...config, redirectUri };
}
