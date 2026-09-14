/**
 * "Pick a transaction" overlay, shared by the refund form (the original expense, 04 §4.6.3)
 * and by the transaction detail page (the opposite leg of a transfer, 04 §4.7).
 *
 * It reuses the list endpoint and a cut-down version of the list's own filters (search,
 * account, date range). Whatever the caller declares in `fixed` is **not** negotiable: it
 * goes into every request and is rendered as a static label, not as a removable chip
 * (decision §14.52 B11 — a refund can only ever point at an expense).
 */
import React from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import type { Transaction, TransactionListParams } from '@/api/types';
import { useLang } from '@/i18n';
import { formatDate, formatMoney } from '@/i18n/format';
import { categoryName } from '@/i18n/category';
import { useCategories, useSources, useTransactions } from '@/queries';
import { useLedgerContext } from '@/store';
import { radius, space } from '@/theme/tokens';
import { useColors } from '@/theme/ThemeProvider';
import { useIsWide } from '@/theme/useBreakpoint';
import { Badge, Card, DateField, Sheet, SourcePicker, Text, TextField, Skeleton } from '@/ui';

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
  renderRow?(tx: Transaction): React.ReactNode;
  /** Client-side narrowing the list endpoint cannot express (e.g. `refundable > 0`). */
  filterRows?(tx: Transaction): boolean;
  emptyText?: string;
  title: string;
  /** Extra controls for the filter bar — the caller owns their state. */
  toolbar?: React.ReactNode;
  testID?: string;
}

interface EditableFilters {
  q: string;
  source_id: string | null;
  from: string;
  to: string;
}

function seed(initial: Partial<TransactionListParams> | undefined): EditableFilters {
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
  filterRows,
  emptyText,
  title,
  toolbar,
  testID,
}: TransactionPickerProps): React.JSX.Element | null {
  const { t } = useTranslation();
  const lang = useLang();
  const colors = useColors();
  const wide = useIsWide();
  const { ledgerId } = useLedgerContext();
  const { index } = useCategories();
  // The picker stays mounted (rendering nothing) next to the form that owns it, so both
  // queries wait for it to actually open — otherwise merely showing the refund tab would
  // fetch the accounts a second time, under a key the form does not share.
  const sources = useSources(open ? ledgerId : undefined);
  const id = testID ?? 'tx-picker';

  const [filters, setFilters] = React.useState<EditableFilters>(() => seed(initial));
  // What the request actually carries: typing 「京东」 is three keystrokes and must not be
  // three list requests, so the box runs ahead of the query by `PICKER_Q_DEBOUNCE_MS`.
  const [searchedQ, setSearchedQ] = React.useState<string>(() => seed(initial).q);

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

  function defaultRow(tx: Transaction): React.ReactNode {
    const category = tx.category_l1 === null ? null : index?.byCode[tx.category_l1];
    return (
      <View style={styles.rowBody}>
        <Text variant="body" mono>
          {formatDate(tx.occurred_at, lang)}
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
          {formatMoney(tx.amount, tx.currency, lang)}
        </Text>
      </View>
    );
  }

  const fixedLabels: string[] = [];
  if (fixed.kind && fixed.kind.length > 0) {
    fixedLabels.push(
      t('transaction:picker.fixed_kind', {
        kinds: fixed.kind.map((k) => t(`transaction:kind.${k}`)).join(' / '),
      }),
    );
  }

  const body = (
    <View style={styles.body} testID={`${id}-body`}>
      {fixedLabels.length > 0 ? (
        <View style={styles.fixedRow}>
          {fixedLabels.map((label) => (
            <Badge key={label} label={label} tone="neutral" testID={`${id}-fixed`} />
          ))}
        </View>
      ) : null}

      <TextField
        testID={`${id}-search`}
        value={filters.q}
        onChangeText={(q) => setFilters((f) => ({ ...f, q }))}
        placeholder={t('transaction:picker.search_placeholder')}
        accessibilityLabel={t('transaction:picker.search_placeholder')}
      />
      <SourcePicker
        testID={`${id}-source`}
        sources={sources.data?.items ?? []}
        value={filters.source_id}
        onChange={(source_id) => setFilters((f) => ({ ...f, source_id }))}
        lang={lang}
      />
      <View style={styles.dateRow}>
        <DateField
          testID={`${id}-from`}
          label={t('transaction:picker.date_from')}
          value={filters.from}
          onChange={(from) => setFilters((f) => ({ ...f, from }))}
          style={styles.grow}
        />
        <DateField
          testID={`${id}-to`}
          label={t('transaction:picker.date_to')}
          value={filters.to}
          onChange={(to) => setFilters((f) => ({ ...f, to }))}
          style={styles.grow}
        />
      </View>
      {toolbar}

      {list.isPending ? (
        <Skeleton variant="table" rows={3} testID={`${id}-loading`} />
      ) : rows.length === 0 ? (
        <Text variant="body" tone="muted" testID={`${id}-empty`}>
          {emptyText ?? t('transaction:picker.empty')}
        </Text>
      ) : (
        <ScrollView style={styles.list} keyboardShouldPersistTaps="handled">
          {rows.map((tx) => (
            <Pressable
              key={tx.id}
              accessibilityRole="menuitem"
              accessibilityLabel={tx.merchant ?? tx.note ?? tx.occurred_at}
              testID={`${id}-row-${tx.id}`}
              onPress={() => {
                onSelect(tx);
                onClose();
              }}
              style={[styles.row, { borderColor: colors['border.default'] }]}
            >
              {renderRow ? renderRow(tx) : defaultRow(tx)}
            </Pressable>
          ))}
        </ScrollView>
      )}
    </View>
  );

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
        <Card variant="raised" style={styles.dialog}>
          <View style={styles.header}>
            <Text variant="heading" accessibilityRole="header">
              {title}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('common:button.close')}
              onPress={onClose}
              testID={`${id}-close`}
              hitSlop={space['3']}
            >
              <Text variant="body" tone="secondary">
                {t('common:button.close')}
              </Text>
            </Pressable>
          </View>
          {body}
        </Card>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  body: { gap: space['3'], alignSelf: 'stretch' },
  fixedRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space['2'] },
  dateRow: { flexDirection: 'row', gap: space['2'] },
  grow: { flex: 1 },
  list: { maxHeight: 360 },
  // 04 §6.6: no touch target smaller than 44×44.
  row: { paddingVertical: space['2'], borderBottomWidth: 1, minHeight: 44, justifyContent: 'center' },
  rowBody: { flexDirection: 'row', alignItems: 'center', gap: space['3'] },
  rowMain: { flex: 1, gap: 2 },
  modalRoot: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space['4'] },
  backdrop: { ...StyleSheet.absoluteFillObject },
  dialog: { width: '100%', maxWidth: 560, borderRadius: radius.lg, gap: space['3'] },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
});
