/**
 * "Pick a transaction" overlay, shared by the refund form (the original expense, 04 §4.6.3)
 * and by the transaction detail page (the opposite leg of a transfer, 04 §4.7).
 *
 * Mockup 06 draws it as a centred dialog on 1440 and a full-height sheet on 375: a title
 * row with ×, then search / account / date range, then the 「默认条件」 chip row that says
 * out loud which conditions were prefilled and lets the removable ones be clicked away,
 * then the candidates.
 *
 * Whatever the caller declares in `fixed` is **not** negotiable: it goes into every request
 * and is rendered as a static label, not as a removable chip (decision §14.52 B11 — a
 * refund can only ever point at an expense). `confirm` adds mockup 06's two-step footer
 * (「不关联」 / 「用这一笔」); without it a row press picks straight away.
 */
import React from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import type { Transaction, TransactionListParams } from '@/api/types';
import { useLang } from '@/i18n';
import { formatDate } from '@/i18n/format';
import { categoryName } from '@/i18n/category';
import { useCategories, useLedgerSources, useTransactions } from '@/queries';
import { useLedgerContext } from '@/store';
import { radius, space } from '@/theme/tokens';
import { useTheme } from '@/theme/ThemeProvider';
import { useIsWide } from '@/theme/useBreakpoint';
import { Icon, Sheet, Text, Skeleton, raisedShadow } from '@/ui';

import { useAmountText } from './amount';
import {
  PickerFilters,
  PickerFooter,
  type PickerFilterValues,
} from './PickerChrome';

/** How many candidates one page of the picker shows. */
export const PICKER_PAGE_SIZE = 20;

/** The search box reaches the request this long after the last keystroke (04 §4.5). */
export const PICKER_Q_DEBOUNCE_MS = 300;

export interface TransactionPickerProps {
  open: boolean;
  onClose(): void;
  onSelect(tx: Transaction): void;
  /** Always sent, never editable, rendered as static labels. */
  fixed: Partial<TransactionListParams>;
  /** Prefilled but editable conditions. */
  initial?: Partial<TransactionListParams>;
  /** Replace the default row body (date · merchant · category · amount). */
  renderRow?(tx: Transaction, selected: boolean): React.ReactNode;
  /** A table head above the rows — mockup 06's 日期 / 商户 / 分类 / 原支出 / 已退 / 可退. */
  tableHeader?: React.ReactNode;
  /** Client-side narrowing the list endpoint cannot express (e.g. `refundable > 0`). */
  filterRows?(tx: Transaction): boolean;
  emptyText?: string;
  title: string;
  /** Extra controls for the condition row — the caller owns their state. */
  toolbar?: React.ReactNode;
  /** Mockup 06's two-step footer: a row is chosen first, 「用这一笔」 confirms it. */
  confirm?: boolean;
  confirmLabel?: string;
  /** The row already linked, shown as chosen when the dialog opens. */
  selectedId?: string | null;
  /** 「不关联」 — offered next to the confirm button. */
  onClear?(): void;
  clearLabel?: string;
  /** The grey sentence in the footer. */
  footerNote?: string;
  /** 「已选：京东订单 · 可退 199.00」 — how the footer names the chosen row. */
  rowSummary?(tx: Transaction): string;
  testID?: string;
}

function seed(initial: Partial<TransactionListParams> | undefined): PickerFilterValues {
  return {
    q: initial?.q ?? '',
    source_id: initial?.source_id?.[0] ?? null,
    from: initial?.from ?? '',
    to: initial?.to ?? '',
  };
}

export function TransactionPicker({
  open,
  onClose,
  onSelect,
  fixed,
  initial,
  renderRow,
  tableHeader,
  filterRows,
  emptyText,
  title,
  toolbar,
  confirm = false,
  confirmLabel,
  selectedId = null,
  onClear,
  clearLabel,
  footerNote,
  rowSummary,
  testID,
}: TransactionPickerProps): React.JSX.Element | null {
  const { t } = useTranslation();
  const lang = useLang();
  const { colors, scheme } = useTheme();
  const wide = useIsWide();
  const { ledgerId } = useLedgerContext();
  const { index } = useCategories();
  // 屏幕稿 06's candidate table writes every figure bare (§14.59a).
  const money = useAmountText();
  // The picker stays mounted (rendering nothing) next to the form that owns it, so both
  // queries wait for it to actually open — otherwise merely showing the refund tab would
  // fetch the accounts a second time, under a key the form does not share.
  const sources = useLedgerSources(open ? ledgerId : undefined);
  const id = testID ?? 'tx-picker';

  const [filters, setFilters] = React.useState<PickerFilterValues>(() => seed(initial));
  // What the request actually carries: typing 「京东」 is three keystrokes and must not be
  // three list requests, so the box runs ahead of the query by `PICKER_Q_DEBOUNCE_MS`.
  const [searchedQ, setSearchedQ] = React.useState<string>(() => seed(initial).q);
  const [chosen, setChosen] = React.useState<Transaction | null>(null);

  React.useEffect(() => {
    if (filters.q === searchedQ) return;
    const timer = setTimeout(() => setSearchedQ(filters.q), PICKER_Q_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [filters.q, searchedQ]);

  // Re-opening the picker starts from the caller's prefill again, not from whatever the
  // user narrowed it to last time — the pending keystroke included.
  const wasOpen = React.useRef(open);
  React.useEffect(() => {
    if (open && !wasOpen.current) {
      const fresh = seed(initial);
      setFilters(fresh);
      setSearchedQ(fresh.q);
      setChosen(null);
    }
    wasOpen.current = open;
    // `initial` is a fresh object on every render; the open transition is the trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const params: TransactionListParams = {
    ...(searchedQ.trim() === '' ? {} : { q: searchedQ.trim() }),
    ...(filters.source_id ? { source_id: [filters.source_id] } : {}),
    ...(filters.from === '' ? {} : { from: filters.from }),
    ...(filters.to === '' ? {} : { to: filters.to }),
    ...fixed,
    limit: PICKER_PAGE_SIZE,
  };

  const list = useTransactions(open ? ledgerId : undefined, params);
  const rows = (list.data?.items ?? []).filter((tx) => (filterRows ? filterRows(tx) : true));
  const chosenId = chosen?.id ?? selectedId;

  function pressRow(tx: Transaction): void {
    if (confirm) {
      setChosen(tx);
      return;
    }
    onSelect(tx);
    onClose();
  }

  function defaultRow(tx: Transaction): React.ReactNode {
    const category = tx.category_l1 === null ? null : index?.byCode[tx.category_l1];
    return (
      <View style={styles.rowBody}>
        <Text variant="body" mono>
          {formatDate(tx.occurred_at)}
        </Text>
        <View style={styles.rowMain}>
          <Text variant="body" numberOfLines={1}>
            {tx.merchant ?? tx.counterparty ?? tx.note ?? ''}
          </Text>
          {category ? (
            <Text variant="caption" tone="muted" numberOfLines={1}>
              {categoryName(category, lang)}
            </Text>
          ) : null}
        </View>
        <Text variant="body" mono>
          {money(tx.amount, tx.currency)}
        </Text>
      </View>
    );
  }

  const filterBar = (
    <PickerFilters
      id={id}
      wide={wide}
      lang={lang}
      filters={filters}
      onChange={setFilters}
      sources={sources.data?.items ?? []}
      fixed={fixed}
      toolbar={toolbar}
    />
  );

  const body = (
    <View
      style={[styles.body, { paddingHorizontal: wide ? space['5'] : 0 }]}
      testID={`${id}-body`}
    >
      {filterBar}
      {tableHeader}
      {list.isPending ? (
        <Skeleton variant="table" rows={3} testID={`${id}-loading`} />
      ) : rows.length === 0 ? (
        <Text variant="body" tone="muted" testID={`${id}-empty`}>
          {emptyText ?? t('transaction:picker.empty')}
        </Text>
      ) : (
        <ScrollView style={styles.list} keyboardShouldPersistTaps="handled">
          {rows.map((tx) => {
            const selected = tx.id === chosenId;
            return (
              <Pressable
                key={tx.id}
                accessibilityRole="menuitem"
                accessibilityState={{ selected }}
                accessibilityLabel={tx.merchant ?? tx.note ?? tx.occurred_at}
                testID={`${id}-row-${tx.id}`}
                onPress={() => pressRow(tx)}
                style={({ pressed }) => [
                  styles.row,
                  {
                    borderColor: colors['border.default'],
                    borderRadius: wide ? 0 : radius.md,
                    backgroundColor: selected
                      ? colors['kind.refund.subtle']
                      : pressed
                        ? colors['bg.hover']
                        : 'transparent',
                  },
                ]}
              >
                {renderRow ? renderRow(tx, selected) : defaultRow(tx)}
              </Pressable>
            );
          })}
        </ScrollView>
      )}
    </View>
  );

  const footer = confirm ? (
    <PickerFooter
      id={id}
      wide={wide}
      note={
        chosen && rowSummary
          ? t('transaction:form.picker_selected', { summary: rowSummary(chosen) })
          : (footerNote ?? '')
      }
      confirmLabel={confirmLabel ?? t('common:button.confirm')}
      confirmDisabled={chosen === null}
      onConfirm={() => {
        if (!chosen) return;
        onSelect(chosen);
        onClose();
      }}
      clearLabel={clearLabel}
      onClear={
        onClear
          ? () => {
              onClear();
              onClose();
            }
          : undefined
      }
    />
  ) : null;

  if (!open) return null;

  if (!wide) {
    return (
      <Sheet
        open={open}
        onClose={onClose}
        title={title}
        closeLabel={t('common:button.close')}
        testID={id}
      >
        {body}
        {footer}
      </Sheet>
    );
  }

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose} testID={id}>
      <View style={styles.modalRoot}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('common:button.close')}
          onPress={onClose}
          testID={`${id}-backdrop`}
          style={[styles.backdrop, { backgroundColor: colors['fg.primary'], opacity: 0.35 }]}
        />
        <View
          style={[
            styles.dialog,
            raisedShadow(colors, scheme),
            { backgroundColor: colors['bg.raised'] },
          ]}
        >
          <View style={[styles.header, { borderBottomColor: colors['border.default'] }]}>
            <Text variant="heading" accessibilityRole="header" style={styles.grow}>
              {title}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('common:button.close')}
              onPress={onClose}
              testID={`${id}-close`}
              hitSlop={space['3']}
              style={[styles.close, { backgroundColor: colors['bg.subtle'] }]}
            >
              <Icon name="x" size={18} color={colors['fg.secondary']} />
            </Pressable>
          </View>
          {body}
          {footer}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  body: { gap: space['3'], alignSelf: 'stretch' },
  grow: { flex: 1, minWidth: 0 },
  list: { maxHeight: 360 },
  // 04 §6.6: no touch target smaller than 44×44.
  row: {
    paddingVertical: space['2'] + 2,
    paddingHorizontal: space['2'],
    borderBottomWidth: 1,
    minHeight: 44,
    justifyContent: 'center',
  },
  rowBody: { flexDirection: 'row', alignItems: 'center', gap: space['3'] },
  rowMain: { flex: 1, gap: 2 },
  modalRoot: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space['4'] },
  backdrop: { ...StyleSheet.absoluteFillObject },
  dialog: {
    width: '100%',
    maxWidth: 980,
    borderRadius: radius.lg,
    paddingBottom: space['2'],
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space['3'],
    paddingHorizontal: space['5'],
    paddingVertical: space['4'],
    borderBottomWidth: 1,
  },
  close: {
    width: 34,
    height: 34,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
