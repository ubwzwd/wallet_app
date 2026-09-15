/**
 * `/ledgers` (04 §4.3, screen 13): every ledger the user belongs to, as a grid of cards —
 * there are only ever two or three of them, so a list row would be the wrong shape.
 *
 * Wide: a page header (title, the grey "switching takes every page with it" line, the two
 * actions) over three columns, the last cell of which is the dashed "new ledger" tile —
 * an empty slot is its own entry point. Narrow: the same cards stacked, with the two
 * actions moved to the foot of the page where a thumb is.
 *
 * With no ledgers at all the page is screen 15's onboarding instead (`NoLedgerGuide`).
 */
import React from 'react';
import { type LayoutChangeEvent, Pressable, StyleSheet, View } from 'react-native';
import { type Href, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { routes } from '@/domain/routes';
import { pickLandingLedger, useLastLedgerId } from '@/navigation';
import { useLedgers } from '@/queries';
import { useAuth } from '@/store';
import { radius, space } from '@/theme/tokens';
import { useColors } from '@/theme/ThemeProvider';
import { useIsWide } from '@/theme/useBreakpoint';
import { PREF_NAMES, getPrefSync } from '@/utils/prefs';
import { Button, EmptyState, Icon, Page, PageHeader, Skeleton, Text } from '@/ui';

import { LedgerCard } from './LedgerCard';
import { MAX_LEDGERS } from './ledgerLimits';
import { NoLedgerGuide } from './NoLedgerGuide';

export { MAX_LEDGERS };

/** Skeleton cards shown while `GET /ledgers` is in flight (04 §4.3). */
const SKELETON_CARDS = 3;

/** Screen 13's wide frame draws exactly three columns. */
const COLUMNS = 3;
const GRID_GAP = space['4'];

/** The dashed last cell of the wide grid. */
function NewLedgerTile({ onPress }: { onPress(): void }): React.JSX.Element {
  const colors = useColors();
  const { t } = useTranslation();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('ledger:list.new_card.title')}
      onPress={onPress}
      testID="ledgers-create-tile"
      style={({ pressed }) => [
        styles.tile,
        {
          backgroundColor: pressed ? colors['bg.hover'] : colors['bg.raised'],
          borderColor: colors['border.strong'],
        },
      ]}
    >
      <View style={[styles.tileGlyph, { backgroundColor: colors['accent.subtle'] }]}>
        <Icon name="plus" size={22} color={colors['accent.solid']} />
      </View>
      <Text variant="subheading" weight={600}>
        {t('ledger:list.new_card.title')}
      </Text>
      <Text variant="caption" tone="muted" style={styles.tileBody}>
        {t('ledger:list.new_card.body')}
      </Text>
    </Pressable>
  );
}

export default function LedgersScreen(): React.JSX.Element {
  const { t } = useTranslation();
  const router = useRouter();
  const wide = useIsWide();
  const query = useLedgers();
  const { user } = useAuth();
  // The card marked 「当前」 is the one `/` would open (screen 13). `useLastLedgerId` answers
  // one frame late, so where the preference can be read synchronously (web: localStorage) the
  // first frame reads it there, and where it cannot the badge is simply withheld until it
  // lands — 「当前」 must never appear on the first card and then jump to another one.
  const remembered = useLastLedgerId();
  const syncId = React.useMemo(() => getPrefSync(PREF_NAMES.lastLedgerId), []);
  const currentId = remembered === undefined ? syncId : remembered;
  const decided = remembered !== undefined || syncId !== null;

  const [gridWidth, setGridWidth] = React.useState(0);
  const onGridLayout = React.useCallback(
    (e: LayoutChangeEvent) => setGridWidth(e.nativeEvent.layout.width),
    [],
  );

  const goCreate = React.useCallback(() => router.push(routes.ledgersNew() as Href), [router]);
  const goJoin = React.useCallback(() => router.push(routes.ledgersJoin() as Href), [router]);
  const goProfile = React.useCallback(() => router.push(routes.settings() as Href), [router]);

  const items = query.data?.items ?? [];
  const atLimit = items.length >= MAX_LEDGERS;

  const header = wide ? (
    <PageHeader
      title={t('ledger:list.title')}
      meta={
        <Text variant="caption" tone="muted">
          {t('ledger:list.subtitle')}
        </Text>
      }
      actions={
        <>
          <Button
            testID="ledgers-join"
            label={t('ledger:list.empty.join_button')}
            icon="key-round"
            variant="secondary"
            onPress={goJoin}
          />
          <Button
            testID="ledgers-create"
            label={t('ledger:list.empty.create_button')}
            icon="plus"
            onPress={goCreate}
            disabled={atLimit}
          />
        </>
      }
      testID="ledgers-header"
    />
  ) : (
    <View style={styles.narrowHeader} testID="ledgers-header">
      <Text variant="title" accessibilityRole="header">
        {t('ledger:list.title')}
      </Text>
      <Text variant="body" tone="muted">
        {t('ledger:list.subtitle')}
      </Text>
    </View>
  );

  if (query.isPending) {
    return (
      <Page testID="ledgers-screen">
        {header}
        {Array.from({ length: SKELETON_CARDS }, (_, i) => (
          <Skeleton key={i} variant="card" testID={`ledger-skeleton-${i}`} />
        ))}
      </Page>
    );
  }

  if (query.isError) {
    return (
      <Page testID="ledgers-screen">
        {header}
        <EmptyState
          icon="alert-triangle"
          title={t('ledger:list.error_retry')}
          primaryAction={{ label: t('common:button.retry'), onPress: () => void query.refetch() }}
          testID="ledgers-error"
        />
      </Page>
    );
  }

  if (items.length === 0) {
    return (
      <Page testID="ledgers-screen" contentStyle={styles.guidePage}>
        <NoLedgerGuide
          email={user?.email ?? ''}
          onOpenProfile={goProfile}
          onCreate={goCreate}
          onJoin={goJoin}
        />
      </Page>
    );
  }

  const current = decided ? pickLandingLedger(items, currentId) : null;
  const cardWidth =
    wide && gridWidth > 0 ? Math.floor((gridWidth - GRID_GAP * (COLUMNS - 1)) / COLUMNS) : undefined;

  return (
    <Page testID="ledgers-screen">
      {header}
      <View style={[styles.grid, wide ? styles.gridWide : null]} onLayout={onGridLayout}>
        {items.map((ledger) => (
          <View key={ledger.id} style={{ width: cardWidth }}>
            <LedgerCard
              ledger={ledger}
              current={ledger.id === current?.id}
              wide={wide}
              onPress={() => router.push(routes.l(ledger.id).home() as Href)}
            />
          </View>
        ))}
        {wide && !atLimit ? (
          <View style={{ width: cardWidth }}>
            <NewLedgerTile onPress={goCreate} />
          </View>
        ) : null}
      </View>

      {atLimit ? (
        <Text variant="caption" tone="muted" testID="ledgers-limit-hint">
          {t('ledger:create.limit_reached')}
        </Text>
      ) : null}

      {wide ? null : (
        <View style={styles.narrowActions}>
          <Button
            testID="ledgers-create"
            label={t('ledger:list.empty.create_button')}
            icon="plus"
            size="lg"
            onPress={goCreate}
            disabled={atLimit}
            fullWidth
          />
          <Button
            testID="ledgers-join"
            label={t('ledger:list.empty.join_button')}
            icon="key-round"
            variant="secondary"
            size="lg"
            onPress={goJoin}
            fullWidth
          />
          <Text variant="caption" tone="muted" style={styles.footnote}>
            {t('ledger:list.footnote')}
          </Text>
        </View>
      )}
    </Page>
  );
}

const styles = StyleSheet.create({
  guidePage: { flexGrow: 1, gap: 0 },
  narrowHeader: { gap: space['1'] },
  grid: { gap: space['3'] },
  gridWide: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', gap: GRID_GAP },
  narrowActions: { gap: space['3'] },
  footnote: { paddingHorizontal: space['1'] },
  tile: {
    minHeight: 280,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    padding: space['5'],
  },
  tileGlyph: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileBody: { textAlign: 'center', maxWidth: 200 },
});
