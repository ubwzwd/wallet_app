/**
 * The two legs of a transfer, drawn the way 屏幕稿 07 draws them.
 *
 * A tinted tile per leg — 转出腿 / 转入腿, the account's icon well, its name over
 * 「储蓄卡 · CNY」, the signed amount in mono — with a round arrow between them. A leg in a
 * foreign currency carries its own rate line, so a cross-currency pair reads honestly on
 * both halves. No running balance is shown (decision §14.52 A7).
 *
 * `external` turns one side into the counterparty tile of a single leg: an outlined tile
 * saying 「不记账 / 没有余额」, because the other side is a piece of text, not an account.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import type { FinanceSource, IsoDate, Money, TransferRole, Uuid } from '@/api/types';
import { radius, space } from '@/theme/tokens';
import { useColors } from '@/theme/ThemeProvider';
import { useIsWide } from '@/theme/useBreakpoint';
import { Icon, SourceTypeIcon, Text, sourceTypeLabelKey } from '@/ui';

import { RateLine } from './RateLine';
import { plainAmount } from './parts';

export interface LegLike {
  source_id: Uuid;
  amount: Money;
  currency: string;
  // The conversion triple (decision §14.52 A24). Present on a real leg; optional so the
  // rate line simply does not render for a caller that has no rate to show.
  amount_base?: Money | null;
  rate_used?: Money | null;
  rate_date?: IsoDate | null;
  occurred_at?: IsoDate;
}

export type SourceMap = Readonly<Record<Uuid, FinanceSource>>;

/** The counterparty of a single leg: a name, on the side the ledger's own leg is not. */
export interface ExternalSide {
  /** The role the *counterparty* plays — the opposite of this leg's own role. */
  role: TransferRole;
  name: string;
}

function LegTile({
  label,
  leg,
  sources,
  baseCurrency,
  testID,
}: {
  label: string;
  leg: LegLike;
  sources: SourceMap;
  baseCurrency?: string;
  testID: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  const colors = useColors();
  const wide = useIsWide();
  const source = sources[leg.source_id];
  const negative = leg.amount.trimStart().startsWith('-');

  return (
    <View testID={testID} style={[styles.tile, { backgroundColor: colors['bg.canvas'] }]}>
      <Text variant="micro" tone="muted" mono weight={600}>
        {label}
      </Text>
      <View style={wide ? styles.tileHeadWide : styles.tileHeadNarrow}>
        <SourceTypeIcon type={source?.type ?? 'other'} size={wide ? 36 : 30} />
        <View style={styles.tileText}>
          <Text
            variant="subheading"
            weight={500}
            numberOfLines={1}
            style={wide ? undefined : styles.tileNameNarrow}
            testID={`${testID}-source`}
          >
            {source?.name ?? leg.source_id}
          </Text>
          <Text variant="caption" tone="muted" mono numberOfLines={1}>
            {source
              ? `${t(sourceTypeLabelKey(source.type))} · ${leg.currency}`
              : leg.currency}
          </Text>
        </View>
      </View>
      <Text
        mono
        weight={500}
        numberOfLines={1}
        adjustsFontSizeToFit
        tone={negative ? 'expense' : 'income'}
        style={wide ? styles.legAmountWide : styles.legAmountNarrow}
        testID={`${testID}-amount`}
      >
        {plainAmount(leg.amount, leg.currency, 'always')}
      </Text>
      {baseCurrency !== undefined && leg.occurred_at !== undefined ? (
        <RateLine
          testID={`${testID}-rate`}
          amount={leg.amount}
          currency={leg.currency}
          baseCurrency={baseCurrency}
          amountBase={leg.amount_base ?? null}
          rateUsed={leg.rate_used ?? null}
          rateDate={leg.rate_date ?? null}
          occurredAt={leg.occurred_at}
        />
      ) : null}
    </View>
  );
}

function ExternalTile({
  side,
  testID,
}: {
  side: ExternalSide;
  testID: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  const colors = useColors();
  const wide = useIsWide();
  return (
    <View
      testID={`${testID}-external`}
      style={[
        styles.tile,
        styles.tileOutlined,
        { backgroundColor: colors['bg.raised'], borderColor: colors['border.strong'] },
      ]}
    >
      <Text variant="micro" tone="muted" mono weight={600} numberOfLines={1}>
        {t(
          wide
            ? 'transaction:detail.leg_external'
            : 'transaction:detail.leg_external_short',
          { role: t(`transaction:transfer.role.${side.role}`) },
        )}
      </Text>
      <View style={wide ? styles.tileHeadWide : styles.tileHeadNarrow}>
        <View style={[styles.outsideWell, { backgroundColor: colors['bg.subtle'] }]}>
          <Icon name="arrow-left-right" size={wide ? 18 : 16} color={colors['fg.secondary']} />
        </View>
        <View style={styles.tileText}>
          <Text
            variant="subheading"
            weight={500}
            numberOfLines={1}
            style={wide ? undefined : styles.tileNameNarrow}
            testID={`${testID}-counterparty`}
          >
            {side.name}
          </Text>
          <Text variant="caption" tone="muted" numberOfLines={1}>
            {t('transaction:form.transfer_counterparty_hint')}
          </Text>
        </View>
      </View>
      <View style={styles.offBookRow}>
        <Text
          mono
          tone="muted"
          weight={500}
          style={wide ? styles.legAmountWide : styles.legAmountNarrow}
        >
          {t('transaction:form.summary_off_book')}
        </Text>
        <Text variant="caption" tone="muted">
          {t('transaction:detail.external_no_balance')}
        </Text>
      </View>
    </View>
  );
}

export interface TransferLegsProps {
  out: LegLike | null;
  /** `in` is a reserved word in a destructuring position often enough to be worth renaming. */
  into: LegLike | null;
  sources: SourceMap;
  /** The ledger's currency; each leg gets its own rate line when it differs from it. */
  baseCurrency?: string;
  /** Single leg: the side that is only a piece of text. */
  external?: ExternalSide;
  /** The line under the grid ("两条腿金额相等…", or the single-leg warning). */
  hint?: React.ReactNode;
  testID?: string;
}

export function TransferLegs({
  out,
  into,
  sources,
  baseCurrency,
  external,
  hint,
  testID,
}: TransferLegsProps): React.JSX.Element {
  const { t } = useTranslation();
  const colors = useColors();
  const wide = useIsWide();
  const id = testID ?? 'detail-legs';

  const tile = (leg: LegLike | null, role: TransferRole): React.JSX.Element =>
    leg === null && external !== undefined ? (
      <ExternalTile side={external} testID={id} />
    ) : leg === null ? (
      <View style={styles.tile} />
    ) : (
      <LegTile
        // 屏幕稿 07 shortens 转出腿 / 转入腿 to 转出 / 转入 once the tiles are 155 wide.
        label={t(
          wide
            ? `transaction:detail.leg_${role}_label`
            : `transaction:transfer.role.${role}`,
        )}
        leg={leg}
        sources={sources}
        baseCurrency={baseCurrency}
        testID={`${id}-${role}`}
      />
    );

  return (
    <View style={styles.wrap} testID={id}>
      <View style={styles.grid}>
        {tile(out, 'out')}
        <View style={styles.arrowCell} accessibilityElementsHidden importantForAccessibility="no">
          <View
            style={[
              wide ? styles.arrowWide : styles.arrowNarrow,
              { backgroundColor: colors['status.info.bg'] },
            ]}
          >
            <Icon name="arrow-right" size={wide ? 20 : 18} color={colors['status.info.fg']} />
          </View>
        </View>
        {tile(into, 'in')}
      </View>
      {hint}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignSelf: 'stretch', gap: space['2'] + 2 },
  grid: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: space['2'] + 2,
    alignSelf: 'stretch',
  },
  arrowCell: { justifyContent: 'center', flexShrink: 0 },
  tile: {
    flex: 1,
    minWidth: 0,
    gap: space['2'],
    padding: space['3'],
    borderRadius: radius.md + 2,
  },
  tileOutlined: { borderWidth: 1.5 },
  tileHeadWide: { flexDirection: 'row', alignItems: 'center', gap: space['3'] },
  tileHeadNarrow: { gap: space['2'] },
  tileText: { flex: 1, minWidth: 0 },
  tileNameNarrow: { fontSize: 14, lineHeight: 20 },
  // 屏幕稿 07: 24/30 wide, 16/22 narrow.
  legAmountWide: { fontSize: 24, lineHeight: 30 },
  legAmountNarrow: { fontSize: 16, lineHeight: 22 },
  outsideWell: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  offBookRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: space['2'],
  },
  arrowWide: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  arrowNarrow: {
    width: 32,
    height: 32,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
});
