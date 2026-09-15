/**
 * The account chooser mockups 04 and 05 draw: a `ListRow`-shaped trigger — round type
 * icon, name, 「储蓄 · CNY」, the balance on the right, a chevron — instead of the plain
 * `Select` box the phase-5 form used.
 *
 * Only the trigger changes: the options are the same accounts `SourcePicker` offers
 * (`selectableSources`, so an archived account still only appears while it is the one this
 * entry already sits on) and they keep the `<id>-trigger` / `<id>-option-<uuid>` test ids
 * the behaviour tests address.
 */
import React from 'react';
import { ScrollView, type StyleProp, StyleSheet, View, type ViewStyle } from 'react-native';
import { useTranslation } from 'react-i18next';

import type { FinanceSource, Uuid } from '@/api/types';
import { type Lang, useLang } from '@/i18n';
import { formatMoney } from '@/i18n/format';
import { space } from '@/theme/tokens';
import { useColors } from '@/theme/ThemeProvider';
import { useIsWide } from '@/theme/useBreakpoint';
import { ListRow, Popover, Sheet, SourceTypeIcon, Text, selectableSources } from '@/ui';

import { FieldLabel, RowField } from './parts';

export interface SourceFieldProps {
  sources: readonly FinanceSource[];
  value: Uuid | null;
  onChange(next: Uuid | null): void;
  /** Extra restriction, e.g. "credit cards only" for a card repayment (04 §4.6.4). */
  filter?(source: FinanceSource): boolean;
  /** Keeps this archived account selectable (edit mode only, 04 §4.7). */
  allowArchivedId?: Uuid | null;
  lang?: Lang;
  label: string;
  /** Sits to the right of the label — the 「不在应用里」 toggle of mockup 05. */
  labelRight?: React.ReactNode;
  hint?: string | null;
  error?: string | null;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  testID: string;
}

/** 「储蓄 · CNY」 — the type and currency line under an account's name. */
function subtitleOf(source: FinanceSource, t: (key: string) => string): string {
  return `${t(`source:type.${source.type}`)} · ${source.default_currency}`;
}

export function SourceField({
  sources,
  value,
  onChange,
  filter,
  allowArchivedId,
  lang,
  label,
  labelRight,
  hint,
  error,
  disabled = false,
  style,
  testID,
}: SourceFieldProps): React.JSX.Element {
  const { t } = useTranslation();
  const activeLang = useLang();
  const l = lang ?? activeLang;
  const wide = useIsWide();
  const colors = useColors();
  const [open, setOpen] = React.useState(false);
  const anchorRef = React.useRef<View>(null);

  const options = selectableSources(sources, filter, allowArchivedId);
  const current = value === null ? undefined : sources.find((s) => s.id === value);
  const hasError = typeof error === 'string' && error.length > 0;

  function pick(id: Uuid): void {
    setOpen(false);
    onChange(id);
  }

  const list = (
    <ScrollView style={styles.list} keyboardShouldPersistTaps="handled">
      {options.length === 0 ? (
        <Text variant="body" tone="muted" style={styles.empty}>
          {t('common:status.none')}
        </Text>
      ) : null}
      {options.map((source) => (
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
          amount={formatMoney(source.balance, source.default_currency, l)}
          amountTone="secondary"
          selected={source.id === value}
          onPress={() => pick(source.id)}
        />
      ))}
    </ScrollView>
  );

  return (
    <View style={[styles.wrap, style]}>
      <FieldLabel label={label} right={labelRight} />
      <View ref={anchorRef} style={styles.anchor}>
        <RowField
          testID={`${testID}-trigger`}
          iconNode={
            current ? <SourceTypeIcon type={current.type} size={wide ? 36 : 34} /> : undefined
          }
          icon={current ? undefined : 'wallet'}
          value={current?.name ?? label}
          valueTone={current ? 'primary' : 'muted'}
          hint={current ? subtitleOf(current, t) : undefined}
          amount={
            current ? formatMoney(current.balance, current.default_currency, l) : undefined
          }
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
