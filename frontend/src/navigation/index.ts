/** Route guards and the navigation chrome (04 §1.4, §1.5). Only `app/` imports from here. */
export { AppShell, type AppShellProps } from './AppShell';
export { BottomTabBar, TAB_BAR_HEIGHT } from './BottomTabBar';
export { LandingRedirect, useLandingTarget, type LandingTarget } from './LandingRedirect';
export {
  LedgerSwitcher,
  LedgerSwitcherPopover,
  usePickLedger,
  type LedgerSwitcherPopoverProps,
  type LedgerSwitcherProps,
} from './LedgerSwitcher';
export { LedgersUnavailable } from './LedgersUnavailable';
export { AppSkeleton, RequireAuth, useCurrentUrl, type RequireAuthProps } from './RequireAuth';
export { RequireLedger, type RequireLedgerProps } from './RequireLedger';
// The "can no longer open this ledger" flags live with the current ledger in the store; the
// root layout and the route-tree tests reach them through here.
export {
  clearLedgerUnavailable,
  markLedgerUnavailable,
  resetLedgerUnavailable,
} from '@/store/ledgerUnavailable';
export { isActivePath } from './isActivePath';
export { barePath, isLedgerRoute, ledgerSwitchTarget } from './ledgerRoute';
export {
  SIDEBAR_WIDTH,
  Sidebar,
  useSidebarDestinations,
  userLabel,
  type NavDestination,
} from './Sidebar';
export { isFormRoute } from './formRoute';
export {
  LeaveGuardProvider,
  useBackOverride,
  useGuardedNavigate,
  useRegisterLeaveGuard,
  type GuardedNavigate,
  type GuardedNavigateOptions,
  type LeaveGuardHandle,
} from './leaveGuard';
export { useLeaveGuard, type LeaveGuard } from './useLeaveGuard';
export {
  SubPageTopBar,
  TopBar,
  TopBarProvider,
  TopBarSurface,
  useShellDrawsTopBar,
  useTopBar,
  useTopBarTitle,
  type TopBarSurfaceProps,
} from './TopBar';
export {
  backTargetFor,
  type BackParentKey,
  type BackTarget,
  type BackTargetOptions,
} from './backTarget';
export { useBack, type BackControl } from './useBack';
export { useHasNoLedgers } from './useHasNoLedgers';
export { useSwUpdateToast } from './useSwUpdateToast';
