import type {
  Generated,
  Insertable,
  Kysely,
  Selectable,
  Transaction,
  Updateable,
} from 'kysely';
import type {
  AuthMethodSlug,
  ChannelSlug,
  MessageDirectionSlug,
  ProviderSlug,
  UserRoleSlug,
} from '@repel/shared';

// Kysely database interface — one entry per table.
// Column keys are camelCase; the CamelCasePlugin rewrites them to snake_case
// identifiers in generated SQL. These types are hand-maintained and mirror
// the SQL schema in src/db/migrations.
//
// Enum-typed columns import their union from @repel/shared (single source of
// truth — see packages/shared/src/enums.ts). The Postgres enum values defined
// in the migration MUST stay in sync with these unions.

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
  role: UserRoleSlug;
  createdAt: Generated<Date>;
  updatedAt: Generated<Date>;
}

export interface ProviderAccountTable {
  id: Generated<string>;
  orgId: string;
  userId: string;
  provider: ProviderSlug;
  channel: ChannelSlug;
  authMethod: AuthMethodSlug;
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
  channel: ChannelSlug;
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
  channel: ChannelSlug;
  externalMessageId: string;
  senderAddress: string;
  senderName: string | null;
  recipientAddresses: string[];
  ccAddresses: string[] | null;
  bccAddresses: string[] | null;
  subject: string | null;
  bodyText: string | null;
  bodyHtml: string | null;
  direction: MessageDirectionSlug;
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
  channel: ChannelSlug;
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

// node-pg-migrate's bookkeeping table. Not an app-domain table — owned by the
// migration runner itself. Included in the DB type so `core/migrations/` can
// query it through the normal Kysely repo path (ADR-009/010) rather than
// dropping to raw pg.
export interface PgMigrationsTable {
  id: Generated<number>;
  name: string;
  runOn: Date;
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
  pgmigrations: PgMigrationsTable;
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

export type PgMigrationsRow = Selectable<PgMigrationsTable>;
