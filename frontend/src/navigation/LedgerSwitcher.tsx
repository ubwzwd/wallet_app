/**
 * The ledger switcher (04 §1.4, screens 01 and 13): every ledger the user belongs to, plus
 * the two ways to get another one. Picking a ledger keeps the page you are on — that is
 * `LedgerContext.switchTo` (04 §2.2, decision §14.66 d): the path stays and no history entry
 * is made, on a ledger page or off one alike, so the back button never walks ledgers.
 *
 * Two shells over one list of rows, because screen 01 draws two:
 *   wide   → `LedgerSwitcherPopover`, a small panel anchored under the sidebar's ledger
 *            card (屏幕 01 · 首页.dc.html:183)
 *   narrow → `LedgerSwitcher`, the shared bottom `Sheet`
 *
 * A row is a square letter tile, the ledger's name, its base currency and member count
 * beneath, and a tick on the current one; then "create a ledger", "join a ledger" and —
 * last — the current ledger's settings (§14.65 a, `/ledger`). There is no ledger-list page
 * to point at any more: this list is that page.
 *
 * Every row changes page, so every row asks a form's leave guard first (§14.65 g); the
 * wide panel's ledger rows go through the sidebar's `onPick`, which asks there.
 */
import React from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { usePathname, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import type { Ledger, Uuid } from '@/api/types';
import { type RouteHref, routes } from '@/domain/routes';
import { density, radius, space } from '@/theme/tokens';
import { useColors } from '@/theme/ThemeProvider';
import { useOptionalLedgerContext } from '@/store/LedgerContext';
import { Avatar, Divider, Icon, type IconName, Popover, Sheet, Text } from '@/ui';

import { useGuardedNavigate } from './leaveGuard';
import { ledgerSwitchTarget } from './ledgerRoute';

/**
 * What picking a ledger in either switcher does: nothing for the current one; otherwise ask
 * a dirty form first and `switchTo` it. Only a page naming one of the old ledger's records
 * actually navigates (to its list), and the leave guard is told which case it is.
 */
export function usePickLedger(): (id: Uuid) => void {
  const ledgerContext = useOptionalLedgerContext();
  const guarded = useGuardedNavigate();
  const pathname = usePathname();
  return (id) => {
    if (!ledgerContext || ledgerContext.ledgerId === id) return;
    const navigates = ledgerSwitchTarget(pathname) !== null;
    guarded(() => ledgerContext.switchTo(id), { navigates });
  };
}

export interface LedgerSwitcherProps {
  open: boolean;
  onClose(): void;
}

function LedgerRow({
  ledger,
  current,
  onPress,
}: {
  ledger: Ledger;
  current: boolean;
  onPress(): void;
}): React.JSX.Element {
  const colors = useColors();
  const { t } = useTranslation();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: current }}
      onPress={onPress}
      testID={`ledger-switcher-row-${ledger.id}`}
      style={({ pressed }) => [
        styles.row,
        {
          backgroundColor: current
            ? colors['bg.selected']
            : pressed
              ? colors['bg.hover']
              : 'transparent',
        },
      ]}
    >
      <Avatar name={ledger.name} size={26} shape="square" tone={current ? 'accent' : 'muted'} />
      <View style={styles.rowText}>
        <Text weight={current ? 600 : 500} style={styles.rowName} numberOfLines={1}>
          {ledger.name}
        </Text>
        <Text mono tone="muted" style={styles.rowMeta} numberOfLines={1}>
          {`${ledger.base_currency} · ${t('common:nav.member_count', { count: ledger.member_count })}`}
        </Text>
      </View>
      {current ? <Icon name="check" size={18} color={colors['accent.solid']} /> : null}
    </Pressable>
  );
}

function ActionRow({
  label,
  icon,
  onPress,
  testID,
}: {
  label: string;
  icon: IconName;
  onPress(): void;
  testID: string;
}): React.JSX.Element {
  const colors = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: pressed ? colors['bg.hover'] : 'transparent' },
      ]}
    >
      <Icon name={icon} size={18} color={colors['accent.solid']} />
      <Text weight={600} tone="accent" style={styles.rowName} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

/** The rows themselves — the same list whichever shell is around them. */
function SwitcherRows({
  ledgers,
  currentId,
  onPick,
  onNavigate,
  scroll,
}: {
  ledgers: readonly Ledger[];
  currentId: Uuid | null;
  onPick(id: Uuid): void;
  onNavigate(href: RouteHref): void;
  /** The sheet lets a long list scroll; the anchored panel is already capped by `Popover`. */
  scroll: boolean;
}): React.JSX.Element {
  const { t } = useTranslation();
  const rows = ledgers.map((ledger) => (
    <LedgerRow
      key={ledger.id}
      ledger={ledger}
      current={ledger.id === currentId}
      onPress={() => onPick(ledger.id)}
    />
  ));
  return (
    <>
      {scroll ? <ScrollView style={styles.list}>{rows}</ScrollView> : <View>{rows}</View>}
      <Divider style={styles.divider} />
      <ActionRow
        label={t('ledger:list.empty.create_button')}
        icon="plus"
        onPress={() => onNavigate(routes.ledgersNew())}
        testID="ledger-switcher-new"
      />
      <ActionRow
        label={t('ledger:list.empty.join_button')}
        icon="key-round"
        onPress={() => onNavigate(routes.ledgersJoin())}
        testID="ledger-switcher-join"
      />
      {currentId === null ? null : (
        <ActionRow
          label={t('common:nav.ledger_settings')}
          icon="settings"
          onPress={() => onNavigate(routes.ledgerSettings())}
          testID="ledger-switcher-settings"
        />
      )}
    </>
  );
}

/**
 * Narrow layouts: the shared bottom sheet, opened from the top bar's ledger pill. Picking a
 * ledger keeps the page, wherever the sheet was opened (`/settings` and `/ledgers*` too).
 */
export function LedgerSwitcher({ open, onClose }: LedgerSwitcherProps): React.JSX.Element {
  const { t } = useTranslation();
  const router = useRouter();
  const guarded = useGuardedNavigate();
  const ledgerContext = useOptionalLedgerContext();
  const pickLedger = usePickLedger();

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t('common:nav.switch_ledger')}
      closeLabel={t('common:button.close')}
      testID="ledger-switcher"
    >
      <SwitcherRows
        scroll
        ledgers={ledgerContext?.ledgers ?? []}
        currentId={ledgerContext?.ledgerId ?? null}
        onPick={(id) => {
          onClose();
          pickLedger(id);
        }}
        onNavigate={(href) => {
          onClose();
          guarded(() => router.navigate(href));
        }}
      />
    </Sheet>
  );
}

export interface LedgerSwitcherPopoverProps {
  open: boolean;
  onClose(): void;
  /** The sidebar's ledger card; the panel opens flush under it. */
  anchorRef: React.RefObject<View | null>;
  ledgers: readonly Ledger[];
  currentId: Uuid | null;
  onPick(id: Uuid): void;
}

/**
 * Wide layouts: mockup 01's small dropdown under the ledger card. The sidebar that owns it
 * hands in the list, the current id and what a pick does (`usePickLedger`).
 */
export function LedgerSwitcherPopover({
  open,
  onClose,
  anchorRef,
  ledgers,
  currentId,
  onPick,
}: LedgerSwitcherPopoverProps): React.JSX.Element | null {
  const { t } = useTranslation();
  const router = useRouter();
  const guarded = useGuardedNavigate();
  return (
    <Popover
      open={open}
      onClose={onClose}
      anchorRef={anchorRef}
      closeLabel={t('common:button.close')}
      testID="ledger-switcher"
      style={styles.panel}
    >
      <SwitcherRows
        scroll={false}
        ledgers={ledgers}
        currentId={currentId}
        onPick={onPick}
        onNavigate={(href) => {
          onClose();
          guarded(() => router.navigate(href));
        }}
      />
    </Popover>
  );
}

const styles = StyleSheet.create({
  list: { maxHeight: 320 },
  row: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: space['2'],
    paddingHorizontal: space['3'],
    borderRadius: 11,
  },
  rowText: { flex: 1, minWidth: 0 },
  // 屏幕 01 · 首页.dc.html:184-186: the overlay's rows are a step smaller than the card's.
  rowName: { fontSize: 14, lineHeight: 19 },
  rowMeta: { fontSize: 11, lineHeight: 15 },
  divider: { marginVertical: space['1'], marginHorizontal: density.rowInnerPadding },
  panel: { borderRadius: radius.md },
});
