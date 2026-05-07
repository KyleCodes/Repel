// Internal slug values for enum-typed columns and code paths. The slug is
// the canonical identifier used by the database, backend, frontend, and CLI.
// User-facing display strings are derived via the `*DisplayName` helpers
// below — never inline display strings inside business logic.

export const Channel = {
  email: 'email',
  sms: 'sms',
  dm: 'dm',
  chat_room: 'chat_room',
} as const;
export type ChannelSlug = (typeof Channel)[keyof typeof Channel];

const channelDisplayNames: Record<ChannelSlug, string> = {
  email: 'Email',
  sms: 'SMS',
  dm: 'Direct Message',
  chat_room: 'Chat Room',
};

export function channelDisplayName(channel: ChannelSlug): string {
  return channelDisplayNames[channel];
}

export const Provider = {
  gmail: 'gmail',
  icloud: 'icloud',
  generic_imap: 'generic_imap',
} as const;
export type ProviderSlug = (typeof Provider)[keyof typeof Provider];

// Provider display names live in shared today because the provider registry
// at apps/server/src/providers/ does not exist yet. When the registry lands
// (per ADR-005), these display names move into each provider's definition.ts
// alongside its OAuth config / channel binding / auth method, and shared
// only continues to export ProviderSlug.
const providerDisplayNames: Record<ProviderSlug, string> = {
  gmail: 'Gmail',
  icloud: 'iCloud',
  generic_imap: 'IMAP',
};

export function providerDisplayName(provider: ProviderSlug): string {
  return providerDisplayNames[provider];
}

export const AuthMethod = {
  oauth2: 'oauth2',
  app_password: 'app_password',
  api_key: 'api_key',
} as const;
export type AuthMethodSlug = (typeof AuthMethod)[keyof typeof AuthMethod];

const authMethodDisplayNames: Record<AuthMethodSlug, string> = {
  oauth2: 'OAuth 2.0',
  app_password: 'App Password',
  api_key: 'API Key',
};

export function authMethodDisplayName(authMethod: AuthMethodSlug): string {
  return authMethodDisplayNames[authMethod];
}

export const MessageDirection = {
  inbound: 'inbound',
  outbound: 'outbound',
} as const;
export type MessageDirectionSlug =
  (typeof MessageDirection)[keyof typeof MessageDirection];

export const UserRole = {
  admin: 'admin',
  member: 'member',
  viewer: 'viewer',
} as const;
export type UserRoleSlug = (typeof UserRole)[keyof typeof UserRole];
