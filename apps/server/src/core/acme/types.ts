// Domain type for an acme record. Reference vertical only.
export interface Acme {
  id: string;
  orgId: string;
  note: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateAcmeInput {
  orgId: string;
  note: string;
}

export interface ListAcmeOptions {
  limit?: number;
}
