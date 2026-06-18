import { AuthMethod } from '@repel/enums';
import type { HttpDeps } from '@repel/http/client';
import { OAuth2StateMismatchError } from '../lib/oauth2/error.ts';
import { buildAuthUrl, exchangeCode } from '../lib/oauth2/flow.ts';
import { generatePkce, generateState } from '../lib/oauth2/pkce.ts';
import type {
  OAuth2Auth,
  OAuthAuthorize,
  OAuthExchangeInput,
} from '../types.ts';
import { loadGmailOAuthConfig, withRedirectUri } from './oauth.ts';
import { getGmailProfile } from './queries/profile.ts';

export const gmailAuth: OAuth2Auth = {
  method: 'oauth2',

  // Authorization request: build the consent URL with the bound redirect URI, a
  // fresh PKCE pair, and a state nonce. The verifier is returned to the caller
  // and never placed in the URL (only the challenge is sent to Google).
  async authorize(ctx): Promise<OAuthAuthorize> {
    const config = withRedirectUri(loadGmailOAuthConfig(), ctx.redirectUri);
    const { verifier, challenge } = generatePkce();
    const state = generateState();
    const authUrl = buildAuthUrl({ config, state, challenge });
    return { authUrl, state, pkceVerifier: verifier };
  },

  // Token request: validate the echoed state (a CSRF guard), exchange the code
  // for tokens, then read the authenticated account's email as the external
  // account id. `deps` is threaded to both network calls so tests can inject a
  // fetch stub.
  async exchange(input: OAuthExchangeInput, deps?: HttpDeps) {
    if (input.state !== input.expectedState) {
      throw new OAuth2StateMismatchError('state nonce did not match');
    }
    const config = withRedirectUri(loadGmailOAuthConfig(), input.redirectUri);
    const credentials = await exchangeCode(
      { config, code: input.code, verifier: input.pkceVerifier },
      deps
    );
    const profile = await getGmailProfile(
      { accessToken: credentials.accessToken },
      deps
    );
    return {
      externalAccountId: profile.emailAddress.toLowerCase(),
      authMethod: AuthMethod.oauth2,
      credentials,
    };
  },
};
