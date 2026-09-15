/**
 * Marrying a lonely leg to its other half (04 §4.7, decisions §14.34, §14.53a, 屏幕稿 07).
 *
 * `POST .../transactions/{tid}/pair` behind the candidate picker. It reuses the list
 * filters and narrows them the way §4.7 asks: `kind=transfer` is fixed and unremovable,
 * ±3 days around this leg is prefilled but editable, and "same currency, same amount" is a
 * checkbox that starts on and can be turned off — the conditions have to be relaxable or a
 * legitimate pair that is off by a day or a cent becomes unreachable.
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

import type { Transaction, TransferRole, Uuid } from '@/api/types';
import { absMoney } from '@/domain/money';
import { routes } from '@/domain/routes';
import { useLang } from '@/i18n';
import { formatDate, parseLocalDate } from '@/i18n/format';
import { usePairTransaction } from '@/queries';
import { useLedgerContext } from '@/store';
import { space } from '@/theme/tokens';
import { Checkbox, Text, confirm, toast } from '@/ui';

import { useAmountText } from '../amount';
import { TransactionPicker } from '../TransactionPicker';

/** How far around this leg's date the candidate search starts (04 §4.7). */
export const PAIR_WINDOW_DAYS = 3;

function shiftIso(iso: string, days: number): string {
  const d = parseLocalDate(iso);
  d.setDate(d.getDate() + days);
  const pad = (n: number): string => (n < 10 ? `0${n}` : String(n));
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export interface PairSectionProps {
  /** A single-leg transfer: `transfer_pair_id === null`. */
  tx: Transaction;
  sourceNames: Readonly<Record<Uuid, string>>;
  open: boolean;
  onClose(): void;
  testID?: string;
}

/**
 * The candidate picker behind 「关联为转账对腿」. The button itself lives in the page's
 * action row (屏幕稿 07 makes it the wide layout's primary action), so this renders the
 * overlay only — and nothing at all while it is closed.
 */
export function PairSection({
  tx,
  sourceNames,
  open,
  onClose,
  testID,
}: PairSectionProps): React.JSX.Element {
  const { t } = useTranslation();
  const lang = useLang();
  const router = useRouter();
  const { ledgerId } = useLedgerContext();
  const money = useAmountText();
  const id = testID ?? 'detail-pair';

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
    <TransactionPicker
      testID={`${id}-picker`}
      open={open}
      onClose={onClose}
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
              amount: money(amount, tx.currency),
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
            {money(row.amount, row.currency)}
          </Text>
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  toolbar: { gap: space['1'], alignSelf: 'stretch' },
  pickerRow: { flexDirection: 'row', alignItems: 'center', gap: space['3'] },
  pickerMain: { flex: 1 },
});
