/** Global contexts (04 §2). Nothing here owns server data — that lives in TanStack Query. */
export {
  AuthProvider,
  useAuth,
  type AuthContextValue,
  type AuthProviderProps,
  type AuthStatus,
} from './AuthContext';
export {
  CurrentLedgerProvider,
  LedgerProvider,
  pickCurrentLedger,
  useLedgerContext,
  useOptionalLedgerContext,
  type LedgerContextValue,
  type LedgerProviderProps,
} from './LedgerContext';
export {
  clearLedgerUnavailable,
  markLedgerUnavailable,
  resetLedgerUnavailable,
  useUnavailableLedgers,
} from './ledgerUnavailable';
export {
  NO_LEDGER_BUCKET,
  ViewStateProvider,
  useLedgerViewState,
  useSetLedgerViewState,
  type ViewStateUpdate,
} from './ViewState';
