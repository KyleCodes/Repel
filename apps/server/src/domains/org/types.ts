// Domain type for an org. Services return this, never OrgRow.
export interface Org {
  id: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateOrgInput {
  name: string;
}
