import type {
  Generated,
  Insertable,
  Kysely,
  Selectable,
  Transaction,
  Updateable,
} from 'kysely';

// Kysely database interface — one entry per table.
// Column keys are camelCase; the CamelCasePlugin rewrites them to snake_case
// identifiers in generated SQL. These types are hand-maintained and mirror
// the SQL schema in src/db/migrations.

export interface OrgTable {
  id: Generated<string>;
  name: string;
  createdAt: Generated<Date>;
  updatedAt: Generated<Date>;
}

export interface UserTable {
  id: Generated<string>;
  orgId: string;
  email: string;
  name: string | null;
  role: 'admin' | 'member' | 'viewer';
  createdAt: Generated<Date>;
  updatedAt: Generated<Date>;
}

export interface ProviderAccountTable {
  id: Generated<string>;
  orgId: string;
  userId: string;
  provider: 'gmail' | 'icloud' | 'generic_imap';
  channel: 'email' | 'sms' | 'dm' | 'chat_room';
  authMethod: 'oauth2' | 'app_password' | 'api_key';
  externalAccountId: string;
  alias: string | null;
  credentialsEncrypted: Buffer | null;
  syncCursor: unknown | null;
  lastSyncedAt: Date | null;
  isActive: Generated<boolean>;
  createdAt: Generated<Date>;
  updatedAt: Generated<Date>;
}

export interface ThreadTable {
  id: Generated<string>;
  orgId: string;
  channel: 'email' | 'sms' | 'dm' | 'chat_room';
  externalThreadId: string | null;
  subject: string | null;
  lastMessageAt: Date | null;
  messageCount: Generated<number>;
  createdAt: Generated<Date>;
  updatedAt: Generated<Date>;
}

export interface MessageTable {
  id: Generated<string>;
  orgId: string;
  threadId: string | null;
  providerAccountId: string;
  channel: 'email' | 'sms' | 'dm' | 'chat_room';
  externalMessageId: string;
  senderAddress: string;
  senderName: string | null;
  recipientAddresses: string[];
  ccAddresses: string[] | null;
  bccAddresses: string[] | null;
  subject: string | null;
  bodyText: string | null;
  bodyHtml: string | null;
  direction: 'inbound' | 'outbound';
  sentAt: Date;
  receivedAt: Date | null;
  isRead: Generated<boolean>;
  isStarred: Generated<boolean>;
  isArchived: Generated<boolean>;
  isDeleted: Generated<boolean>;
  createdAt: Generated<Date>;
  updatedAt: Generated<Date>;
}

export interface MessageRawTable {
  messageId: string;
  payload: unknown;
  contentType: string;
  createdAt: Generated<Date>;
}

export interface ContactTable {
  id: Generated<string>;
  orgId: string;
  name: string | null;
  isBlocked: Generated<boolean>;
  createdAt: Generated<Date>;
  updatedAt: Generated<Date>;
}

export interface ContactHandleTable {
  id: Generated<string>;
  contactId: string;
  channel: 'email' | 'sms' | 'dm' | 'chat_room';
  handle: string;
  isPrimary: Generated<boolean>;
  createdAt: Generated<Date>;
}

export interface AttachmentTable {
  id: Generated<string>;
  orgId: string;
  messageId: string;
  filename: string;
  contentType: string | null;
  sizeBytes: string | null; // bigint comes back as string from pg
  storagePath: string;
  createdAt: Generated<Date>;
}

export interface JobQueueTable {
  id: Generated<string>;
  queue: Generated<string>;
  payload: unknown;
  dedupKey: string | null;
  status: Generated<'pending' | 'processing' | 'completed' | 'failed' | 'dead'>;
  attempts: Generated<number>;
  maxAttempts: Generated<number>;
  lastError: string | null;
  lockedAt: Date | null;
  lockedBy: string | null;
  scheduledFor: Generated<Date>;
  completedAt: Date | null;
  createdAt: Generated<Date>;
}

export interface AcmeTable {
  id: Generated<string>;
  orgId: string;
  note: string;
  createdAt: Generated<Date>;
  updatedAt: Generated<Date>;
}

// The top-level keys here MUST match the real table names in the database.
// CamelCasePlugin only rewrites column identifiers, not table identifiers —
// so these stay snake_case (or quoted, for the reserved "user" keyword).
export interface DB {
  org: OrgTable;
  user: UserTable;
  provider_account: ProviderAccountTable;
  thread: ThreadTable;
  message: MessageTable;
  message_raw: MessageRawTable;
  contact: ContactTable;
  contact_handle: ContactHandleTable;
  attachment: AttachmentTable;
  job_queue: JobQueueTable;
  acme: AcmeTable;
}

// A Kysely instance bound to DB, or a transaction against it.
// Repos take this so the same code runs inside or outside a transaction.
export type Db = Kysely<DB>;
export type Tx = Transaction<DB>;
export type DbExecutor = Db | Tx;

// Row type aliases used by repos. Services define their own domain types
// and map from these at the service boundary.
export type OrgRow = Selectable<OrgTable>;
export type NewOrg = Insertable<OrgTable>;
export type OrgUpdate = Updateable<OrgTable>;

export type UserRow = Selectable<UserTable>;
export type NewUser = Insertable<UserTable>;

export type ProviderAccountRow = Selectable<ProviderAccountTable>;
export type NewProviderAccount = Insertable<ProviderAccountTable>;

export type ThreadRow = Selectable<ThreadTable>;
export type NewThread = Insertable<ThreadTable>;

export type MessageRow = Selectable<MessageTable>;
export type NewMessage = Insertable<MessageTable>;

export type JobQueueRow = Selectable<JobQueueTable>;
export type NewJobQueue = Insertable<JobQueueTable>;

export type AcmeRow = Selectable<AcmeTable>;
export type NewAcme = Insertable<AcmeTable>;
export type AcmeUpdate = Updateable<AcmeTable>;
