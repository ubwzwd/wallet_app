/**
 * 「对 9 月的影响」 / 「对账本的影响」 / 「这笔是单腿」 — the first card of the wide layout's
 * right column (屏幕稿 07 / 08).
 *
 * It answers the question the delete button raises: what does this row actually move? The
 * arithmetic is the same local arithmetic the form's `StatsPreview` does — the month's
 * summary minus (or plus) this row's own converted magnitude — so nothing new is computed on
 * the server (decision §14.52 A9 asks for local arithmetic, not for skipping the existing
 * `GET /stats/summary`), and the card simply does not render while the summary is in flight
 * or when the row has no rate to convert with.
 *
 * A transfer needs no summary at all: both legs sit inside the ledger, so every line is
 * 「不变」, and only a single leg (money from outside the ledger) moves the net worth.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import type { Money, TransferSubtype, TxKind, Uuid } from '@/api/types';
import type { CategoryIndex } from '@/domain/categories';
import { monthOf } from '@/domain/dates';
import { absMoney, addMoney, subMoney } from '@/domain/money';
import { useLang } from '@/i18n';
import { categoryName } from '@/i18n/category';
import { formatMonthShort, formatMoney } from '@/i18n/format';
import { useStatsSummary } from '@/queries';
import { space } from '@/theme/tokens';
import { Text } from '@/ui';

import { FactRow, SideCard, TintSideCard, plainAmount } from './parts';

export interface ImpactCardProps {
  ledgerId: Uuid;
  kind: Exclude<TxKind, 'transfer'>;
  /** The row's converted magnitude; `null` (no rate) hides the card. */
  amountBase: Money | null;
  categoryL1: string | null;
  occurredAt: string;
  baseCurrency: string;
  index: CategoryIndex | null;
  testID?: string;
}

export function ImpactCard({
  ledgerId,
  kind,
  amountBase,
  categoryL1,
  occurredAt,
  baseCurrency,
  index,
  testID,
}: ImpactCardProps): React.JSX.Element | null {
  const { t } = useTranslation();
  const lang = useLang();
  const month = monthOf(occurredAt);
  // The card subscribes to the row's own month, not to whatever month the home page happens
  // to be looking at: 04 §4.7 lists it as part of the detail page, so a deep link straight
  // into `/transactions/:id` has to draw it too. The key is the one the home page fills, so
  // an already-loaded month costs nothing.
  const summary = useStatsSummary(ledgerId, month);
  const data = summary.data;

  // The same guard `StatsPreview` puts before the same arithmetic: a summary in another
  // base currency cannot be added to or subtracted from this row's converted magnitude.
  if (!data || amountBase === null) return null;
  if (data.base_currency.toUpperCase() !== baseCurrency.toUpperCase()) return null;

  const id = testID ?? 'detail-impact';
  const shortMonth = formatMonthShort(month, lang);
  const magnitude = absMoney(amountBase);
  const money = (raw: Money): string =>
    formatMoney(raw, baseCurrency, lang, { signDisplay: 'never' });

  // A refund offsets its own category's expense, so it lives in the expense side of the
  // summary and *raises* the month's expense when it is deleted.
  const onIncome = kind === 'income';
  const total = onIncome ? data.income_total : data.expense_total;
  const nodes = onIncome ? data.income : data.expense;
  const node = categoryL1 === null ? undefined : nodes.find((n) => n.code === categoryL1);
  const category = categoryL1 === null ? null : index?.byCode[categoryL1];
  const shareLabel =
    category === null || category === undefined
      ? null
      : t('transaction:detail.impact.category', { category: categoryName(category, lang) });

  const contribution =
    kind === 'refund'
      ? t('transaction:detail.impact.offset', { amount: money(magnitude) })
      : t('transaction:detail.impact.including', { amount: money(magnitude) });
  const afterDelete = kind === 'refund' ? addMoney(total, magnitude) : subMoney(total, magnitude);

  return (
    <SideCard
      title={t('transaction:detail.impact.title', { month: shortMonth })}
      testID={id}
    >
      <View style={styles.rows}>
        <FactRow
          testID={`${id}-total`}
          label={t(
            onIncome
              ? 'transaction:detail.impact.month_income'
              : 'transaction:detail.impact.month_expense',
            { month: shortMonth },
          )}
          value={`${money(total)} · ${contribution}`}
        />
        {/* A category the summary does not report at all has no figure to print: 「¥0.00 ·
            含本笔 ¥299.00」 would be a number invented here, so the row drops out the way the
            whole card does while the summary is missing. */}
        {shareLabel !== null && node !== undefined ? (
          <FactRow
            testID={`${id}-category`}
            label={shareLabel}
            value={`${money(node.amount)} · ${contribution}`}
          />
        ) : null}
        <FactRow
          testID={`${id}-after-delete`}
          label={t(
            onIncome
              ? 'transaction:detail.impact.after_delete_income'
              : 'transaction:detail.impact.after_delete_expense',
          )}
          value={money(afterDelete)}
          tone="accent"
          last
        />
      </View>
    </SideCard>
  );
}

export interface TransferImpactProps {
  month: string;
  subtype: TransferSubtype;
  /** The receiving leg's magnitude, for the 「信用卡已还」 line. */
  amountIn: Money;
  currency: string;
  testID?: string;
}

/** 屏幕稿 07 (two legs): four lines that all say 「不变」, because that is the point. */
export function TransferImpactCard({
  month,
  subtype,
  amountIn,
  currency,
  testID,
}: TransferImpactProps): React.JSX.Element {
  const { t } = useTranslation();
  const lang = useLang();
  const id = testID ?? 'transfer-detail-impact';
  const shortMonth = formatMonthShort(month, lang);
  const unchanged = t('transaction:detail.impact.unchanged');
  const repayment = subtype === 'repayment';

  return (
    <SideCard title={t('transaction:detail.impact.ledger_title')} testID={id}>
      <View style={styles.rows}>
        <FactRow
          testID={`${id}-expense`}
          label={t('transaction:detail.impact.month_expense', { month: shortMonth })}
          value={unchanged}
        />
        <FactRow
          testID={`${id}-income`}
          label={t('transaction:detail.impact.month_income', { month: shortMonth })}
          value={unchanged}
        />
        <FactRow
          testID={`${id}-net-worth`}
          label={t('transaction:detail.impact.net_worth')}
          value={unchanged}
          last={!repayment}
        />
        {repayment ? (
          <FactRow
            testID={`${id}-repaid`}
            label={t('transaction:detail.impact.repaid')}
            value={plainAmount(absMoney(amountIn), currency, 'always')}
            tone="income"
            last
          />
        ) : null}
      </View>
    </SideCard>
  );
}

export interface SingleLegImpactProps {
  month: string;
  /**
   * Signed **converted** magnitude: a leg that receives money raises the net worth, one that
   * sends it lowers it. `null` (no rate for a foreign leg) drops the 净资产 line entirely —
   * the raw foreign amount may not be printed in the base currency, and `ImpactCard` hides
   * itself for the same reason.
   */
  amount: Money | null;
  currency: string;
  testID?: string;
}

/** 屏幕稿 07 (single leg): the beige card explaining why one leg moves the net worth. */
export function SingleLegImpactCard({
  month,
  amount,
  currency,
  testID,
}: SingleLegImpactProps): React.JSX.Element {
  const { t } = useTranslation();
  const lang = useLang();
  const id = testID ?? 'tx-detail-impact';
  const shortMonth = formatMonthShort(month, lang);

  return (
    <TintSideCard title={t('transaction:detail.impact.single_title')} testID={id}>
      <Text variant="caption" tone="warning" testID={`${id}-body`}>
        {t('transaction:detail.impact.single_body')}
      </Text>
      <View style={styles.rows}>
        <FactRow
          testID={`${id}-net`}
          onTint
          last={amount === null}
          label={t('transaction:detail.impact.month_net', { month: shortMonth })}
          value={t('transaction:detail.impact.unchanged')}
        />
        {amount === null ? null : (
          <FactRow
            testID={`${id}-net-worth`}
            onTint
            last
            label={t('transaction:detail.impact.net_worth')}
            value={plainAmount(amount, currency, 'always')}
          />
        )}
      </View>
    </TintSideCard>
  );
}

const styles = StyleSheet.create({
  rows: { alignSelf: 'stretch', marginTop: space['1'] },
});
