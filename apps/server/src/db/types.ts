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

export interface ConnectedAccountTable {
  id: Generated<string>;
  orgId: string;
  userId: string;
  channel: 'email' | 'sms' | 'linkedin' | 'imessage' | 'slack' | 'discord' | 'whatsapp';
  provider: 'gmail' | 'icloud' | 'outlook' | 'linkedin' | 'imessage';
  authMethod: 'oauth2' | 'app_password' | 'api_key';
  label: string | null;
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
  channel: 'email' | 'sms' | 'linkedin' | 'imessage' | 'slack' | 'discord' | 'whatsapp';
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
  connectedAccountId: string;
  channel: 'email' | 'sms' | 'linkedin' | 'imessage' | 'slack' | 'discord' | 'whatsapp';
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

export interface MessageClassificationTable {
  id: Generated<string>;
  orgId: string;
  messageId: string;
  category: string;
  subcategory: string | null;
  confidence: number | null;
  classifierVersion: string | null;
  createdAt: Generated<Date>;
}

export interface MessageTagTable {
  messageId: string;
  orgId: string;
  tag: string;
  source: Generated<'auto' | 'manual'>;
  createdAt: Generated<Date>;
}

export interface MessageSummaryTable {
  id: Generated<string>;
  orgId: string;
  messageId: string;
  summary: string;
  model: string | null;
  createdAt: Generated<Date>;
}

export interface DraftReplyTable {
  id: Generated<string>;
  orgId: string;
  messageId: string;
  bodyText: string;
  bodyHtml: string | null;
  model: string | null;
  status: Generated<'draft' | 'sent' | 'discarded'>;
  createdAt: Generated<Date>;
  updatedAt: Generated<Date>;
}

export interface MessageImportanceTable {
  messageId: string;
  orgId: string;
  score: number;
  reasoning: string | null;
  model: string | null;
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
  channel: 'email' | 'sms' | 'linkedin' | 'imessage' | 'slack' | 'discord' | 'whatsapp';
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

export interface ClassifierConfigTable {
  id: Generated<string>;
  orgId: string;
  version: string;
  promptMarkdown: string;
  isActive: Generated<boolean>;
  createdAt: Generated<Date>;
}

// The top-level keys here MUST match the real table names in the database.
// CamelCasePlugin only rewrites column identifiers, not table identifiers —
// so these stay snake_case (or quoted, for the reserved "user" keyword).
export interface DB {
  org: OrgTable;
  user: UserTable;
  connected_account: ConnectedAccountTable;
  thread: ThreadTable;
  message: MessageTable;
  message_raw: MessageRawTable;
  message_classification: MessageClassificationTable;
  message_tag: MessageTagTable;
  message_summary: MessageSummaryTable;
  draft_reply: DraftReplyTable;
  message_importance: MessageImportanceTable;
  contact: ContactTable;
  contact_handle: ContactHandleTable;
  attachment: AttachmentTable;
  job_queue: JobQueueTable;
  classifier_config: ClassifierConfigTable;
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

export type ConnectedAccountRow = Selectable<ConnectedAccountTable>;
export type NewConnectedAccount = Insertable<ConnectedAccountTable>;

export type ThreadRow = Selectable<ThreadTable>;
export type NewThread = Insertable<ThreadTable>;

export type MessageRow = Selectable<MessageTable>;
export type NewMessage = Insertable<MessageTable>;

export type JobQueueRow = Selectable<JobQueueTable>;
export type NewJobQueue = Insertable<JobQueueTable>;
