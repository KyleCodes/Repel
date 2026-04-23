import type { UserRoleSlug } from '@repel/shared';

export interface User {
  id: string;
  orgId: string;
  email: string;
  name: string | null;
  role: UserRoleSlug;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateUserInput {
  orgId: string;
  email: string;
  name?: string;
  role?: UserRoleSlug;
}
