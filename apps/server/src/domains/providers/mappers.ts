import type { ConnectedAccountRow } from '../../db/types.js';
import type { ConnectedAccount } from './types.js';

export function connectedAccountRowToConnectedAccount(
  row: ConnectedAccountRow
): ConnectedAccount {
  return {
    id: row.id,
    orgId: row.orgId,
    userId: row.userId,
    channel: row.channel,
    provider: row.provider,
    authMethod: row.authMethod,
    label: row.label,
    isActive: row.isActive,
    lastSyncedAt: row.lastSyncedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
