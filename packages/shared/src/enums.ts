export const Channel = {
  email: 'email',
  sms: 'sms',
  linkedin: 'linkedin',
  imessage: 'imessage',
  slack: 'slack',
  discord: 'discord',
  whatsapp: 'whatsapp',
} as const;
export type Channel = (typeof Channel)[keyof typeof Channel];

export const Provider = {
  gmail: 'gmail',
  icloud: 'icloud',
  outlook: 'outlook',
  linkedin: 'linkedin',
  imessage: 'imessage',
} as const;
export type Provider = (typeof Provider)[keyof typeof Provider];

export const AuthMethod = {
  oauth2: 'oauth2',
  app_password: 'app_password',
  api_key: 'api_key',
} as const;
export type AuthMethod = (typeof AuthMethod)[keyof typeof AuthMethod];

export const MessageDirection = {
  inbound: 'inbound',
  outbound: 'outbound',
} as const;
export type MessageDirection = (typeof MessageDirection)[keyof typeof MessageDirection];

export const DraftStatus = {
  draft: 'draft',
  sent: 'sent',
  discarded: 'discarded',
} as const;
export type DraftStatus = (typeof DraftStatus)[keyof typeof DraftStatus];

export const TagSource = {
  auto: 'auto',
  manual: 'manual',
} as const;
export type TagSource = (typeof TagSource)[keyof typeof TagSource];

export const UserRole = {
  admin: 'admin',
  member: 'member',
  viewer: 'viewer',
} as const;
export type UserRole = (typeof UserRole)[keyof typeof UserRole];
