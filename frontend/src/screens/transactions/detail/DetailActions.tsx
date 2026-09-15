/**
 * The detail page's operations (04 §4.7, decision §14.52 A8, 屏幕稿 07 / 08).
 *
 * The screens decide *what* is offered — 编辑 / 复制一笔 / 登记退款（只有支出）/ 拆开（两腿）/
 * 关联为转账对腿（单腿）/ 删除 — and this decides where they live. Wide: one right-aligned
 * row on the headline card's top line, tinted by rank. Narrow: a bar pinned under the page
 * with 「修改」, which opens the mockup's sheet — icon well, label, one line of explanation,
 * chevron. There is deliberately no 「分享」(decision §14.52 A8).
 *
 * The sheet closes *before* the action runs: 删除 and 拆开 both raise a confirm dialog, and
 * a dialog stacked on an open sheet would be a modal inside a modal.
 */
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { type ColorToken, radius, space } from '@/theme/tokens';
import { useColors, useTheme } from '@/theme/ThemeProvider';
import { useIsWide } from '@/theme/useBreakpoint';
import { Icon, type IconName, Sheet, Text, raisedShadow } from '@/ui';

import { ActionButton, type ActionTone } from './ActionButton';

export interface DetailAction {
  /** Stable key, also the button's `testID` suffix. */
  key: string;
  label: string;
  icon?: IconName;
  tone?: ActionTone;
  /** The sheet's second line: what the action will do. */
  hint?: string;
  onPress(): void;
  disabled?: boolean;
  loading?: boolean;
}

export interface DetailActionsProps {
  actions: readonly DetailAction[];
  /** 「修改这笔支出」 — the sheet's own title. */
  sheetTitle: string;
  testID?: string;
}

/** The icon well in front of a sheet row, tinted like the action's own button. */
const WELL_TONE: Readonly<Record<ActionTone, { bg: ColorToken; fg: ColorToken }>> = {
  neutral: { bg: 'accent.subtle', fg: 'accent.solid' },
  primary: { bg: 'accent.subtle', fg: 'accent.solid' },
  refund: { bg: 'status.warning.bg', fg: 'status.warning.fg' },
  info: { bg: 'status.info.bg', fg: 'status.info.fg' },
  danger: { bg: 'status.danger.bg', fg: 'status.danger.fg' },
};

function SheetRow({
  action,
  onRun,
  testID,
}: {
  action: DetailAction;
  onRun(action: DetailAction): void;
  testID: string;
}): React.JSX.Element {
  const colors = useColors();
  const tone = action.tone ?? 'neutral';
  const well = WELL_TONE[tone];
  const danger = tone === 'danger';
  return (
    // touch-target-exempt: `styles.sheetRow` is 56 tall and stretches the sheet's width.
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={action.label}
      accessibilityState={{ disabled: action.disabled === true }}
      disabled={action.disabled}
      onPress={() => onRun(action)}
      testID={testID}
      style={({ pressed }) => [
        styles.sheetRow,
        { backgroundColor: pressed ? colors['bg.hover'] : 'transparent' },
        tone === 'primary' ? { backgroundColor: colors['bg.selected'] } : null,
      ]}
    >
      <View
        style={[styles.well, { backgroundColor: colors[well.bg] }]}
        accessibilityElementsHidden
        importantForAccessibility="no"
      >
        {action.icon ? (
          <Icon name={action.icon} size={18} color={colors[well.fg]} />
        ) : null}
      </View>
      <View style={styles.sheetText}>
        <Text
          variant="subheading"
          weight={tone === 'primary' ? 600 : 500}
          tone={danger ? 'danger' : 'primary'}
          numberOfLines={1}
        >
          {action.label}
        </Text>
        {action.hint !== undefined ? (
          <Text variant="caption" tone="muted" numberOfLines={2}>
            {action.hint}
          </Text>
        ) : null}
      </View>
      {danger ? null : (
        <Icon name="chevron-right" size={18} color={colors['fg.muted']} />
      )}
    </Pressable>
  );
}

export function DetailActions({
  actions,
  sheetTitle,
  testID,
}: DetailActionsProps): React.JSX.Element {
  const { t } = useTranslation();
  const { colors, scheme } = useTheme();
  const wide = useIsWide();
  const [open, setOpen] = React.useState(false);
  const id = testID ?? 'detail-actions';

  const run = React.useCallback((action: DetailAction): void => {
    setOpen(false);
    action.onPress();
  }, []);

  if (wide) {
    return (
      <View style={styles.row} testID={id}>
        {actions.map((a) => (
          <ActionButton
            key={a.key}
            testID={`${id}-${a.key}`}
            label={a.label}
            icon={a.icon}
            tone={a.tone}
            onPress={a.onPress}
            disabled={a.disabled}
            loading={a.loading}
          />
        ))}
      </View>
    );
  }

  const busy = actions.some((a) => a.loading === true);

  return (
    <View
      testID={id}
      style={[
        styles.bar,
        raisedShadow(colors, scheme),
        { backgroundColor: colors['bg.raised'] },
      ]}
    >
      {/* touch-target-exempt: `styles.barButton` is 48 tall and full width. */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('transaction:detail.actions_open')}
        accessibilityState={{ busy }}
        onPress={() => setOpen(true)}
        testID={`${id}-open`}
        style={({ pressed }) => [
          styles.barButton,
          { backgroundColor: colors[pressed ? 'bg.hover' : 'bg.subtle'] },
        ]}
      >
        <Icon name="pencil" size={18} color={colors['fg.primary']} />
        <Text variant="subheading" weight={600}>
          {t('transaction:detail.actions_open')}
        </Text>
      </Pressable>

      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={sheetTitle}
        closeLabel={t('common:button.cancel')}
        testID={`${id}-sheet`}
      >
        <View style={styles.sheetList}>
          {actions.map((a, i) => (
            <View key={a.key}>
              {i > 0 ? (
                <View style={[styles.divider, { backgroundColor: colors['border.default'] }]} />
              ) : null}
              <SheetRow action={a} onRun={run} testID={`${id}-${a.key}`} />
            </View>
          ))}
        </View>
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    gap: space['2'] + 2,
    flexShrink: 0,
  },
  bar: {
    alignSelf: 'stretch',
    paddingTop: space['3'],
    paddingHorizontal: space['4'],
    paddingBottom: space['4'],
    marginHorizontal: -space['4'],
  },
  barButton: {
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space['2'],
    borderRadius: radius.md,
  },
  sheetList: { alignSelf: 'stretch', paddingBottom: space['2'] },
  sheetRow: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space['3'],
    paddingVertical: space['2'],
    paddingHorizontal: space['2'],
    borderRadius: radius.md,
  },
  well: { width: 32, height: 32, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  sheetText: { flex: 1, minWidth: 0, gap: 2 },
  divider: { height: 1, marginHorizontal: space['2'] },
});
