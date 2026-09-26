/**
 * The wide back row for a settings page whose head is not a `PageHeader` (屏幕稿 12's
 * ledger head is its own card): `PageHeader`'s own crumb row (`PageBackRow`) with the
 * trail 「首页 · 账本设置」 (屏幕稿 08, §14.64 e).
 *
 * Wide only, and only on a sub-page — narrow screens get their ‹ from the shell's top bar,
 * and a top-level page has none (`useBack().show`).
 */
import React from 'react';
import { useTranslation } from 'react-i18next';

import { useBack } from '@/navigation';
import { useIsWide } from '@/theme/useBreakpoint';
import { PageBackRow } from '@/ui';

export interface BackCrumbProps {
  /** This page's own title — the trail's second half. */
  title: string;
  /** The row's testID; the button is `${testID}-back`, as in `PageHeader`. */
  testID: string;
}

export function BackCrumb({ title, testID }: BackCrumbProps): React.JSX.Element | null {
  const { t } = useTranslation();
  const wide = useIsWide();
  const back = useBack();
  if (!wide || !back.show) return null;

  return (
    <PageBackRow
      crumb={`${back.parentLabel} · ${title}`}
      onPress={back.goBack}
      label={t('common:button.back')}
      testID={testID}
    />
  );
}
