/**
 * `/ledgers/{id}/transactions*` — single-leg transactions, two-leg transfers and
 * pair / unpair (03 §5.25–§5.34).
 *
 * The list keeps its envelope and its extra `summary` (decision §14.52 A14).
 */
import { apiClient } from './client';
import type {
  Transaction,
  TransactionCreate,
  TransactionListParams,
  TransactionListResponse,
  TransactionPairRequest,
  TransactionUpdate,
  TransferCreate,
  TransferPair,
  TransferUpdate,
  UnpairResult,
  Uuid,
} from './types';

export const txApi = {
  list: (l: Uuid, p: TransactionListParams): Promise<TransactionListResponse> =>
    apiClient
      .get<TransactionListResponse>(`/ledgers/${l}/transactions`, { params: p })
      .then((r) => r.data),

  create: (l: Uuid, b: TransactionCreate): Promise<Transaction> =>
    apiClient.post<Transaction>(`/ledgers/${l}/transactions`, b).then((r) => r.data),

  /** Detail adds `pair` / `refunds` / `refund_of_detail` / `events`. */
  get: (l: Uuid, tid: Uuid): Promise<Transaction> =>
    apiClient.get<Transaction>(`/ledgers/${l}/transactions/${tid}`).then((r) => r.data),

  update: (l: Uuid, tid: Uuid, b: TransactionUpdate): Promise<Transaction> =>
    apiClient.patch<Transaction>(`/ledgers/${l}/transactions/${tid}`, b).then((r) => r.data),

  remove: (l: Uuid, tid: Uuid): Promise<void> =>
    apiClient.delete<void>(`/ledgers/${l}/transactions/${tid}`).then(() => undefined),

  createTransfer: (l: Uuid, b: TransferCreate): Promise<TransferPair> =>
    apiClient
      .post<TransferPair>(`/ledgers/${l}/transactions/transfer`, b)
      .then((r) => r.data),

  /** Read a pair as one object (03 §5.30a; the transfer routes carry only the pair id). */
  getTransfer: (l: Uuid, pairId: Uuid): Promise<TransferPair> =>
    apiClient
      .get<TransferPair>(`/ledgers/${l}/transactions/transfer/${pairId}`)
      .then((r) => r.data),

  updateTransfer: (l: Uuid, pairId: Uuid, b: TransferUpdate): Promise<TransferPair> =>
    apiClient
      .patch<TransferPair>(`/ledgers/${l}/transactions/transfer/${pairId}`, b)
      .then((r) => r.data),

  removeTransfer: (l: Uuid, pairId: Uuid): Promise<void> =>
    apiClient
      .delete<void>(`/ledgers/${l}/transactions/transfer/${pairId}`)
      .then(() => undefined),

  /** Merge two single-leg transfers into one pair (decision §14.34; body per 03 §5.33). */
  pair: (l: Uuid, tid: Uuid, b: TransactionPairRequest): Promise<TransferPair> =>
    apiClient
      .post<TransferPair>(`/ledgers/${l}/transactions/${tid}/pair`, b)
      .then((r) => r.data),

  /** Split a pair back into two single legs; no request body. */
  unpair: (l: Uuid, pairId: Uuid): Promise<UnpairResult> =>
    apiClient
      .post<UnpairResult>(`/ledgers/${l}/transactions/transfer/${pairId}/unpair`)
      .then((r) => r.data),
};
