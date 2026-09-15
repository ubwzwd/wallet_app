/**
 * The folded 「已归档账户」 block at the bottom of the account list (屏幕稿 09).
 *
 * The head strip says what archiving means — 「不计入净资产与首页，历史交易照旧保留、照旧能
 * 搜到」 (04 §4.8, decision §14.50) — and how many accounts are in there before it is opened.
 * Opening it reveals the same rows as the list above, greyed and stamped with their archive
 * date; the open/closed state is the caller's, because it lives in the URL.
 */
import React from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import type { FinanceSource } from '@/api/types';
import type { Lang } from '@/i18n';
import { radius, space } from '@/theme/tokens';
import { useColors } from '@/theme/ThemeProvider';
import { useIsWide } from '@/theme/useBreakpoint';
import { Icon, ListCard, Text } from '@/ui';

import { SourceListRow } from './SourceGroup';
import { MIN_TABLE_WIDTH, SourceTableRow } from './SourcesTable';

/** The head strip's round icon well (屏幕稿 09: 32px). */
const WELL = 32;

export interface ArchivedPanelProps {
  sources: readonly FinanceSource[];
  baseCurrency: string;
  lang: Lang;
  expanded: boolean;
  onToggle(): void;
  onOpen(source: FinanceSource): void;
  onDelete(source: FinanceSource): void;
  deleteBlockedId: string | null;
}

export function ArchivedPanel({
  sources,
  baseCurrency,
  lang,
  expanded,
  onToggle,
  onOpen,
  onDelete,
  deleteBlockedId,
}: ArchivedPanelProps): React.JSX.Element {
  const { t } = useTranslation();
  const colors = useColors();
  const wide = useIsWide();

  const head = (
    // touch-target-exempt: the strip is 60 (wide) / 56 (narrow) tall through minHeight below.
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={
        expanded ? t('source:list.archived_collapse') : t('source:list.archived_expand')
      }
      accessibilityState={{ expanded }}
      onPress={onToggle}
      testID="sources-archived-toggle"
      style={({ pressed }) => ({
        minHeight: wide ? 60 : 56,
        flexDirection: 'row',
        alignItems: 'center',
        gap: space['3'],
        paddingHorizontal: wide ? space['5'] : space['4'],
        paddingVertical: space['3'],
        backgroundColor: pressed ? colors['bg.hover'] : 'transparent',
      })}
    >
      <View
        accessibilityElementsHidden
        importantForAccessibility="no"
        style={{
          width: WELL,
          height: WELL,
          borderRadius: radius.pill,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: colors['bg.subtle'],
        }}
      >
        <Icon name="archive" size={17} color={colors['fg.secondary']} />
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text variant="subheading" weight={600} numberOfLines={1}>
          {t('source:list.archived_title')}
        </Text>
        <Text variant="caption" tone="muted" testID="sources-archived-hint">
          {t('source:list.archived_hint')}
        </Text>
      </View>
      <Text variant="body" tone="muted" mono testID="sources-archived-count">
        {t('source:list.archived_count', { count: sources.length })}
      </Text>
      <Icon
        name={expanded ? 'chevron-down' : 'chevron-right'}
        size={16}
        color={colors['border.strong']}
      />
    </Pressable>
  );

  const card = (
    <ListCard
      testID="sources-archived-section"
      divided
      style={wide ? { minWidth: MIN_TABLE_WIDTH, flexGrow: 1 } : undefined}
    >
      {head}
      {expanded
        ? sources.map((source) =>
            wide ? (
              <SourceTableRow
                key={source.id}
                source={source}
                baseCurrency={baseCurrency}
                lang={lang}
                onOpen={onOpen}
                onDelete={onDelete}
                deleteBlocked={deleteBlockedId === source.id}
              />
            ) : (
              <SourceListRow
                key={source.id}
                source={source}
                baseCurrency={baseCurrency}
                lang={lang}
                onOpen={onOpen}
                onDelete={onDelete}
                deleteBlocked={deleteBlockedId === source.id}
              />
            ),
          )
        : null}
    </ListCard>
  );

  if (!wide) return card;
  // 屏幕稿 09: the archived block reuses the table's column track, so it has to scroll
  // with it — without the same floor and the same horizontal scroller, the two cards'
  // columns drift apart as soon as the page is narrower than MIN_TABLE_WIDTH.
  return (
    <ScrollView
      horizontal
      testID="sources-archived-hscroll"
      style={{ flexGrow: 0 }}
      contentContainerStyle={{ minWidth: '100%', flexGrow: 1 }}
    >
      {card}
    </ScrollView>
  );
}
