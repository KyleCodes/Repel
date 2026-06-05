import { AuthMethod } from '@repel/shared';
import { exchangeCode } from '../lib/oauth2/flow.ts';
import { runLoopbackFlow } from '../lib/oauth2/loopback.ts';
import type { ProviderAuthContext, ProviderAuthorization } from '../types.ts';
import { loadGmailOAuthConfig, withRedirectUri } from './oauth.ts';
import { getGmailProfile } from './profile.ts';

// Interactive OAuth: run the loopback consent flow, exchange the code for
// tokens, then read the account address to use as the external account id.
// loadGmailOAuthConfig returns the config without a redirect URI because the
// URI is only known once the loopback listener binds an ephemeral port;
// runLoopbackFlow derives it and hands it back, and withRedirectUri stamps it
// onto the config so the token-exchange redirect_uri byte-matches the consent
// URL's.
export async function promptUserAuthorization(
  _input: ProviderAuthContext
): Promise<ProviderAuthorization> {
  const baseConfig = loadGmailOAuthConfig();

  const { code, verifier, redirectUri } = await runLoopbackFlow({
    config: baseConfig,
  });

  const config = withRedirectUri(baseConfig, redirectUri);
  const credentials = await exchangeCode({ config, code, verifier });
  const profile = await getGmailProfile({
    accessToken: credentials.accessToken,
  });

  return {
    externalAccountId: profile.emailAddress.toLowerCase(),
    authMethod: AuthMethod.oauth2,
    credentials,
  };
}
