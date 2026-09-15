/**
 * The band under a refund or transfer row (04 §4.11.3, 屏幕稿 03).
 *
 * 屏幕稿 03 takes the linking half of the old「关联 / 对手」cell out of the row and gives it
 * its own tinted strip underneath: sand for a refund pointing at its original expense, slate
 * for a transfer being paired with its opposite leg. Same semantics, more room — the
 * checkbox still reads and writes `matched_transaction_id` and nothing else (decision
 * §14.53b), and the strip is what the phone card shows too.
 *
 * The transfer strip also carries the row's own direction and subtype switches (04 §4.11.3,
 * last bullet): they belong to the pairing conversation and are two segments wide, which no
 * 52px cell can hold.
 */
import React from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';

import type { ImportRow, TransferRole, TransferSubtype } from '@/api/types';
import { absMoney, cmpMoney } from '@/domain/money';
import { applySign } from '@/domain/kinds';
import { formatMoney } from '@/i18n/format';
import { useTransaction } from '@/queries';
import { radius, space } from '@/theme/tokens';
import { useColors } from '@/theme/ThemeProvider';
import { Button, Checkbox, SegmentedControl, Text } from '@/ui';
import { TransactionPicker } from '@/screens/transactions/TransactionPicker';

import {
  PAIR_WINDOW_DAYS,
  REFUND_LOOKBACK_DAYS,
  isMultiCandidate,
  shiftIso,
  summarize,
} from './LinkCell';
import type { CellProps } from './ReviewRow';

/** Whether this row has a link band at all — every refund and every transfer does. */
export function hasLinkPanel(row: ImportRow): boolean {
  return row.kind === 'refund' || row.kind === 'transfer';
}

function Strip({
  tone,
  children,
  testID,
}: {
  tone: 'refund' | 'transfer';
  children: React.ReactNode;
  testID?: string;
}): React.JSX.Element {
  const colors = useColors();
  return (
    <View
      testID={testID}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: space['2'],
        paddingVertical: space['2'],
        paddingHorizontal: space['3'],
        borderRadius: radius.md,
        backgroundColor: colors[tone === 'refund' ? 'kind.refund.subtle' : 'kind.transfer.subtle'],
      }}
    >
      {children}
    </View>
  );
}

export function LinkPanel({ row, env, testID }: CellProps): React.JSX.Element | null {
  const { t } = useTranslation();
  const [pickerOpen, setPickerOpen] = React.useState(false);

  const matched = useTransaction(env.ledgerId, row.matched_transaction_id ?? undefined);
  const matchedTx = matched.data;
  const matchedSource = env.sources.find((s) => s.id === matchedTx?.source_id)?.name;

  if (row.kind !== 'refund' && row.kind !== 'transfer') return null;

  const summary = summarize(matchedTx, matchedSource, env.lang);
  const paired = row.matched_transaction_id !== null;

  // ---------------------------------------------------------------- refund
  if (row.kind === 'refund') {
    // 屏幕稿 03: 「可退余额」 is on the original expense, and only a fetched one carries it.
    const refundable =
      matchedTx?.refundable === undefined
        ? null
        : t('import:review.linked.refundable', {
            amount: formatMoney(matchedTx.refundable, matchedTx.currency, env.lang),
          });
    return (
      <Strip tone="refund" testID={`${testID}-panel`}>
        <Checkbox
          testID={`${testID}-pair`}
          checked={paired}
          label={t('import:review.linked.refund_origin')}
          onChange={() => {
            if (paired) env.ctrl.patch(row, { matched_transaction_id: null });
            else setPickerOpen(true);
          }}
        />
        {paired ? (
          <Text
            variant="body"
            tone="secondary"
            numberOfLines={2}
            style={{ flex: 1, minWidth: 0 }}
            testID={`${testID}-origin`}
          >
            {[summary, refundable].filter(Boolean).join(' · ')}
          </Text>
        ) : (
          <View style={{ flex: 1, minWidth: 0 }} />
        )}
        <Button
          testID={`${testID}-pick`}
          size="sm"
          variant="secondary"
          label={t(paired ? 'import:review.linked.refund_repick' : 'import:review.linked.refund_pick')}
          onPress={() => setPickerOpen(true)}
        />
        <TransactionPicker
          testID={`${testID}-picker`}
          open={pickerOpen}
          onClose={() => setPickerOpen(false)}
          onSelect={(tx) => {
            env.ctrl.patch(row, { matched_transaction_id: tx.id });
            setPickerOpen(false);
          }}
          title={t('transaction:picker.title_refund_origin')}
          // A refund may only ever point at an expense (decision §1.1, §14.52 B11).
          fixed={{ kind: ['expense'] }}
          initial={{
            source_id: [env.batch.source_id],
            from: row.date ? shiftIso(row.date, -REFUND_LOOKBACK_DAYS) : undefined,
          }}
        />
      </Strip>
    );
  }

  // ---------------------------------------------------------------- transfer
  const multi = isMultiCandidate(row);
  const candidate = row.flags.includes('transfer_candidate');

  return (
    <Strip tone="transfer" testID={`${testID}-panel`}>
      {paired || candidate ? (
        // Unchecking sends `{matched_transaction_id: null}` and nothing else; checking an
        // empty box opens the candidate list (decision §14.53b).
        <Checkbox
          testID={`${testID}-pair`}
          checked={paired}
          label={t('import:review.linked.transfer_pair_confirm')}
          onChange={() => {
            if (paired) env.ctrl.patch(row, { matched_transaction_id: null });
            else setPickerOpen(true);
          }}
        />
      ) : null}

      {/* The middle of the strip — what the pairing is *with*. A row with nothing to say
          there leaves the two switches where they are, at the left, rather than pushing
          them across an empty band. */}
      {paired || row.flags.includes('duplicate') ? (
        <View style={{ flex: 1, minWidth: 0, gap: space['1'] }}>
          {paired && summary !== null ? (
            <Text variant="body" tone="secondary" testID={`${testID}-pair-summary`}>
              {summary}
            </Text>
          ) : null}
          {paired ? (
            <Text variant="micro" tone="muted">
              {t('import:review.linked.transfer_pair_hint')}
            </Text>
          ) : null}
          {/* The server found the opposite leg but it is already half of another transfer,
              so it re-flagged the row `duplicate` instead of pairing it (04 §4.11.3, last
              case). Say so here — the row's `hint` alone is too easy to miss. */}
          {!paired && row.flags.includes('duplicate') ? (
            <Text variant="body" tone="muted" testID={`${testID}-already-paired`}>
              {t('import:review.linked.transfer_already_paired')}
            </Text>
          ) : null}
        </View>
      ) : null}

      {multi ? (
        <Button
          testID={`${testID}-pick-one`}
          size="sm"
          variant="secondary"
          label={t('import:review.linked.transfer_pick_single')}
          onPress={() => setPickerOpen(true)}
        />
      ) : null}

      {/* Both are non-null on any transfer row (03 §5.41): the server guarantees it for the
          rows it parsed, and `kindChangePatch` fills them in for a row the user turned into
          a transfer. The fallbacks below are the same defaults that patch writes, so what
          is painted here is never a value the server has not been told about. */}
      <SegmentedControl<TransferRole>
        testID={`${testID}-role`}
        size="sm"
        value={row.transfer_role ?? 'out'}
        options={[
          { value: 'out', label: t('transaction:transfer.role.out') },
          { value: 'in', label: t('transaction:transfer.role.in') },
        ]}
        onChange={(next) =>
          env.ctrl.patch(row, {
            transfer_role: next,
            // The sign belongs to the leg's direction (decision §1).
            ...(row.amount !== null ? { amount: applySign(row.amount, 'transfer', next) } : {}),
          })
        }
      />
      <SegmentedControl<TransferSubtype>
        testID={`${testID}-subtype`}
        size="sm"
        value={row.transfer_subtype ?? 'plain'}
        options={[
          { value: 'plain', label: t('transaction:transfer.subtype.plain') },
          { value: 'repayment', label: t('transaction:transfer.subtype.repayment') },
        ]}
        onChange={(next) => env.ctrl.patch(row, { transfer_subtype: next })}
      />

      <TransactionPicker
        testID={`${testID}-picker`}
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSelect={(tx) => {
          env.ctrl.patch(row, { matched_transaction_id: tx.id });
          setPickerOpen(false);
        }}
        title={t('import:review.linked.transfer_pick_single')}
        emptyText={t('import:review.linked.transfer_pick_none')}
        // Only a transfer can be another transfer's leg (decision §14.34).
        fixed={{ kind: ['transfer'] }}
        initial={{
          from: row.date ? shiftIso(row.date, -PAIR_WINDOW_DAYS) : undefined,
          to: row.date ? shiftIso(row.date, PAIR_WINDOW_DAYS) : undefined,
        }}
        // Still one-legged, on another account, opposite direction, same amount and currency.
        filterRows={(tx) =>
          tx.transfer_pair_id === null &&
          tx.source_id !== env.batch.source_id &&
          (row.currency === null || tx.currency === row.currency) &&
          (row.amount === null ||
            (cmpMoney(absMoney(tx.amount), absMoney(row.amount)) === 0 &&
              cmpMoney(tx.amount, row.amount) !== 0))
        }
      />
    </Strip>
  );
}
