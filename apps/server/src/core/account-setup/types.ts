import type { Org } from '../org/types.ts';
import type { User } from '../user/types.ts';

export interface BootstrapInput {
  orgName: string;
  userEmail: string;
  userName?: string;
}

export interface BootstrapResult {
  org: Org;
  user: User;
}
