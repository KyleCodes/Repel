import { withOrgTx, withTx } from '../../db/tx.js';
import { makeOrgService } from '../org/service.js';
import { makeUserService } from '../user/service.js';
import { makeProviderService } from '../providers/service.js';
import type { ConnectedAccount, LinkProviderInput } from '../providers/types.js';
import type { BootstrapInput, BootstrapResult } from './types.js';

// Cross-cutting flows that span multiple domains. Each method owns its own
// transaction scope — bootstrap uses withTx (no org yet), everything else
// uses withOrgTx so RLS engages.
export function makeAccountSetupService() {
  return {
    async bootstrapAccount(input: BootstrapInput): Promise<BootstrapResult> {
      return withTx(async function (repos) {
        const org = await makeOrgService(repos).createOrg({ name: input.orgName });
        const user = await makeUserService(repos).createUser({
          orgId: org.id,
          email: input.userEmail,
          name: input.userName,
        });
        return { org, user };
      });
    },

    async linkProvider(input: LinkProviderInput): Promise<ConnectedAccount> {
      return withOrgTx(input.orgId, async function (repos) {
        return makeProviderService(repos).linkProvider(input);
      });
    },
  };
}

export type AccountSetupService = ReturnType<typeof makeAccountSetupService>;
