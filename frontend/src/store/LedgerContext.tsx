/**
 * The current ledger (04 §2.2, decision §14.66 b–d).
 *
 * The address no longer names a ledger, so "which ledger am I in" is the tab's own memory:
 *
 *   1. this tab's `current_ledger_id` (web `sessionStorage` — a reload keeps it, a second tab
 *      has its own; native has none, see `getSessionPrefSync`);
 *   2. else the device's `last_ledger_id`;
 *   3. else the first ledger in the list.
 *
 * A remembered id that is not in the list (deleted, left, never ours) falls through to the
 * next source. Whatever is picked is written back to both.
 *
 * `CurrentLedgerProvider` sits at the signed-in layout, above the shell, so every signed-in
 * page and every piece of chrome reads the same answer — `/settings` and `/accounts*`
 * included. With no ledger at all the context is `null` (`useOptionalLedgerContext`); the
 * ledger pages are kept away from that state by `RequireLedger`.
 *
 * `switchTo` changes the context and nothing else: the path stays, no history entry is made
 * (the back button walks pages, never ledgers). Only a page that names one of the old
 * ledger's records falls back to that record's list (`ledgerSwitchTarget`).
 *
 * A ledger the server says we can no longer open (`GET /ledgers/{id}` → 404, see
 * `ledgerUnavailable.ts`) is never current: the tab moves to another ledger and says so in a
 * toast; with none left, the ledger pages send the user to `/ledgers`.
 */
import React from 'react';
import { useGlobalSearchParams, usePathname, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';

import type { Ledger, Uuid } from '@/api/types';
import { ledgerSwitchTarget } from '@/navigation/ledgerRoute';
import { LedgersUnavailable } from '@/navigation/LedgersUnavailable';
import { AppSkeleton } from '@/navigation/RequireAuth';
import { removeLedger, useLedgers } from '@/queries';
import { toast } from '@/ui';
import {
  PREF_NAMES,
  getPref,
  getPrefSync,
  getSessionPrefSync,
  setPref,
  setSessionPref,
} from '@/utils/prefs';

import { clearLedgerUnavailable, useUnavailableLedgers } from './ledgerUnavailable';

export interface LedgerContextValue {
  /** The current ledger's id — the tab's choice, never a route parameter (§14.66). */
  ledgerId: Uuid;
  ledger: Ledger;
  myRole: 'owner' | 'member';
  /** `ledger.base_currency` (decision §2: the base currency belongs to the ledger). */
  baseCurrency: string;
  /** Every ledger the user can open, for the switcher. */
  ledgers: readonly Ledger[];
  /** Make `id` the current ledger. The path stays unless it names an old ledger's record. */
  switchTo(id: Uuid): void;
}

const LedgerContext = React.createContext<LedgerContextValue | null>(null);

const NO_LEDGERS: readonly Ledger[] = [];

/**
 * The one rule for picking the current ledger: the tab's own choice, else the device's
 * last, else the first — each only while it is still in `ledgers`. `null` with no ledgers.
 */
export function pickCurrentLedger(
  ledgers: readonly Ledger[],
  sessionId: string | null,
  lastId: string | null,
): Ledger | null {
  if (ledgers.length === 0) return null;
  return (
    ledgers.find((l) => l.id === sessionId) ?? ledgers.find((l) => l.id === lastId) ?? ledgers[0]
  );
}

function useLedgerValue(
  ledger: Ledger | null,
  ledgers: readonly Ledger[],
  switchTo: (id: Uuid) => void,
): LedgerContextValue | null {
  return React.useMemo<LedgerContextValue | null>(() => {
    if (!ledger) return null;
    return {
      ledgerId: ledger.id,
      ledger,
      myRole: ledger.role,
      baseCurrency: ledger.base_currency,
      ledgers,
      switchTo,
    };
  }, [ledger, ledgers, switchTo]);
}

const noSwitch = (): void => undefined;

export interface LedgerProviderProps {
  ledgerId: Uuid;
  ledgers: readonly Ledger[];
  /** What `switchTo` does; a no-op by default. */
  switchTo?: (id: Uuid) => void;
  children: React.ReactNode;
}

/**
 * A fixed ledger context — for a screen rendered on its own (screen tests), where there is
 * no signed-in layout to pick one. Renders nothing while `ledgerId` is not in `ledgers`.
 */
export function LedgerProvider({
  ledgerId,
  ledgers,
  switchTo = noSwitch,
  children,
}: LedgerProviderProps): React.JSX.Element | null {
  const ledger = ledgers.find((l) => l.id === ledgerId) ?? null;
  const value = useLedgerValue(ledger, ledgers, switchTo);
  if (!value) return null;
  return <LedgerContext.Provider value={value}>{children}</LedgerContext.Provider>;
}

/**
 * The device's `last_ledger_id`: `undefined` while the read is in flight (asynchronous on
 * native; on the web the first frame already has it unless it is unset).
 */
function useLastLedgerPref(): string | null | undefined {
  const [id, setId] = React.useState<string | null | undefined>(
    () => getPrefSync(PREF_NAMES.lastLedgerId) ?? undefined,
  );
  React.useEffect(() => {
    let alive = true;
    void getPref(PREF_NAMES.lastLedgerId).then((value) => {
      if (alive) setId(value);
    });
    return () => {
      alive = false;
    };
  }, []);
  return id;
}

/** The current ledger, or `undefined` while that cannot be decided yet. */
function resolveCurrent(
  reachable: readonly Ledger[] | undefined,
  chosen: string | null,
  lastId: string | null | undefined,
  refetching: boolean,
  shown: Ledger | null,
): Ledger | null | undefined {
  if (reachable === undefined) return undefined;
  const hit = reachable.find((l) => l.id === chosen);
  if (hit) return hit;
  // Just switched to a ledger the cached list does not have yet (one that was created or
  // joined a moment ago): keep showing the current one while the list is re-read, rather
  // than flashing whichever ledger the fallback would pick.
  const held = shown === null ? undefined : reachable.find((l) => l.id === shown.id);
  if (chosen !== null && refetching && held) return held;
  if (lastId === undefined) return undefined;
  return pickCurrentLedger(reachable, chosen, lastId);
}

export function CurrentLedgerProvider({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  const { t } = useTranslation();
  const router = useRouter();
  const pathname = usePathname();
  // `usePathname()` has no query; 记一笔's entry parameters are read from here.
  const search = useGlobalSearchParams();
  const queryClient = useQueryClient();
  const { data, isError, isFetching, refetch } = useLedgers();
  const unavailable = useUnavailableLedgers();
  const lastId = useLastLedgerPref();
  // This tab's pick. Only `switchTo` changes it: a fallback (the pick is not in the list)
  // is written to storage but not here, so a ledger that is still on its way into the list
  // is picked up the moment it arrives.
  const [chosen, setChosen] = React.useState<string | null>(() =>
    getSessionPrefSync(PREF_NAMES.currentLedgerId),
  );
  // What this tab remembered when it (re)loaded — see the reload check below.
  const [remembered] = React.useState(chosen);

  const all = data?.items;
  const reachable = React.useMemo(
    () => all?.filter((l) => !unavailable.has(l.id)),
    [all, unavailable],
  );

  /** The ledger the last commit showed. */
  const shown = React.useRef<Ledger | null>(null);
  const current = resolveCurrent(reachable, chosen, lastId, isFetching, shown.current);
  const currentId = current?.id ?? null;

  // `switchTo` keeps one identity for the whole session; it reads these through refs.
  const currentIdRef = React.useRef(currentId);
  currentIdRef.current = currentId;
  const pathnameRef = React.useRef(pathname);
  pathnameRef.current = pathname;
  const searchRef = React.useRef(search);
  searchRef.current = search;

  const switchTo = React.useCallback(
    (id: Uuid): void => {
      if (id === currentIdRef.current) return;
      // Picking a ledger again is a fresh question for the server, not the old verdict.
      clearLedgerUnavailable(id);
      setChosen(id);
      void setSessionPref(PREF_NAMES.currentLedgerId, id);
      void setPref(PREF_NAMES.lastLedgerId, id);
      const target = ledgerSwitchTarget(pathnameRef.current, searchRef.current);
      if (target !== null) router.replace(target);
    },
    [router],
  );

  // Whatever ended up current is remembered for this tab and for the next landing.
  React.useEffect(() => {
    if (currentId === null) return;
    void setSessionPref(PREF_NAMES.currentLedgerId, currentId);
    void setPref(PREF_NAMES.lastLedgerId, currentId);
  }, [currentId]);

  // A ledger the server gave up on: drop everything cached under it (it is unreadable now
  // and would be served to whatever renders next) and re-read the list. If it was the one
  // on screen, the tab has already moved on (`reachable` leaves it out): say where to, and
  // leave a page that names one of its records.
  const handled = React.useRef<Set<string>>(new Set());
  React.useEffect(() => {
    let lostShown = false;
    for (const id of unavailable) {
      if (handled.current.has(id)) continue;
      handled.current.add(id);
      removeLedger(queryClient, id);
      if (id === shown.current?.id) lostShown = true;
    }
    for (const id of [...handled.current]) {
      if (!unavailable.has(id)) handled.current.delete(id);
    }
    if (!lostShown || !current) return;
    toast.info(t('ledger:unavailable.switched', { name: current.name }));
    // The tab has moved on for good: a later re-read of the list must not announce it again.
    setChosen(current.id);
    const target = ledgerSwitchTarget(pathnameRef.current, searchRef.current);
    if (target !== null) router.replace(target);
  }, [unavailable, current, queryClient, router, t]);

  // The same loss found by a reload: the ledger this tab remembered is simply missing from
  // the list (the user was removed, or it was deleted, while the tab was reloading). The tab
  // only ever remembers a ledger it was shown, so a miss means it is gone — say where the tab
  // went, as above. Only for the remembered pick: one made by `switchTo` since may still be on
  // its way into the list, and that is the fallback's business, not a loss.
  // One look, at the first list that settles after the reload: later re-reads (the last
  // ledger deleted, then a new one created) are not reloads and must not announce a loss.
  const reloadChecked = React.useRef(false);
  React.useEffect(() => {
    if (reloadChecked.current || !all || isFetching) return;
    reloadChecked.current = true;
    if (chosen === null || chosen !== remembered || !current) return;
    if (current.id === chosen || all.some((l) => l.id === chosen)) return;
    setChosen(current.id);
    toast.info(t('ledger:unavailable.switched', { name: current.name }));
    const target = ledgerSwitchTarget(pathnameRef.current, searchRef.current);
    if (target !== null) router.replace(target);
  }, [chosen, remembered, all, isFetching, current, router, t]);

  // Last, so the effect above still sees the ledger the previous commit showed.
  React.useEffect(() => {
    shown.current = current ?? null;
  });

  const value = useLedgerValue(current ?? null, reachable ?? NO_LEDGERS, switchTo);

  // 04 §1.5: while the answer is unknown we wait — never guess a ledger.
  if (reachable === undefined) {
    return isError ? <LedgersUnavailable onRetry={() => void refetch()} /> : <AppSkeleton />;
  }
  if (current === undefined) return <AppSkeleton />;
  return <LedgerContext.Provider value={value}>{children}</LedgerContext.Provider>;
}

export function useLedgerContext(): LedgerContextValue {
  const value = React.useContext(LedgerContext);
  if (!value) {
    throw new Error('useLedgerContext() needs a current ledger (a ledger page, or <LedgerProvider>)');
  }
  return value;
}

/** `null` when the user has no ledger at all, or outside every provider. */
export function useOptionalLedgerContext(): LedgerContextValue | null {
  return React.useContext(LedgerContext);
}
