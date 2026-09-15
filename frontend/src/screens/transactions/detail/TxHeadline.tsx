/**
 * The headline block of `/transactions/:txId` — 屏幕稿 08 for an expense / income / refund,
 * 屏幕稿 07 单腿 for a lonely transfer leg.
 *
 * Both shapes are the same card: badges, the big amount, one grey line under it, and then
 * either the tinted account strip (a spend) or the two leg tiles with the beige "this is a
 * single leg" note (a transfer). On a narrow screen the mockup splits the legs into a card
 * of their own, which is the only structural difference between the two widths.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import type { Transaction } from '@/api/types';
import { radius, space } from '@/theme/tokens';
import { useColors } from '@/theme/ThemeProvider';
import { useIsWide } from '@/theme/useBreakpoint';
import { Card, Text, sourceTypeLabelKey } from '@/ui';

import { DetailHeader } from './DetailHeader';
import { RateLine } from './RateLine';
import { TransferLegs, type SourceMap } from './TransferLegs';
import { AccountRow, InfoBadge, plainAmount } from './parts';

export interface TxHeadlineProps {
  tx: Transaction;
  sources: SourceMap;
  /** 「交通 / 打车」, already resolved; transfers have none. */
  category: string | null;
  baseCurrency: string;
  /** The `DetailActions` row; the card only renders it on a wide screen. */
  actions: React.ReactNode;
}

export function TxHeadline({
  tx,
  sources,
  category,
  baseCurrency,
  actions,
}: TxHeadlineProps): React.JSX.Element {
  const { t } = useTranslation();
  const colors = useColors();
  const wide = useIsWide();

  const isTransfer = tx.kind === 'transfer';
  const source = sources[tx.source_id];
  const foreign = tx.currency.toUpperCase() !== baseCurrency.toUpperCase();

  const legs = isTransfer ? (
    <TransferLegs
      testID="tx-detail-pair"
      out={tx.transfer_role === 'out' ? tx : null}
      into={tx.transfer_role === 'out' ? null : tx}
      sources={sources}
      baseCurrency={baseCurrency}
      external={{
        role: tx.transfer_role === 'out' ? 'in' : 'out',
        name: tx.counterparty ?? t('transaction:detail.counterparty_external'),
      }}
      hint={
        <View style={[styles.legHint, { backgroundColor: colors['status.warning.bg'] }]}>
          <Text variant="caption" tone="warning">
            {t('transaction:detail.single_leg_card_hint')}
          </Text>
        </View>
      }
    />
  ) : null;

  return (
    <>
      <DetailHeader
        testID="tx-detail-header"
        kind={tx.kind}
        amount={tx.amount}
        currency={tx.currency}
        signDisplay={isTransfer ? 'always' : undefined}
        plain={isTransfer}
        badges={
          <>
            {category !== null ? (
              <InfoBadge label={category} testID="tx-detail-header-category" />
            ) : null}
            {isTransfer ? (
              <>
                <InfoBadge
                  testID="tx-detail-header-extra"
                  label={t(`transaction:transfer.subtype.${tx.transfer_subtype ?? 'plain'}`)}
                />
                <InfoBadge tone="warning" label={t('transaction:detail.leg_count_single')} />
              </>
            ) : null}
            {foreign ? (
              <InfoBadge tone="info" label={t('transaction:detail.converted_badge')} />
            ) : null}
          </>
        }
        actions={actions}
        sub={
          isTransfer ? (
            <Text variant="body" tone="secondary" testID="tx-detail-transfer-note">
              {t('transaction:detail.transfer_note_single', {
                currency: tx.currency,
                // 屏幕稿 07 writes every transfer figure bare — the sentence already names
                // the currency right before the number.
                delta: plainAmount(tx.amount, tx.currency, 'always'),
              })}
            </Text>
          ) : (
            <RateLine
              testID="tx-detail-rate"
              size="lead"
              amount={tx.amount}
              currency={tx.currency}
              baseCurrency={baseCurrency}
              amountBase={tx.amount_base}
              rateUsed={tx.rate_used}
              rateDate={tx.rate_date}
              occurredAt={tx.occurred_at}
            />
          )
        }
        account={
          isTransfer ? null : (
            <AccountRow
              testID="tx-detail-header-account"
              kind={tx.kind}
              title={tx.merchant ?? source?.name ?? tx.source_id}
              subtitle={
                source
                  ? `${source.name} · ${t(sourceTypeLabelKey(source.type))} · ${tx.currency}`
                  : tx.currency
              }
            />
          )
        }
      >
        {wide ? legs : null}
      </DetailHeader>

      {!wide && legs !== null ? (
        <Card variant="raised" testID="tx-detail-legs-card">
          {legs}
        </Card>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  legHint: { alignSelf: 'stretch', padding: space['3'] - 2, borderRadius: radius.md - 2 },
});
