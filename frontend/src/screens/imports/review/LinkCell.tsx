/**
 * The "link / counterparty" cell (04 §4.11.3) — one cell with three shapes.
 *
 * Refund rows point at the original expense; transfer rows carry the pairing checkbox plus
 * the counterparty controls; everything else is an em dash.
 *
 * The one thing to keep straight: **pairing has a single carrier**, `matched_transaction_id`
 * (decision §14.53b). The checkbox reads it and writes it, unchecking sends
 * `{matched_transaction_id: null}` and nothing else, and the candidate list behind the
 * "pick one" button is not stored anywhere — it is a plain transaction-list query. The
 * `transfer_candidate` flag records that a candidate *existed*; it never decides anything.
 *
 * When no opposite leg was found the server does not guess (decision §14.53c): the account
 * picker and the free-text field start empty and are mutually exclusive — filling one
 * greys out and clears the other. Both collapse entirely once a `matched_transaction_id` is
 * set, because an existing leg makes a second one wrong.
 */
import React from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';

import type { ImportRow, Transaction, TransferRole, TransferSubtype } from '@/api/types';
import { absMoney, cmpMoney } from '@/domain/money';
import { applySign } from '@/domain/kinds';
import { formatMoney, parseLocalDate } from '@/i18n/format';
import { useTransaction } from '@/queries';
import { space } from '@/theme/tokens';
import {
  Button,
  Checkbox,
  SegmentedControl,
  SourcePicker,
  Text,
  TextField,
} from '@/ui';
import { TransactionPicker } from '@/screens/transactions/TransactionPicker';

import type { CellProps } from './ReviewRow';
import { CELL_DEBOUNCE_MS } from './ReviewRow';

/** 04 §4.11.3 / decision §14.34: candidates sit within ±3 days of the row. */
export const PAIR_WINDOW_DAYS = 3;

/** 04 §4.11.3 / decision §1.1: the refund origin picker looks back 90 days. */
export const REFUND_LOOKBACK_DAYS = 90;

/** `counterparty` is capped at 100 characters (03 §5.41). */
export const COUNTERPARTY_MAX = 100;

/** `iso` moved by whole days, staying on the local calendar. */
function shiftIso(iso: string, days: number): string {
  const d = parseLocalDate(iso);
  d.setDate(d.getDate() + days);
  const pad = (n: number): string => (n < 10 ? `0${n}` : String(n));
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * The multi-candidate shape (decision §14.53b): the server found more than one possible
 * leg, so it prefilled nothing and flagged the row `needs_review` *on top of*
 * `transfer_candidate`, with the count spelled out in `hint`.
 */
export function isMultiCandidate(row: ImportRow): boolean {
  return (
    row.kind === 'transfer' &&
    row.matched_transaction_id === null &&
    row.flags.includes('transfer_candidate') &&
    row.flags.includes('needs_review')
  );
}

function summarize(
  tx: Transaction | undefined,
  sourceName: string | undefined,
  lang: 'zh' | 'en',
): string | null {
  if (!tx) return null;
  const money = formatMoney(tx.amount, tx.currency, lang, { signDisplay: 'always' });
  // A transfer leg has no merchant (decision §14.52 B16), so it is named by its account.
  return [tx.merchant ?? sourceName, tx.occurred_at, money].filter(Boolean).join(' · ');
}

export function LinkCell({ row, env, testID }: CellProps): React.JSX.Element {
  const { t } = useTranslation();
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [text, setText] = React.useState(row.counterparty ?? '');
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const matched = useTransaction(env.ledgerId, row.matched_transaction_id ?? undefined);
  const matchedTx = matched.data;
  const matchedSource = env.sources.find((s) => s.id === matchedTx?.source_id)?.name;

  React.useEffect(() => {
    setText(row.counterparty ?? '');
  }, [row.counterparty]);
  React.useEffect(() => () => (timer.current ? clearTimeout(timer.current) : undefined), []);

  if (row.kind !== 'refund' && row.kind !== 'transfer') {
    return (
      <Text variant="caption" tone="muted" testID={testID}>
        —
      </Text>
    );
  }

  const summary = summarize(matchedTx, matchedSource, env.lang);

  // ---------------------------------------------------------------- refund
  if (row.kind === 'refund') {
    return (
      <View style={{ gap: space['1'] }}>
        {row.matched_transaction_id !== null ? (
          <Text variant="caption" numberOfLines={2} testID={`${testID}-origin`}>
            {summary ?? t('transaction:picker.linked_title')}
          </Text>
        ) : null}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space['1'] }}>
          <Button
            testID={`${testID}-pick`}
            size="sm"
            variant="ghost"
            icon="link"
            label={t('import:review.linked.refund_pick')}
            onPress={() => setPickerOpen(true)}
          />
          {row.matched_transaction_id !== null ? (
            <Button
              testID={`${testID}-clear`}
              size="sm"
              variant="ghost"
              label={t('transaction:picker.unlink')}
              onPress={() => env.ctrl.patch(row, { matched_transaction_id: null })}
            />
          ) : null}
        </View>
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
      </View>
    );
  }

  // ---------------------------------------------------------------- transfer
  const paired = row.matched_transaction_id !== null;
  const multi = isMultiCandidate(row);
  const candidate = row.flags.includes('transfer_candidate');
  const sourceDisabled = text.trim() !== '';
  const textDisabled = row.counterpart_source_id !== null;

  function commitText(next: string): void {
    // Mutually exclusive (decision §14.53c): typing a counterparty clears the account.
    env.ctrl.patch(row, {
      counterparty: next.trim() === '' ? null : next.trim(),
      counterpart_source_id: null,
    });
  }

  return (
    <View style={{ gap: space['1'] }}>
      {paired ? (
        <>
          <Checkbox
            testID={`${testID}-pair`}
            checked
            label={t('import:review.linked.transfer_pair_confirm')}
            onChange={() => env.ctrl.patch(row, { matched_transaction_id: null })}
          />
          {summary !== null ? (
            <Text variant="micro" tone="secondary" testID={`${testID}-pair-summary`}>
              {summary}
            </Text>
          ) : null}
          <Text variant="micro" tone="muted">
            {t('import:review.linked.transfer_pair_hint')}
          </Text>
        </>
      ) : null}

      {/* A candidate was found but is not linked: the box stays, unchecked, so pairing is
          one press away — and several candidates add the explicit "pick one" button. */}
      {!paired && candidate ? (
        <>
          <Checkbox
            testID={`${testID}-pair`}
            checked={false}
            label={t('import:review.linked.transfer_pair_confirm')}
            onChange={() => setPickerOpen(true)}
          />
          {multi ? (
            <Button
              testID={`${testID}-pick-one`}
              size="sm"
              variant="secondary"
              label={t('import:review.linked.transfer_pick_single')}
              onPress={() => setPickerOpen(true)}
            />
          ) : null}
        </>
      ) : null}

      {!paired ? (
        <>
          <SourcePicker
            testID={`${testID}-counterpart`}
            sources={env.sources}
            value={row.counterpart_source_id}
            disabled={sourceDisabled}
            label={t('import:review.linked.counterpart_source_label')}
            lang={env.lang}
            // The batch's own account is this row's account; the counterparty is another one.
            filter={(s) => s.id !== env.batch.source_id}
            onChange={(next) =>
              env.ctrl.patch(row, { counterpart_source_id: next, counterparty: null })
            }
          />
          <TextField
            testID={`${testID}-counterparty`}
            label={t('import:review.linked.counterpart_text_label')}
            value={text}
            disabled={textDisabled}
            maxLength={COUNTERPARTY_MAX}
            onChangeText={(next) => {
              setText(next);
              if (timer.current) clearTimeout(timer.current);
              timer.current = setTimeout(() => commitText(next), CELL_DEBOUNCE_MS);
            }}
            onBlur={() => {
              if (timer.current) clearTimeout(timer.current);
              commitText(text);
            }}
          />
        </>
      ) : null}

      <SegmentedControl<TransferRole>
        testID={`${testID}-role`}
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
    </View>
  );
}
