/**
 * The 「账户 · 对手」 column (04 §4.11.2, §4.11.3; 屏幕稿 03).
 *
 * One file is one target account (decision §5, §14.52 A5), so every ordinary row simply
 * names it, greyed out — it is not editable and never was. Only a transfer row picks a
 * *counterparty*, and that is what this cell offers: the account picker and the free-text
 * box, mutually exclusive (decision §14.53c). The pairing itself — the checkbox, the
 * candidate summary, the "pick one" button, the direction and subtype switches — is the
 * band under the row, `LinkPanel.tsx`.
 *
 * The one thing to keep straight: **pairing has a single carrier**, `matched_transaction_id`
 * (decision §14.53b). Nothing here writes it; the panel does, and the candidate list behind
 * the "pick one" button is not stored anywhere — it is a plain transaction-list query.
 *
 * When no opposite leg was found the server does not guess (decision §14.53c): the account
 * picker and the free-text field start empty and are mutually exclusive — filling one
 * greys out and clears the other. Both collapse entirely once a `matched_transaction_id` is
 * set, because an existing leg makes a second one wrong; the cell then falls back to naming
 * this row's own account, and the paired leg is named once — by the strip underneath, which
 * is also the only place that fetches it.
 */
import React from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';

import type { ImportRow, LedgerSource, Transaction } from '@/api/types';
import { formatMoney, parseLocalDate } from '@/i18n/format';
import { space } from '@/theme/tokens';
import {
  Text,
  groupSources,
  isSourceGroupTitle,
  selectableSources,
  showsSourceGroups,
  sourceGroupOptions,
} from '@/ui';

import { type CellOption, CellTextInput, CellSelect } from './CellControls';
import type { CellProps } from './ReviewRow';
import { CELL_DEBOUNCE_MS } from './ReviewRow';

/** 04 §4.11.3 / decision §14.34: candidates sit within ±3 days of the row. */
export const PAIR_WINDOW_DAYS = 3;

/** 04 §4.11.3 / decision §1.1: the refund origin picker looks back 90 days. */
export const REFUND_LOOKBACK_DAYS = 90;

/** `counterparty` is capped at 100 characters (03 §5.41). */
export const COUNTERPARTY_MAX = 100;

/** The option that puts the counterparty account back to "none". */
const NO_SOURCE = '__none__';

/** `iso` moved by whole days, staying on the local calendar. */
export function shiftIso(iso: string, days: number): string {
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

export function summarize(
  tx: Transaction | undefined,
  sourceName: string | undefined,
  lang: 'zh' | 'en',
): string | null {
  if (!tx) return null;
  const money = formatMoney(tx.amount, tx.currency, lang, { signDisplay: 'always' });
  // A transfer leg has no merchant (decision §14.52 B16), so it is named by its account.
  return [tx.merchant ?? sourceName, tx.occurred_at, money].filter(Boolean).join(' · ');
}

/**
 * The cell itself: the batch's target account for every ordinary row, the counterparty
 * controls for an unpaired transfer, the paired leg's account for a paired one.
 */
export function LinkCell({ row, env, testID }: CellProps): React.JSX.Element {
  const { t } = useTranslation();
  const [text, setText] = React.useState(row.counterparty ?? '');
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    setText(row.counterparty ?? '');
  }, [row.counterparty]);
  React.useEffect(() => () => (timer.current ? clearTimeout(timer.current) : undefined), []);

  // Every non-transfer row books onto the batch's own account, and cannot be moved off it.
  // A paired transfer is the same: its leg is settled, so the cell names this row's own
  // account and the *other* leg is named by the strip underneath (`LinkPanel`), which is
  // the one place that fetches the matched transaction.
  if (row.kind !== 'transfer' || row.matched_transaction_id !== null) {
    return (
      <Text variant="body" tone="muted" numberOfLines={1} testID={testID}>
        {env.batch.source_name}
      </Text>
    );
  }

  const sourceDisabled = text.trim() !== '';
  const textDisabled = row.counterpart_source_id !== null;

  // The batch's own account is this row's account; the counterparty is another one, split
  // into 「我的」 and 「成员共享的」 the same way `SourceField` does (decision §14.62). Someone
  // else's account shows no balance — the server sends none.
  const groups = groupSources(selectableSources(env.sources, (s) => s.id !== env.batch.source_id));
  const titled = showsSourceGroups(groups);
  const toOption = (s: LedgerSource): { value: string; label: string; hint: string } => {
    const parts = [s.default_currency];
    if (s.balance !== null) parts.push(formatMoney(s.balance, s.default_currency, env.lang));
    return { value: s.id, label: s.name, hint: parts.join(' · ') };
  };
  // Group titles ride along as options (`sourceGroupOptions`); the cell draws them as
  // small headers rather than greyed-out rows, like `SourceField`'s list does.
  const counterpartOptions: CellOption[] = [
    ...sourceGroupOptions(groups, titled, toOption, (key) =>
      t(`transaction:picker.group_${key}`),
    ).map((option) => (isSourceGroupTitle(option) ? { ...option, heading: true } : option)),
    { value: NO_SOURCE, label: t('common:status.none') },
  ];

  function commitText(next: string): void {
    // Mutually exclusive (decision §14.53c): typing a counterparty clears the account.
    env.ctrl.patch(row, {
      counterparty: next.trim() === '' ? null : next.trim(),
      counterpart_source_id: null,
    });
  }

  return (
    <View style={{ gap: space['1'], minWidth: 0 }}>
      <CellSelect
        testID={`${testID}-counterpart`}
        value={row.counterpart_source_id}
        options={counterpartOptions}
        placeholder={t('import:review.linked.counterpart_source_label')}
        label={t('import:review.linked.counterpart_source_label')}
        closeLabel={t('common:button.close')}
        disabled={sourceDisabled}
        onChange={(next) =>
          env.ctrl.patch(row, {
            counterpart_source_id: next === NO_SOURCE ? null : next,
            counterparty: null,
          })
        }
      />
      <CellTextInput
        testID={`${testID}-counterparty`}
        accessibilityLabel={t('import:review.linked.counterpart_text_label')}
        placeholder={t('import:review.linked.counterpart_text_label')}
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
    </View>
  );
}
