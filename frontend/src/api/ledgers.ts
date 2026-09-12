/**
 * `/ledgers*` — ledgers, members, invites, join, transfer-ownership, leave
 * (03 §5.8–§5.19). List endpoints keep the `{items, total}` envelope (03 §4.3).
 */
import { apiClient } from './client';
import type {
  JoinLedgerRequest,
  Ledger,
  LedgerCreate,
  LedgerDetail,
  LedgerInvite,
  LedgerMember,
  LedgerUpdate,
  Paged,
  TransferOwnershipRequest,
  Uuid,
} from './types';

export const ledgersApi = {
  list: (): Promise<Paged<Ledger>> =>
    apiClient.get<Paged<Ledger>>('/ledgers').then((r) => r.data),

  create: (b: LedgerCreate): Promise<Ledger> =>
    apiClient.post<Ledger>('/ledgers', b).then((r) => r.data),

  get: (id: Uuid): Promise<LedgerDetail> =>
    apiClient.get<LedgerDetail>(`/ledgers/${id}`).then((r) => r.data),

  update: (id: Uuid, b: LedgerUpdate): Promise<Ledger> =>
    apiClient.patch<Ledger>(`/ledgers/${id}`, b).then((r) => r.data),

  remove: (id: Uuid): Promise<void> =>
    apiClient.delete<void>(`/ledgers/${id}`).then(() => undefined),

  members: (id: Uuid): Promise<Paged<LedgerMember>> =>
    apiClient.get<Paged<LedgerMember>>(`/ledgers/${id}/members`).then((r) => r.data),

  removeMember: (id: Uuid, userId: Uuid): Promise<void> =>
    apiClient.delete<void>(`/ledgers/${id}/members/${userId}`).then(() => undefined),

  leave: (id: Uuid): Promise<void> =>
    apiClient.post<void>(`/ledgers/${id}/leave`).then(() => undefined),

  /** Responds with the refreshed member list, roles already swapped. */
  transferOwnership: (id: Uuid, b: TransferOwnershipRequest): Promise<Paged<LedgerMember>> =>
    apiClient
      .post<Paged<LedgerMember>>(`/ledgers/${id}/transfer-ownership`, b)
      .then((r) => r.data),

  createInvite: (id: Uuid): Promise<LedgerInvite> =>
    apiClient.post<LedgerInvite>(`/ledgers/${id}/invites`).then((r) => r.data),

  /** Revoke a still-valid code (decision §14.52 A2). */
  revokeInvite: (id: Uuid, code: string): Promise<void> =>
    apiClient.delete<void>(`/ledgers/${id}/invites/${code}`).then(() => undefined),

  join: (b: JoinLedgerRequest): Promise<Ledger> =>
    apiClient.post<Ledger>('/ledgers/join', b).then((r) => r.data),
};
