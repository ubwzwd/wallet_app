/** Route guards and the navigation chrome (04 §1.4, §1.5). Only `app/` imports from here. */
export { AppShell, type AppShellProps } from './AppShell';
export { BottomTabBar, TAB_BAR_HEIGHT } from './BottomTabBar';
export {
  LandingRedirect,
  pickLandingLedger,
  useLandingTarget,
  type LandingTarget,
} from './LandingRedirect';
export { LedgerGone, type LedgerGoneProps } from './LedgerGone';
export {
  LedgerSwitcher,
  LedgerSwitcherPopover,
  type LedgerSwitcherPopoverProps,
  type LedgerSwitcherProps,
} from './LedgerSwitcher';
export { AppSkeleton, RequireAuth, useCurrentUrl, type RequireAuthProps } from './RequireAuth';
export {
  RequireLedger,
  clearLedgerGone,
  markLedgerGone,
  resetLedgerGone,
  useLedgerGone,
  type RequireLedgerProps,
} from './RequireLedger';
export { isActivePath } from './isActivePath';
export {
  SIDEBAR_WIDTH,
  Sidebar,
  useSidebarDestinations,
  userLabel,
  type NavDestination,
} from './Sidebar';
export { resetLedgerHistory, useRememberLedgerHistory } from './ledgerHistory';
export { isFormRoute } from './formRoute';
export {
  LeaveGuardProvider,
  useBackOverride,
  useGuardedNavigate,
  useRegisterLeaveGuard,
  type GuardedNavigate,
  type LeaveGuardHandle,
} from './leaveGuard';
export { useLastLedgerId } from './useLastLedgerId';
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
export { useChromeLedger, useHasNoLedgers, type ChromeLedger } from './useChromeLedger';
export { useSwUpdateToast } from './useSwUpdateToast';
export { useNestedEntrySync } from './nestedEntry';
