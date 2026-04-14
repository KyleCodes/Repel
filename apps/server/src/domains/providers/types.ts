import type { AuthMethod, Channel, Provider } from '@repel/shared';

// Domain type for a connected provider account. Notably omits
// credentialsEncrypted — credentials must never leak past the service layer.
export interface ConnectedAccount {
  id: string;
  orgId: string;
  userId: string;
  channel: Channel;
  provider: Provider;
  authMethod: AuthMethod;
  label: string | null;
  isActive: boolean;
  lastSyncedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface LinkProviderInput {
  orgId: string;
  userId: string;
  channel: Channel;
  provider: Provider;
  authMethod: AuthMethod;
  label?: string;
  credentials: Record<string, string>;
}
