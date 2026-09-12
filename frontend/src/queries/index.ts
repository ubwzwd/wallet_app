/**
 * The cache layer (04 §3.5–§3.8). Screens import from here and never from `src/api`
 * directly (types excepted), so key shapes and invalidation stay in one place.
 */
export { qk, LEDGER_KEY_PREFIX } from './keys';
export {
  createQueryClient,
  queryClient,
  registerQueryHandlers,
  shouldRetry,
  type QueryHandlers,
} from './client';
export {
  cachedLedgerIds,
  invalidateLedger,
  invalidateLedgers,
  invalidateMe,
  invalidateMembers,
  invalidatePair,
  invalidateSources,
  invalidateTransactions,
  invalidateTransfer,
  removeLedger,
  removeTransfer,
  type LedgerUpdateScope,
  type MeChangeScope,
  type SourceChangeScope,
} from './invalidate';

export {
  useCategories,
  useConfig,
  useCurrencies,
  useImportFormat,
  type CategoriesResult,
  type CurrenciesResult,
} from './useGlobal';
export { useMe, useUpdateMe } from './useMe';
export {
  memberLabel,
  useCreateInvite,
  useCreateLedger,
  useDeleteLedger,
  useJoinLedger,
  useLedger,
  useLedgers,
  useLeaveLedger,
  useMemberNames,
  useMembers,
  useRemoveMember,
  useRevokeInvite,
  useTransferOwnership,
  useUpdateLedger,
} from './useLedgers';
export {
  useCreateSource,
  useDeleteSource,
  useSource,
  useSources,
  useUpdateSource,
  type SourceListParams,
} from './useSources';
export {
  TX_PAGE_SIZE,
  useCreateTransaction,
  useCreateTransfer,
  useDeleteTransaction,
  useDeleteTransfer,
  useInfiniteTransactions,
  usePairTransaction,
  useTransaction,
  useTransactions,
  useTransfer,
  useUnpairTransfer,
  useUpdateTransaction,
  useUpdateTransfer,
} from './useTransactions';
export { TREND_MONTHS, useStatsSummary, useStatsTrend } from './useStats';
