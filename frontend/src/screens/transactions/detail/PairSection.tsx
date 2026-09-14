/**
 * The transfer half of the detail page (04 §4.7, decisions §14.34, §14.53a).
 *
 * `TransferLegs` draws the two legs of a paired transfer side by side — account, amount,
 * currency, each leg keeping its own numbers so a cross-currency pair reads honestly. It
 * deliberately shows no running balance (decision §14.52 A7).
 *
 * `PairSection` is the single-leg case: the other side is just `counterparty` text (or
 * "对方不在应用里"), and the leg can be married to another single leg through
 * `POST .../transactions/{tid}/pair`. The candidate picker reuses the list filters
 * (`TransactionPicker`) and narrows them the way §4.7 asks: `kind=transfer` is fixed and
 * unremovable, ±3 days around this leg is prefilled but editable, and "same currency, same
 * amount" is a checkbox that starts on and can be turned off — the conditions have to be
 * relaxable or a legitimate pair that is off by a day or a cent becomes unreachable.
 *
 * Subtype is **not** part of the filter (decision §14.53a): a repayment is very often filed
 * as `plain` on the debit-card side and `repayment` on the credit-card side, so filtering by
 * it would mean the pairing never fires. The confirm box instead spells out what pairing
 * will do to the subtype.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { useTranslation } from 'react-i18next';

import type { Money, Transaction, TransferRole, Uuid } from '@/api/types';
import { absMoney } from '@/domain/money';
import { routes } from '@/domain/routes';
import { useLang } from '@/i18n';
import { formatDate, formatMoney, parseLocalDate } from '@/i18n/format';
import { usePairTransaction } from '@/queries';
import { useLedgerContext } from '@/store';
import { radius, space } from '@/theme/tokens';
import { useColors } from '@/theme/ThemeProvider';
import { useIsWide } from '@/theme/useBreakpoint';
import { Button, Card, Checkbox, Icon, Text, confirm, toast } from '@/ui';

import { TransactionPicker } from '../TransactionPicker';

/** How far around this leg's date the candidate search starts (04 §4.7). */
export const PAIR_WINDOW_DAYS = 3;

function shiftIso(iso: string, days: number): string {
  const d = parseLocalDate(iso);
  d.setDate(d.getDate() + days);
  const pad = (n: number): string => (n < 10 ? `0${n}` : String(n));
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export interface LegLike {
  source_id: Uuid;
  amount: Money;
  currency: string;
}

export interface TransferLegsProps {
  out: LegLike;
  /** `in` is a reserved word in a destructuring position often enough to be worth renaming. */
  into: LegLike;
  sourceNames: Readonly<Record<Uuid, string>>;
  testID?: string;
}

function Leg({
  label,
  leg,
  sourceNames,
  testID,
}: {
  label: string;
  leg: LegLike;
  sourceNames: Readonly<Record<Uuid, string>>;
  testID: string;
}): React.JSX.Element {
  const lang = useLang();
  const colors = useColors();
  return (
    <View
      testID={testID}
      style={[styles.leg, { borderColor: colors['border.default'] }]}
    >
      <Text variant="caption" tone="muted">
        {label}
      </Text>
      <Text variant="body" numberOfLines={1} testID={`${testID}-source`}>
        {sourceNames[leg.source_id] ?? leg.source_id}
      </Text>
      <Text variant="subheading" mono testID={`${testID}-amount`}>
        {formatMoney(leg.amount, leg.currency, lang)}
      </Text>
      <Text variant="caption" tone="muted">
        {leg.currency}
      </Text>
    </View>
  );
}

export function TransferLegs({
  out,
  into,
  sourceNames,
  testID,
}: TransferLegsProps): React.JSX.Element {
  const { t } = useTranslation();
  const colors = useColors();
  const wide = useIsWide();
  const id = testID ?? 'detail-legs';

  return (
    <Card testID={id} style={styles.card}>
      <View style={[styles.legs, wide ? styles.legsRow : styles.legsColumn]}>
        <Leg
          label={t('transaction:transfer.role.out')}
          leg={out}
          sourceNames={sourceNames}
          testID={`${id}-out`}
        />
        <Icon
          name={wide ? 'chevron-right' : 'arrow-down'}
          size={20}
          color={colors['fg.muted']}
        />
        <Leg
          label={t('transaction:transfer.role.in')}
          leg={into}
          sourceNames={sourceNames}
          testID={`${id}-in`}
        />
      </View>
    </Card>
  );
}

export interface PairSectionProps {
  /** A single-leg transfer: `transfer_pair_id === null`. */
  tx: Transaction;
  sourceNames: Readonly<Record<Uuid, string>>;
  testID?: string;
}

export function PairSection({ tx, sourceNames, testID }: PairSectionProps): React.JSX.Element {
  const { t } = useTranslation();
  const lang = useLang();
  const router = useRouter();
  const colors = useColors();
  const { ledgerId } = useLedgerContext();
  const id = testID ?? 'detail-pair';

  const [open, setOpen] = React.useState(false);
  // "Same currency and same amount" — on by default, because that is what a real pair looks
  // like; off is how the user relaxes the search (04 §4.7).
  const [strict, setStrict] = React.useState(true);
  const pair = usePairTransaction(ledgerId, tx.id);

  const oppositeRole: TransferRole = tx.transfer_role === 'out' ? 'in' : 'out';
  const amount = absMoney(tx.amount);

  const onSelect = React.useCallback(
    (other: Transaction): void => {
      void confirm({
        title: t('transaction:detail.pair_action'),
        body: t('transaction:detail.pair_subtype_hint'),
        confirmLabel: t('common:button.confirm'),
        cancelLabel: t('common:button.cancel'),
      }).then((ok) => {
        if (!ok) return;
        pair.mutate(
          { other_transaction_id: other.id },
          {
            onSuccess: (result) => {
              toast.success(t('transaction:detail.pair_saved'));
              router.replace(routes.l(ledgerId).transfer(result.pair_id) as Href);
            },
          },
        );
      });
    },
    [ledgerId, pair, router, t],
  );

  return (
    <Card testID={id} style={styles.card}>
      <View style={[styles.legs, styles.legsColumn]}>
        <View style={[styles.leg, { borderColor: colors['border.default'] }]}>
          <Text variant="caption" tone="muted">
            {t(`transaction:transfer.role.${tx.transfer_role ?? 'out'}`)}
          </Text>
          <Text variant="body" numberOfLines={1} testID={`${id}-source`}>
            {sourceNames[tx.source_id] ?? tx.source_id}
          </Text>
          <Text variant="subheading" mono>
            {formatMoney(tx.amount, tx.currency, lang)}
          </Text>
        </View>
        <View style={[styles.leg, styles.legExternal, { borderColor: colors['border.default'] }]}>
          <Text variant="caption" tone="muted">
            {t('transaction:transfer.counterparty_label')}
          </Text>
          <Text variant="body" tone={tx.counterparty ? 'primary' : 'muted'} testID={`${id}-counterparty`}>
            {tx.counterparty ?? t('transaction:detail.counterparty_external')}
          </Text>
        </View>
      </View>

      <Button
        testID={`${id}-action`}
        variant="secondary"
        size="sm"
        icon="link"
        label={t('transaction:detail.pair_action')}
        onPress={() => setOpen(true)}
        loading={pair.isPending}
      />

      <TransactionPicker
        testID={`${id}-picker`}
        open={open}
        onClose={() => setOpen(false)}
        onSelect={onSelect}
        title={t('transaction:detail.pair_action')}
        emptyText={t('transaction:detail.pair_none_found')}
        // Never negotiable: only a transfer can be another transfer's leg.
        fixed={{ kind: ['transfer'] }}
        initial={{
          from: shiftIso(tx.occurred_at, -PAIR_WINDOW_DAYS),
          to: shiftIso(tx.occurred_at, PAIR_WINDOW_DAYS),
        }}
        toolbar={
          <View style={styles.toolbar}>
            <Checkbox
              testID={`${id}-strict`}
              checked={strict}
              onChange={setStrict}
              label={t('transaction:detail.pair_same_amount_toggle', {
                amount: formatMoney(amount, tx.currency, lang),
              })}
            />
            <Text variant="caption" tone="muted">
              {t('transaction:detail.pair_hint')}
            </Text>
          </View>
        }
        filterRows={(row) =>
          row.id !== tx.id &&
          row.kind === 'transfer' &&
          row.transfer_pair_id === null &&
          row.transfer_role === oppositeRole &&
          row.source_id !== tx.source_id &&
          (!strict || (row.currency === tx.currency && absMoney(row.amount) === amount))
        }
        renderRow={(row) => (
          <View style={styles.pickerRow}>
            <Text variant="body" mono>
              {formatDate(row.occurred_at, lang)}
            </Text>
            <Text variant="body" numberOfLines={1} style={styles.pickerMain}>
              {sourceNames[row.source_id] ?? row.note ?? ''}
            </Text>
            <Text variant="body" mono>
              {formatMoney(row.amount, row.currency, lang)}
            </Text>
          </View>
        )}
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: space['3'], alignSelf: 'stretch' },
  legs: { alignItems: 'center', gap: space['2'], alignSelf: 'stretch' },
  legsRow: { flexDirection: 'row' },
  legsColumn: { flexDirection: 'column' },
  leg: {
    flex: 1,
    alignSelf: 'stretch',
    gap: space['1'],
    padding: space['3'],
    borderWidth: 1,
    borderRadius: radius.md,
  },
  legExternal: { borderStyle: 'dashed' },
  toolbar: { gap: space['1'], alignSelf: 'stretch' },
  pickerRow: { flexDirection: 'row', alignItems: 'center', gap: space['3'] },
  pickerMain: { flex: 1 },
});
