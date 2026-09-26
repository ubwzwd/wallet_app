/**
 * The back button every sub-page carries (decision §14.64 e / f): the narrow top bar's
 * round ‹, and the wide page header's round button with its grey breadcrumb.
 *
 * With in-app history it steps back one page; without it (a deep link in a new tab, a
 * reload) it goes to the page's fixed parent from `backTargetFor`. Pages with a return
 * address of their own (the new-transaction form's `?next=`) keep using it and only fall
 * back to this table.
 *
 * `goBack` is one of the shell's exits, so it asks a registered leave guard first
 * (`useGuardedNavigate`, §14.65 g).
 */
import React from 'react';
import { usePathname, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { useIsWide } from '@/theme/useBreakpoint';

import { type BackParentKey, backTargetFor } from './backTarget';
import { useChromeLedger, useHasNoLedgers } from './useChromeLedger';
import { stepBackRestoringLedger } from './ledgerHistory';
import { useGuardedNavigate } from './leaveGuard';

export interface BackControl {
  /** Whether this page is a sub-page, i.e. whether a back button belongs on it. */
  show: boolean;
  /** The parent page's name, for the wide breadcrumb 「{parentLabel} · {page title}」. */
  parentLabel: string;
  goBack(): void;
}

const PARENT_LABEL_KEY: Record<BackParentKey, string> = {
  home: 'common:nav.home',
  transactions: 'common:nav.transactions',
  sources: 'common:nav.sources',
  imports: 'common:nav.imports',
  // Only a user with no ledger has `/ledgers` as a parent, and there it is the onboarding
  // page (§14.65 c), so the label names that, never a ledger list.
  ledgers: 'common:nav.ledgers',
};

export function useBack(): BackControl {
  const { t } = useTranslation();
  const router = useRouter();
  const pathname = usePathname();
  const wide = useIsWide();
  const { ledgerId } = useChromeLedger();
  const noLedgers = useHasNoLedgers();

  const target = backTargetFor(pathname, {
    wide,
    chromeLedgerId: ledgerId,
    hasLedgers: !noLedgers,
  });
  const href = target?.href ?? null;
  const guarded = useGuardedNavigate();

  const goBack = React.useCallback((): void => {
    guarded(() => {
      if (router.canGoBack()) {
        // Crossing back into a ledger from `/ledgers*` has to restore the ledger's own
        // history, which its unmounted navigator lost (see ledgerHistory.ts).
        if (!stepBackRestoringLedger()) router.back();
      } else if (href !== null) router.replace(href);
    });
  }, [guarded, href, router]);

  return {
    show: target !== null,
    parentLabel: target ? t(PARENT_LABEL_KEY[target.parentKey]) : '',
    goBack,
  };
}
