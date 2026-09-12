/**
 * "本月餐饮 ¥1,240 → ¥1,278" — the local stats preview above the save button
 * (decision §14.52 A9, 04 §4.6 / §4.7).
 *
 * Strictly local arithmetic on the monthly summary that is **already** in the cache: no
 * request is ever issued from here, and the line simply does not render when the cache is
 * cold, when the amount is not usable yet, or when the entry is in a currency the summary
 * cannot be compared against.
 */
import React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import type { Money, StatsSummary, TxKind, Uuid } from '@/api/types';
import { currentMonth, monthOf } from '@/domain/dates';
import { addMoney, normalizeAmountInput, subMoney } from '@/domain/money';
import { categoryName } from '@/i18n/category';
import { useLang } from '@/i18n';
import { formatMoney } from '@/i18n/format';
import { qk, useCategories } from '@/queries';
import { Text } from '@/ui';

export interface StatsPreviewProps {
  ledgerId: Uuid;
  kind: TxKind;
  categoryL1: string | null;
  /** Raw input from the amount box. */
  amount: string;
  currency: string;
  occurredAt: string;
  /**
   * Edit mode: the magnitude this transaction already contributes to that category in the
   * cached summary, so the preview shows the *change* rather than a double count.
   */
  baseline?: Money | null;
  testID?: string;
}

/** How one entry of `kind` moves a category total (a refund offsets its expense). */
function deltaFor(kind: TxKind, magnitude: Money): Money | null {
  if (kind === 'expense' || kind === 'income') return magnitude;
  if (kind === 'refund') return subMoney('0', magnitude);
  return null;
}

export function StatsPreview({
  ledgerId,
  kind,
  categoryL1,
  amount,
  currency,
  occurredAt,
  baseline,
  testID,
}: StatsPreviewProps): React.JSX.Element | null {
  const { t } = useTranslation();
  const lang = useLang();
  const qc = useQueryClient();
  const { index } = useCategories();

  if (kind === 'transfer' || categoryL1 === null) return null;

  const magnitude = normalizeAmountInput(amount);
  if (magnitude === null) return null;

  const month = occurredAt.length >= 7 ? monthOf(occurredAt) : '';
  if (month === '') return null;

  const summary = qc.getQueryData<StatsSummary>(qk.ledger(ledgerId).statsSum(month));
  if (!summary) return null;
  if (currency !== summary.base_currency) return null;

  const nodes = kind === 'income' ? summary.income : summary.expense;
  const before = nodes.find((n) => n.code === categoryL1)?.amount ?? '0';
  const delta = deltaFor(kind, magnitude);
  if (delta === null) return null;

  // The baseline is what this very entry already puts into the total, so it comes out the
  // same way it went in: a refund contributes a *negative* delta, and removing it as a
  // positive magnitude would move the line by twice the refund.
  const base = baseline == null ? '0' : (deltaFor(kind, baseline) ?? '0');
  const after = addMoney(subMoney(before, base), delta);
  const category = index?.byCode[categoryL1];
  const name = category ? categoryName(category, lang) : categoryL1;
  // "本月餐饮" only reads right for the month we are actually in; any other month is
  // named by its own category alone.
  const label =
    month === currentMonth() ? t('transaction:form.impact_this_month', { category: name }) : name;

  return (
    <Text variant="caption" tone="secondary" testID={testID ?? 'stats-preview'}>
      {t('transaction:form.impact_preview', {
        label,
        before: formatMoney(before, summary.base_currency, lang),
        after: formatMoney(after, summary.base_currency, lang),
      })}
    </Text>
  );
}
