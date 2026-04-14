import type { Repos } from '../../db/repos.js';
import { connectedAccountRowToConnectedAccount } from './mappers.js';
import type { ConnectedAccount, LinkProviderInput } from './types.js';

export function makeProviderService(repos: Repos) {
  return {
    async linkProvider(input: LinkProviderInput): Promise<ConnectedAccount> {
      // Credentials stored as plaintext JSON in dev; encrypted in prod via
      // the crypto layer once it lands.
      const credentialsEncrypted = Buffer.from(JSON.stringify(input.credentials));

      const row = await repos.providers.insert({
        orgId: input.orgId,
        userId: input.userId,
        channel: input.channel,
        provider: input.provider,
        authMethod: input.authMethod,
        label: input.label ?? null,
        credentialsEncrypted,
      });
      return connectedAccountRowToConnectedAccount(row);
    },

    async getConnectedAccount(id: string): Promise<ConnectedAccount> {
      const row = await repos.providers.findById(id);
      if (!row) throw new Error(`Connected account ${id} not found`);
      return connectedAccountRowToConnectedAccount(row);
    },

    async listActive(orgId: string): Promise<ConnectedAccount[]> {
      const rows = await repos.providers.findActiveByOrgId(orgId);
      return rows.map(connectedAccountRowToConnectedAccount);
    },

    async removeConnectedAccount(id: string): Promise<void> {
      await repos.providers.deactivate(id);
    },
  };
}

export type ProviderService = ReturnType<typeof makeProviderService>;
