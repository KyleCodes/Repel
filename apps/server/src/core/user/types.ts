import type { UserRole } from '@repel/shared';

export interface User {
  id: string;
  orgId: string;
  email: string;
  name: string | null;
  role: UserRole;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateUserInput {
  orgId: string;
  email: string;
  name?: string;
  role?: UserRole;
}
