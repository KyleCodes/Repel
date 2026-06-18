// Everything a provider-agnostic OAuth2 authorization-code (PKCE) flow needs.
// extraAuthParams carries provider-specific knobs appended to the consent URL
// (e.g. Gmail's access_type=offline / prompt=consent to force a refresh token).
export interface OAuth2Config {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly authEndpoint: string;
  readonly tokenEndpoint: string;
  readonly scopes: readonly string[];
  readonly redirectUri: string;
  readonly extraAuthParams?: Record<string, string>;
}

// The serializable result of a token exchange. No class — the platform stores
// this encrypted and round-trips it back into ingest()/send() unread.
// expiresAt is epoch milliseconds. refreshToken is optional because a refresh
// grant does not return a new one.
export interface TokenSet {
  readonly accessToken: string;
  readonly refreshToken?: string;
  readonly expiresAt: number;
  readonly scope?: string;
  readonly tokenType: string;
}
