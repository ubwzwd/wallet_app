/**
 * What 「这一笔」 restates (mockups 04 / 05): the headline — one big kind-coloured number, or
 * a transfer's two legs as tinted rows — and the key/value lines under it.
 *
 * It is a plain function, not a hook, so the layout can build it after its own early
 * returns; everything it needs (the controller, `t`, the author's name) arrives as an
 * argument.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';

import type { User } from '@/api/types';
import { normalizeAmountInput, subMoney } from '@/domain/money';
import { categoryName } from '@/i18n/category';
import { formatAmountPlain, formatDate, formatMoney } from '@/i18n/format';
import { radius, space } from '@/theme/tokens';
import { useColors } from '@/theme/ThemeProvider';
import { Badge, Icon, KIND_ICON, KIND_SIGN, SourceTypeIcon, Text, TintCard } from '@/ui';

import type { SummaryRow } from './SummaryCard';
import { showsSecondLeg } from './schemas';
import type { TxFormController } from './useTransactionForm';

/** 04 §14.6: an empty display name falls back to the part of the email before the `@`. */
export function authorName(user: User | null): string {
  if (!user) return '—';
  return user.display_name ?? user.email.split('@')[0];
}

export function summaryContent({
  ctrl,
  t,
  userName,
}: {
  ctrl: TxFormController;
  t: TFunction;
  userName: string;
}): { headline: React.ReactNode; rows: SummaryRow[]; note: React.ReactNode } {
  const { values, kind } = ctrl;
  const pending = t('transaction:form.summary_pending');

  if (kind === 'transfer') {
    return {
      headline: <TransferLegs ctrl={ctrl} />,
      rows: [
        {
          label: t('transaction:form.field.subtype'),
          value: t(`transaction:transfer.subtype.${values.subtype}`),
        },
        {
          label: t('transaction:form.summary_net_worth'),
          value: values.external
            ? t('transaction:form.summary_net_worth_moves')
            : t('transaction:form.summary_net_worth_same'),
        },
        {
          label: t('transaction:form.summary_counted'),
          value: t('transaction:form.summary_counted_no'),
        },
      ],
      note: values.external ? (
        <TintCard tone="warning" label={t('transaction:form.summary_single_leg_title')}>
          <Text variant="caption" tone="warning">
            {t('transaction:transfer.single_leg_hint')}
          </Text>
        </TintCard>
      ) : null,
    };
  }

  const name = (code: string): string => {
    const category = ctrl.index?.byCode[code];
    return category ? categoryName(category, ctrl.lang) : code;
  };
  const categoryText =
    values.category_l1 === null
      ? pending
      : values.category_l2 === null
        ? name(values.category_l1)
        : `${name(values.category_l1)} / ${name(values.category_l2)}`;

  const magnitude = normalizeAmountInput(values.amount);
  // The one number in the whole form allowed to carry a semantic colour (04 §6.2 rule 2).
  const tone = kind === 'expense' ? 'expense' : kind === 'income' ? 'income' : 'refund';

  return {
    headline: (
      <View style={styles.headline}>
        {KIND_SIGN[kind] !== null ? (
          <Text mono weight={450} tone={tone} style={styles.headlineSign}>
            {KIND_SIGN[kind]}
          </Text>
        ) : null}
        <Text
          mono
          weight={450}
          tone={tone}
          style={styles.headlineAmount}
          numberOfLines={1}
          testID="tx-summary-amount"
        >
          {magnitude === null ? '—' : formatAmountPlain(magnitude, values.currency)}
        </Text>
        <Text variant="body" mono tone="muted">
          {values.currency}
        </Text>
      </View>
    ),
    rows: [
      {
        label: t('transaction:form.summary_kind'),
        value: (
          <Badge
            label={t(`transaction:kind.${kind}`)}
            tone={`kind-${kind}` as const}
            icon={KIND_ICON[kind]}
            testID="tx-summary-kind"
          />
        ),
      },
      {
        label: t('transaction:form.source'),
        value: ctrl.sourceById(values.source_id === '' ? null : values.source_id)?.name ?? pending,
      },
      { label: t('transaction:form.category_title'), value: categoryText },
      {
        label: t('transaction:form.date'),
        value: values.occurred_at === '' ? '—' : formatDate(values.occurred_at, ctrl.lang),
        mono: true,
      },
      { label: t('transaction:form.summary_author'), value: userName },
    ],
    note: null,
  };
}

function Leg({
  icon,
  name,
  amount,
  tone,
  testID,
}: {
  icon: React.ReactNode;
  name: string;
  amount: string;
  tone: 'expense' | 'income' | 'muted';
  testID: string;
}): React.JSX.Element {
  const colors = useColors();
  return (
    <View style={[styles.leg, { backgroundColor: colors['bg.subtle'] }]} testID={testID}>
      {icon}
      <Text variant="body" weight={500} numberOfLines={1} style={styles.grow}>
        {name}
      </Text>
      <Text variant="body" mono weight={500} tone={tone} numberOfLines={1}>
        {amount}
      </Text>
    </View>
  );
}

function TransferLegs({ ctrl }: { ctrl: TxFormController }): React.JSX.Element {
  const { t } = useTranslation();
  const colors = useColors();
  const { values, lang } = ctrl;
  const external = values.external;
  const out = normalizeAmountInput(values.amount);
  const cross = showsSecondLeg(values);
  const into = cross ? normalizeAmountInput(values.amount_in) : out;

  const account = ctrl.sourceById(values.source_id === '' ? null : values.source_id);
  const target = ctrl.sourceById(values.to_source_id === '' ? null : values.to_source_id);
  const pending = t('transaction:form.summary_pending');

  const wallet = (type: React.ComponentProps<typeof SourceTypeIcon>['type'] | null) =>
    type === null ? (
      <View style={[styles.well, { backgroundColor: colors['bg.canvas'] }]}>
        <Icon name="users" size={16} color={colors['fg.secondary']} />
      </View>
    ) : (
      <SourceTypeIcon type={type} size={30} />
    );

  const money = (amount: string | null, currency: string, sign: '-' | '+'): string => {
    if (amount === null || currency === '') return '—';
    const signed = sign === '-' ? subMoney('0', amount) : amount;
    return formatMoney(signed, currency, lang);
  };

  // A single leg has one account and one free-text side; the free-text side never moves
  // money of its own (decision §1.2), so it shows 「不记账」 rather than a number.
  const counterparty =
    values.counterparty === '' ? t('transaction:transfer.counterparty_label') : values.counterparty;
  const outgoing = !external || values.direction === 'out';

  const accountLeg = (
    <Leg
      testID="tx-summary-leg-account"
      icon={wallet(account?.type ?? null)}
      name={account?.name ?? pending}
      amount={money(out, values.currency, outgoing ? '-' : '+')}
      tone={outgoing ? 'expense' : 'income'}
    />
  );
  const otherLeg = external ? (
    <Leg
      testID="tx-summary-leg-other"
      icon={wallet(null)}
      name={counterparty}
      amount={t('transaction:form.summary_off_book')}
      tone="muted"
    />
  ) : (
    <Leg
      testID="tx-summary-leg-to"
      icon={wallet(target?.type ?? null)}
      name={target?.name ?? pending}
      amount={money(into, cross ? values.currency_in : values.currency, '+')}
      tone="income"
    />
  );

  return (
    <View style={styles.legs}>
      {outgoing ? accountLeg : otherLeg}
      {outgoing ? otherLeg : accountLeg}
    </View>
  );
}

const styles = StyleSheet.create({
  headline: { flexDirection: 'row', alignItems: 'baseline', gap: space['1'] + 2 },
  headlineSign: { fontSize: 22, lineHeight: 28 },
  headlineAmount: { fontSize: 30, lineHeight: 36, flexShrink: 1 },
  legs: { gap: space['2'], alignSelf: 'stretch' },
  leg: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space['2'] + 2,
    paddingHorizontal: space['3'],
    paddingVertical: space['2'] + 2,
    borderRadius: radius.md,
  },
  grow: { flex: 1, minWidth: 0 },
  well: {
    width: 30,
    height: 30,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
});
