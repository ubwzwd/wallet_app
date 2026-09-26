/**
 * Entering a nested navigator from outside it — the sidebar's 导入 pressed on `/settings`,
 * 「建第一个账户」 on a ledger's home leading to `/accounts/new` — is handed to that
 * navigator as `params.screen` on its route. expo-router 6 mounts the navigator at its
 * first route (`index`) instead, while the URL already names the page the user asked for,
 * so the shell highlights 导入 and the body shows the ledger's home.
 *
 * This hook, mounted once by the signed-in layout, watches the focused path for exactly
 * that mismatch — a route whose `params.screen` matches the URL but whose child navigator
 * focuses a different route — and replaces the misplaced page with the one the URL names.
 * `replace`, not `navigate`: the history must read `/settings → /l/:id/imports`, so a back
 * step still returns to where the user came from (§14.64 f). The replacement keeps the
 * query the navigation carried (`/accounts/new?ledger=…`, `/l/:id/transactions?source_id=…`):
 * `usePathname()` has none, so it is read back from the entry's own nested params.
 *
 * A stale `params.screen` is normal after in-ledger navigation (it keeps the value from the
 * last entry), so the URL has to agree with it before anything is done.
 */
import React from 'react';
import { type Href, useNavigationContainerRef, usePathname, useRouter } from 'expo-router';

interface RouteLike {
  name: string;
  params?: { screen?: unknown; params?: unknown };
  state?: StateLike;
}
interface StateLike {
  index?: number;
  routes: RouteLike[];
}

/** The path segments below a route's own segments, from the URL. */
function tailAfter(pathSegments: string[], routeSegments: string[]): string[] | null {
  if (routeSegments.length > pathSegments.length) return null;
  for (let i = 0; i < routeSegments.length; i += 1) {
    const r = routeSegments[i];
    if (!r.startsWith('[') && r !== pathSegments[i]) return null;
  }
  return pathSegments.slice(routeSegments.length);
}

/** Whether `screen` (a route name such as `imports/[batchId]`) names exactly `tail`. */
export function screenMatchesTail(screen: string, tail: string[]): boolean {
  const pattern = screen.split('/').filter((s) => s !== '' && s !== 'index');
  if (pattern.length !== tail.length) return false;
  return pattern.every((seg, i) => seg.startsWith('[') || seg === tail[i]);
}

/** The `[name]` / `[...name]` keys a route pattern fills from the path. */
function pathKeys(routeSegments: string[]): Set<string> {
  const keys = new Set<string>();
  for (const seg of routeSegments) {
    const m = /^\[(?:\.\.\.)?([^\]]+)\]$/.exec(seg);
    if (m) keys.add(m[1]);
  }
  return keys;
}

/** `?a=1&b=2&b=3` from the entry's nested params, minus the ones the path already holds. */
function queryOf(params: unknown, skip: Set<string>): string {
  if (!params || typeof params !== 'object') return '';
  const usp = new URLSearchParams();
  for (const [key, value] of Object.entries(params as Record<string, unknown>)) {
    if (skip.has(key) || key === 'screen' || key === 'params') continue;
    const values: unknown[] = Array.isArray(value) ? value : [value];
    for (const v of values) {
      if (typeof v === 'string' || typeof v === 'number') usp.append(key, String(v));
    }
  }
  const qs = usp.toString();
  return qs ? `?${qs}` : '';
}

/**
 * Walks the focused path; when some route on it carries a `params.screen` that the URL
 * agrees with while its child navigator focuses another route, returns the href that puts
 * the named page in place — `pathname` plus the query the entry carried. `null` otherwise.
 */
export function misplacedEntryTarget(
  root: StateLike | undefined,
  pathname: string,
): string | null {
  const pathSegments = pathname.split('/').filter(Boolean);
  let state: StateLike | undefined = root;
  let consumed: string[] = [];
  while (state) {
    const route: RouteLike | undefined = state.routes[state.index ?? state.routes.length - 1];
    if (!route) return null;
    // Group and root segments (`(app)`, `__root`) take no URL space.
    const own = route.name.split('/').filter((s) => s !== '' && s !== 'index' && !s.startsWith('('));
    const routeSegments = route.name === '__root' ? [] : own;
    const nextConsumed = [...consumed, ...routeSegments];
    const screen = route.params?.screen;
    const inner = route.state;
    if (typeof screen === 'string' && inner) {
      const tail = tailAfter(pathSegments, nextConsumed);
      const focused = inner.routes[inner.index ?? inner.routes.length - 1];
      if (tail && screenMatchesTail(screen, tail) && focused && focused.name !== screen) {
        const keys = pathKeys([...nextConsumed, ...screen.split('/')]);
        return pathname + queryOf(route.params?.params, keys);
      }
    }
    consumed = nextConsumed;
    state = inner;
  }
  return null;
}

/** Whether the focused path shows a page other than the one the URL names (see above). */
export function hasMisplacedEntry(root: StateLike | undefined, pathname: string): boolean {
  return misplacedEntryTarget(root, pathname) !== null;
}

export function useNestedEntrySync(): void {
  const pathname = usePathname();
  const ref = useNavigationContainerRef();
  const router = useRouter();
  React.useEffect(() => {
    let cancelled = false;
    // Read the container directly: `useRootNavigationState()` hands out the snapshot the
    // container announced *before* the child navigator initialised, which never shows the
    // misplaced page. The child's state reaches the container one commit after the URL
    // changed, so the look is repeated once more after that commit. Both looks are tied to
    // this pathname: the cleanup cancels them, so a look scheduled for an older URL can
    // never act on a newer one (an in-ledger step must not be "corrected" backwards).
    const check = (): void => {
      if (cancelled || !ref.isReady()) return;
      const target = misplacedEntryTarget(ref.getRootState() as StateLike | undefined, pathname);
      if (target !== null) router.replace(target as Href);
    };
    check();
    const timer = setTimeout(check, 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [pathname, ref, router]);
}
