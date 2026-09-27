/**
 * The head of `/ledgers/new` and `/ledgers/join` (decision §14.65 d), which is one of three
 * things depending on what is already drawn around the page:
 *
 *   - a user with ledgers, wide → the page is a sub-page like any other: `PageHeader` with
 *     its `back`, the trail 「首页 · 新建账本」 / 「首页 · 加入账本」, leading to the home of
 *     the ledger the chrome names;
 *   - a user with ledgers, narrow → nothing: the shell's sub-page top bar already carries
 *     the round ‹ and the title (§14.64 e);
 *   - a user with no ledger at all → `StandaloneHeader` at both widths, because the shell
 *     steps aside there (屏幕稿 15, §14.59) and its back leads to the onboarding page.
 */
import React from 'react';
import { useTranslation } from 'react-i18next';

import { useBack, useHasNoLedgers, useShellDrawsTopBar } from '@/navigation';
import { useIsWide } from '@/theme/useBreakpoint';
import { PageHeader } from '@/ui';

import { StandaloneHeader } from './StandaloneHeader';

export interface LedgerPageHeadProps {
  title: string;
  /** The head's testID; its back button is `${testID}-back`, its title `${testID}-title`. */
  testID: string;
}

export function LedgerPageHead({ title, testID }: LedgerPageHeadProps): React.JSX.Element | null {
  const { t } = useTranslation();
  const wide = useIsWide();
  const back = useBack();
  const shellBar = useShellDrawsTopBar();
  const noLedgers = useHasNoLedgers();
  if (wide && !noLedgers) {
    const showCrumb = back.show;
    const parent = back.show ? back.parentLabel : t('common:nav.home');
    return (
      <PageHeader
        title={title}
        back={
          showCrumb
            ? { crumb: `${parent} · ${title}`, onPress: back.goBack, label: t('common:button.back') }
            : undefined
        }
        testID={testID}
      />
    );
  }
  if (shellBar) return null;
  return <StandaloneHeader title={title} onBack={back.goBack} testID={testID} />;
}
