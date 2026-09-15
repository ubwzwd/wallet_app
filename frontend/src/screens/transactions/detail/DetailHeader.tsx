/**
 * The headline card of a detail page (04 §4.7, 屏幕稿 07 / 08).
 *
 * One white card carries the whole answer to "what is this": the badge row (kind, category
 * path, 已折算 / 子类型 / 条腿), the 40/46 mono amount in the kind's colour, the grey line
 * under it (the rate, or what a transfer does to the ledger), and — on a wide screen — the
 * operations pushed to the right of the badges. Below that sits the tinted account strip,
 * and after it whatever the page adds: the two legs of a transfer, nothing for an expense.
 *
 * Two things it deliberately does not render: the transaction id (decision §14.52 A6) and
 * the date / note / recorder, which belong to the fact list (`KeyFacts`) — repeating them
 * here is what made the phase-6 page a stack of key/value pairs instead of a headline.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';

import type { Money, TxKind } from '@/api/types';
import { useLang } from '@/i18n';
import { type FormatMoneyOptions, formatMoney } from '@/i18n/format';
import { density, space } from '@/theme/tokens';
import { useIsWide } from '@/theme/useBreakpoint';
import { Card, KIND_AMOUNT_TONE, Text } from '@/ui';

import { KindHeadBadge, plainAmount } from './parts';

export interface DetailHeaderProps {
  kind: TxKind;
  amount: Money;
  currency: string;
  /** `never` for a transfer: the legs below carry the signs (a transfer is not a loss). */
  signDisplay?: FormatMoneyOptions['signDisplay'];
  /**
   * 屏幕稿 07 writes a transfer's headline as bare digits — 「3,000.00」, 「+5,000.00」 — because
   * the grey line right under it already opens with the currency (「CNY · 账本内部搬钱…」).
   * Every other shape keeps the symbol `formatMoney` puts there.
   */
  plain?: boolean;
  /** Pills after the kind badge: the category path, 已折算, the subtype, 「2 条腿」. */
  badges?: React.ReactNode;
  /** Wide only: the action row, right-aligned on the badges' line. */
  actions?: React.ReactNode;
  /** The grey line under the amount — the rate line, or the transfer's explanation. */
  sub?: React.ReactNode;
  /** The tinted strip: merchant over 「账户 · 类型 · 币种」. */
  account?: React.ReactNode;
  /** Anything after the strip: the legs grid of a transfer. */
  children?: React.ReactNode;
  testID?: string;
}

export function DetailHeader({
  kind,
  amount,
  currency,
  signDisplay,
  plain = false,
  badges,
  actions,
  sub,
  account,
  children,
  testID,
}: DetailHeaderProps): React.JSX.Element {
  const lang = useLang();
  const wide = useIsWide();
  const id = testID ?? 'detail-header';

  return (
    <Card
      variant="raised"
      testID={id}
      style={[styles.card, wide ? styles.cardWide : styles.cardNarrow]}
    >
      <View style={wide ? styles.topRowWide : styles.topRowNarrow}>
        <View style={styles.head}>
          <View style={styles.badgeRow}>
            <KindHeadBadge kind={kind} testID={`${id}-kind`} />
            {badges}
          </View>
          <View style={styles.amountBlock}>
            <Text
              mono
              weight={500}
              numberOfLines={1}
              adjustsFontSizeToFit
              tone={KIND_AMOUNT_TONE[kind]}
              style={wide ? styles.amountWide : styles.amountNarrow}
              testID={`${id}-amount`}
            >
              {plain
                ? plainAmount(amount, currency, signDisplay)
                : formatMoney(amount, currency, lang, signDisplay ? { signDisplay } : undefined)}
            </Text>
            {sub}
          </View>
        </View>
        {wide ? actions : null}
      </View>

      {account}
      {children}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { alignSelf: 'stretch', gap: space['5'] },
  cardWide: { padding: space['5'] + 2 },
  cardNarrow: { padding: density.rowInnerPadding + 2 },
  topRowWide: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: space['5'],
  },
  topRowNarrow: { alignSelf: 'stretch' },
  head: { flexShrink: 1, minWidth: 0, gap: space['3'] },
  amountBlock: { gap: 2, alignSelf: 'stretch' },
  badgeRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space['2'] },
  // 屏幕稿: 40/46 wide, 36/42 narrow, mono 450, −0.02em.
  amountWide: { fontSize: 40, lineHeight: 46, letterSpacing: -0.8 },
  amountNarrow: { fontSize: 36, lineHeight: 42, letterSpacing: -0.72 },
});
