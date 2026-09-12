/** Global contexts (04 §2). Nothing here owns server data — that lives in TanStack Query. */
export {
  AuthProvider,
  useAuth,
  type AuthContextValue,
  type AuthProviderProps,
  type AuthStatus,
} from './AuthContext';
export {
  LedgerProvider,
  useLedgerContext,
  useOptionalLedgerContext,
  type LedgerContextValue,
  type LedgerProviderProps,
} from './LedgerContext';
