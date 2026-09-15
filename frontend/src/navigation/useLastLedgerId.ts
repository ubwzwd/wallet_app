/**
 * The one reader of the `last_ledger_id` preference (04 §2.2).
 *
 * Three callers need it and they used to hold three copies with three different loading
 * semantics: the landing redirect (`/` picks a ledger), the sidebar (the chrome outside a
 * ledger aims somewhere) and the ledger list (which card is marked 「当前」). They all read
 * the same value, so they all read it here.
 *
 * The value is a convenience, never state: everything past the redirect takes the ledger id
 * from the URL.
 */
import React from 'react';

import { PREF_NAMES, getPref } from '@/utils/prefs';

/**
 * `undefined` while the read is in flight (it is asynchronous on native, and one frame late
 * on web), `null` on a device that never opened a ledger, else the remembered id.
 *
 * Callers must treat `undefined` as "not decided yet" and hold whatever they were showing —
 * guessing on that first frame is what made the sidebar's card flicker.
 */
export function useLastLedgerId(): string | null | undefined {
  const [id, setId] = React.useState<string | null | undefined>(undefined);
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
