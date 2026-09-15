/** Route guards and the navigation chrome (04 §1.4, §1.5). Only `app/` imports from here. */
export { AppShell, type AppShellProps } from './AppShell';
export { BottomTabBar, TAB_BAR_HEIGHT, type BottomTabBarProps } from './BottomTabBar';
export { LandingRedirect, pickLandingLedger } from './LandingRedirect';
export { LedgerGone, type LedgerGoneProps } from './LedgerGone';
export { LedgerSwitcher, type LedgerSwitcherProps } from './LedgerSwitcher';
export { LetterAvatar, type LetterAvatarProps } from './LetterAvatar';
export { AppSkeleton, RequireAuth, useCurrentUrl, type RequireAuthProps } from './RequireAuth';
export {
  RequireLedger,
  clearLedgerGone,
  markLedgerGone,
  resetLedgerGone,
  useLedgerGone,
  type RequireLedgerProps,
} from './RequireLedger';
export {
  SIDEBAR_WIDTH,
  Sidebar,
  isActivePath,
  useLastLedgerId,
  useSidebarDestinations,
  userLabel,
  type NavDestination,
  type SidebarProps,
} from './Sidebar';
export {
  TopBar,
  TopBarProvider,
  TopBarSurface,
  useTopBar,
  useTopBarTitle,
  type TopBarSurfaceProps,
} from './TopBar';
export { useSwUpdateToast } from './useSwUpdateToast';
