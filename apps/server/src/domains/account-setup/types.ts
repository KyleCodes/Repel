import type { Org } from '../org/types.js';
import type { User } from '../user/types.js';

export interface BootstrapInput {
  orgName: string;
  userEmail: string;
  userName?: string;
}

export interface BootstrapResult {
  org: Org;
  user: User;
}
