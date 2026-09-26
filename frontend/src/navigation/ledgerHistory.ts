/**
 * Keeps a ledger's inner history across a trip out of it, so a back step from `/ledgers*`
 * or `/settings` lands on the very page the user left (decision §14.64 f: "有应用内的上一页
 * 就退一步").
 *
 * Why this is needed: the `(app)` group is a `Slot`, which renders only its focused route.
 * Leaving `/l/:id/imports` for `/ledgers` unmounts the `/l/:id` route's own navigator, and
 * React Navigation drops an unmounted navigator's state. A plain `router.back()` then
 * re-creates the ledger at its first page — `/l/:id` instead of `/l/:id/imports` — while the
 * browser's own back button (which restores the whole state it recorded) gets it right.
 *
 * So the signed-in layout (`app/(app)/_layout.tsx`) records every nested navigator's state
 * as it changes, keyed by route, and `useBack` puts that state back when its back step
 * reveals a route whose state is gone. Nothing else changes: every other back step is
 * still `router.back()`, which is what lets the forms' leave guard (`beforeRemove`)
 * intercept it.
 */
import React from 'react';
import { useNavigationContainerRef } from 'expo-router';
import {
  CommonActions,
  type NavigationAction,
  type NavigationState,
  type PartialState,
} from '@react-navigation/native';

type InnerState = NavigationState | PartialState<NavigationState>;

/** Route key → the inner state it last had; capped, oldest first out. */
const saved = new Map<string, InnerState>();
const MAX_SAVED = 20;

function remember(key: string, state: InnerState): void {
  saved.delete(key);
  saved.set(key, state);
  if (saved.size > MAX_SAVED) {
    const oldest = saved.keys().next().value;
    if (oldest !== undefined) saved.delete(oldest);
  }
}

type Container = ReturnType<typeof useNavigationContainerRef>;

/** The navigation container, captured by the signed-in layout that does the recording. */
let container: Container | null = null;

/** Test seam: forget everything recorded so far. */
export function resetLedgerHistory(): void {
  saved.clear();
}

type AnyState = NavigationState | PartialState<NavigationState>;

/** Every route on the tree that carries a nested navigator's state, remembered by key. */
function rememberAll(state: AnyState | undefined): void {
  for (const route of state?.routes ?? []) {
    const inner = route.state as InnerState | undefined;
    if (inner === undefined || route.key === undefined) continue;
    remember(route.key, inner);
    rememberAll(inner);
  }
}

/**
 * Mounted once by the signed-in layout: records, on every navigation, the inner state of
 * each nested navigator (the ledger's among them) so it is still at hand after the
 * navigator unmounts.
 */
export function useRememberLedgerHistory(): void {
  const ref = useNavigationContainerRef();
  React.useEffect(() => {
    container = ref;
    const record = (): void => {
      if (ref.isReady()) rememberAll(ref.getRootState());
    };
    record();
    const unsubscribe = ref.addListener('state', record);
    return () => {
      unsubscribe();
      if (container === ref) container = null;
    };
  }, [ref]);
}

/**
 * The navigator a back step pops: the deepest navigator on the focused path that still has
 * a page under the current one (a back action bubbles up from the focused leaf to the first
 * navigator that can handle it).
 */
function poppingNavigator(root: AnyState | undefined): AnyState | null {
  let found: AnyState | null = null;
  let state: AnyState | undefined = root;
  while (state) {
    const index = state.index ?? state.routes.length - 1;
    if (index > 0) found = state;
    state = state.routes[index]?.state as AnyState | undefined;
  }
  return found;
}

/**
 * The action that steps back *and* puts the revealed ledger's inner history back, or
 * `null` when a plain `router.back()` already does the right thing.
 */
function restoringBackAction(root: AnyState | undefined): NavigationAction | null {
  const navigator = poppingNavigator(root);
  if (!navigator || navigator.key === undefined) return null;
  const index = navigator.index ?? navigator.routes.length - 1;
  const revealed = navigator.routes[index - 1];
  if (!revealed || revealed.state !== undefined || revealed.key === undefined) return null;
  const inner = saved.get(revealed.key);
  if (inner === undefined) return null;

  saved.delete(revealed.key);
  const routes = [...navigator.routes.slice(0, index - 1), { ...revealed, state: inner }];
  return {
    ...CommonActions.reset({ ...navigator, index: index - 1, routes } as NavigationState),
    target: navigator.key,
  };
}

/**
 * Step back into a ledger with its history put back, if that is what this back step is.
 * Returns `false` — and does nothing — when a plain `router.back()` is the right move.
 */
export function stepBackRestoringLedger(): boolean {
  if (!container?.isReady()) return false;
  const action = restoringBackAction(container.getRootState());
  if (!action) return false;
  container.dispatch(action);
  return true;
}
