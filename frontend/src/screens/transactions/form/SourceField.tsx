/**
 * The account chooser mockups 04 and 05 draw: a `ListRow`-shaped trigger — round type
 * icon, name, 「储蓄 · CNY」, the balance on the right, a chevron — instead of the plain
 * `Select` box the phase-5 form used.
 *
 * Only the trigger changes: the options are the same accounts `SourcePicker` offers
 * (`selectableSources`, so an archived account still only appears while it is the one this
 * entry already sits on) and they keep the `<id>-trigger` / `<id>-option-<uuid>` test ids
 * the behaviour tests address. As in `SourcePicker`, the list splits into 「我的」 and
 * 「成员共享的」 once a member has shared an account in, and someone else's account shows no
 * balance — the server does not send one (decision §14.62).
 */
import React from 'react';
import { ScrollView, type StyleProp, StyleSheet, View, type ViewStyle } from 'react-native';
import { useTranslation } from 'react-i18next';

import type { LedgerSource, Uuid } from '@/api/types';
import { space } from '@/theme/tokens';
import { useColors } from '@/theme/ThemeProvider';
import { useIsWide } from '@/theme/useBreakpoint';
import {
  ListRow,
  Popover,
  Sheet,
  SourceGroupLabel,
  SourceTypeIcon,
  Text,
  groupSources,
  selectableSources,
  showsSourceGroups,
} from '@/ui';

import { useAmountText } from '../amount';
import { FieldLabel, RowField } from './parts';

export interface SourceFieldProps {
  sources: readonly LedgerSource[];
  value: Uuid | null;
  onChange(next: Uuid | null): void;
  /** Extra restriction, e.g. "credit cards only" for a card repayment (04 §4.6.4). */
  filter?(source: LedgerSource): boolean;
  /** Keeps this archived account selectable (edit mode only, 04 §4.7). */
  allowArchivedId?: Uuid | null;
  label: string;
  /** Sits to the right of the label — the 「不在应用里」 toggle of mockup 05. */
  labelRight?: React.ReactNode;
  hint?: string | null;
  error?: string | null;
  disabled?: boolean;
  /**
   * `'row'` is 屏幕稿 04 · 375's shape: the label lives *inside* the row (over the account
   * name) and the type / currency line moves under the balance, so the account and the date
   * make one flat two-line card. `'field'` (the default) is the labelled box of 屏幕稿 05.
   * Wide screens always get `'field'` — that is what 屏幕稿 04 · 1440 draws.
   */
  variant?: 'field' | 'row';
  style?: StyleProp<ViewStyle>;
  testID: string;
}

/** 「储蓄 · CNY」 — the type and currency line under an account's name. */
function subtitleOf(source: LedgerSource, t: (key: string) => string): string {
  return `${t(`source:type.${source.type}`)} · ${source.default_currency}`;
}

export function SourceField({
  sources,
  value,
  onChange,
  filter,
  allowArchivedId,
  label,
  labelRight,
  hint,
  error,
  disabled = false,
  variant = 'field',
  style,
  testID,
}: SourceFieldProps): React.JSX.Element {
  const { t } = useTranslation();
  const wide = useIsWide();
  const colors = useColors();
  // 屏幕稿 04 / 05 write the ledger-currency balance bare and a foreign one with its
  // symbol — 「12,480.35」 next to 「S$4,120.80」 (§14.59a).
  const money = useAmountText();
  const [open, setOpen] = React.useState(false);
  const anchorRef = React.useRef<View>(null);

  const groups = groupSources(selectableSources(sources, filter, allowArchivedId));
  const titled = showsSourceGroups(groups);
  const current = value === null ? undefined : sources.find((s) => s.id === value);
  const hasError = typeof error === 'string' && error.length > 0;

  function pick(id: Uuid): void {
    setOpen(false);
    onChange(id);
  }

  const list = (
    <ScrollView style={styles.list} keyboardShouldPersistTaps="handled">
      {groups.length === 0 ? (
        <Text variant="body" tone="muted" style={styles.empty}>
          {t('common:status.none')}
        </Text>
      ) : null}
      {groups.map((group) => (
        <React.Fragment key={group.key}>
          {titled ? (
            <SourceGroupLabel group={group.key} testID={`${testID}-group-${group.key}`} />
          ) : null}
          {group.sources.map((source) => (
            <ListRow
              key={source.id}
              testID={`${testID}-option-${source.id}`}
              icon={<SourceTypeIcon type={source.type} size={34} />}
              title={source.name}
              subtitle={
                source.archived
                  ? `${subtitleOf(source, t)} · ${t('common:status.archived')}`
                  : subtitleOf(source, t)
              }
              amount={
                source.balance === null ? undefined : money(source.balance, source.default_currency)
              }
              amountTone="secondary"
              selected={source.id === value}
              onPress={() => pick(source.id)}
            />
          ))}
        </React.Fragment>
      ))}
    </ScrollView>
  );

  const inRow = variant === 'row' && !wide;

  return (
    <View style={[styles.wrap, style]}>
      {inRow ? null : <FieldLabel label={label} right={labelRight} />}
      <View ref={anchorRef} style={styles.anchor}>
        <RowField
          testID={`${testID}-trigger`}
          iconNode={
            current ? <SourceTypeIcon type={current.type} size={wide ? 36 : 34} /> : undefined
          }
          icon={current ? undefined : 'wallet'}
          label={inRow ? label : undefined}
          value={current?.name ?? label}
          valueTone={current ? 'primary' : 'muted'}
          hint={inRow || !current ? undefined : subtitleOf(current, t)}
          amount={
            current && current.balance !== null
              ? money(current.balance, current.default_currency)
              : undefined
          }
          amountSub={inRow && current ? subtitleOf(current, t) : undefined}
          filled={!inRow}
          onPress={() => setOpen((v) => !v)}
          disabled={disabled}
          accessibilityLabel={label}
          style={
            hasError
              ? {
                  borderWidth: 1.5,
                  borderColor: colors['status.danger.fg'],
                  backgroundColor: colors['status.danger.bg'],
                }
              : null
          }
        />
        <Popover
          open={open && wide}
          onClose={() => setOpen(false)}
          anchorRef={anchorRef}
          closeLabel={t('common:button.close')}
          testID={testID}
        >
          {list}
        </Popover>
      </View>
      {hasError ? (
        <Text variant="caption" tone="danger" testID={`${testID}-error`}>
          {error}
        </Text>
      ) : hint !== undefined && hint !== null && hint !== '' ? (
        <Text variant="caption" tone="muted" testID={`${testID}-hint`}>
          {hint}
        </Text>
      ) : null}
      {!wide ? (
        <Sheet
          open={open}
          onClose={() => setOpen(false)}
          title={label}
          closeLabel={t('common:button.close')}
          testID={`${testID}-sheet`}
        >
          {list}
        </Sheet>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignSelf: 'stretch', gap: space['1'], minWidth: 0 },
  anchor: { position: 'relative' },
  list: { maxHeight: 360 },
  empty: { padding: space['3'] + 2 },
});
