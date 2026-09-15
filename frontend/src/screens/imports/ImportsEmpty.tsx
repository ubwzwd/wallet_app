/**
 * 屏幕稿 15 · 空导入历史 — the import history of a ledger nobody has imported into yet.
 *
 * Not a blank page: a white card that says what importing actually is (your own
 * ChatGPT / Claude does the tidying, the statement never reaches this app), the way in,
 * the way to the full guide, and one line of relief — you can skip importing entirely.
 * Beside it (below it, on a phone) a striped preview of what a batch list looks like.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { radius, space } from '@/theme/tokens';
import { useColors } from '@/theme/ThemeProvider';
import { useIsWide } from '@/theme/useBreakpoint';
import { Button, GhostBlock, Icon, ListCard, Text } from '@/ui';

export interface ImportsEmptyProps {
  onImport(): void;
  onGuide(): void;
  testID?: string;
}

export function ImportsEmpty({
  onImport,
  onGuide,
  testID = 'imports-empty',
}: ImportsEmptyProps): React.JSX.Element {
  const { t } = useTranslation();
  const colors = useColors();
  const wide = useIsWide();

  const preview = (
    <GhostBlock
      framed
      rows={2}
      caption={t('import:history.empty.preview_caption')}
      note={t('import:history.empty.preview_note')}
      style={wide ? styles.previewWide : styles.previewNarrow}
      testID={`${testID}-preview`}
    />
  );

  const copy = (
    <View style={wide ? styles.copyWide : styles.copyNarrow}>
      <View style={[styles.icon, { backgroundColor: colors['accent.subtle'] }]}>
        <Icon name="upload" size={24} color={colors['accent.solid']} />
      </View>
      <Text
        variant="heading"
        weight={700}
        style={[styles.headline, wide ? null : styles.centered]}
        accessibilityRole="header"
      >
        {t('import:history.empty.title')}
      </Text>
      <Text variant="body" tone="secondary" style={[styles.body, wide ? null : styles.centered]}>
        {t('import:history.empty.body')}
      </Text>
      <View style={wide ? styles.actionsWide : styles.actionsNarrow}>
        <Button
          testID={`${testID}-primary`}
          label={t('import:history.empty.action')}
          icon="upload"
          size={wide ? 'md' : 'lg'}
          fullWidth={!wide}
          onPress={onImport}
        />
        <Button
          testID={`${testID}-secondary`}
          label={t('import:history.empty.secondary')}
          variant="soft"
          size={wide ? 'md' : 'lg'}
          fullWidth={!wide}
          onPress={onGuide}
        />
      </View>
      <Text variant="caption" tone="muted" style={wide ? null : styles.centered}>
        {t('import:history.empty.fallback')}
      </Text>
    </View>
  );

  return (
    <ListCard style={wide ? styles.cardWide : styles.cardNarrow} testID={testID}>
      {wide ? (
        <View style={styles.rowLayout}>
          {copy}
          {preview}
        </View>
      ) : (
        <View style={styles.columnLayout}>
          {preview}
          <View style={[styles.rule, { borderTopColor: colors['border.default'] }]} />
          {copy}
        </View>
      )}
    </ListCard>
  );
}

const styles = StyleSheet.create({
  cardWide: { padding: space['8'] },
  cardNarrow: { padding: space['5'] },
  rowLayout: { flexDirection: 'row', alignItems: 'center', gap: space['8'], flexWrap: 'wrap' },
  columnLayout: { gap: space['5'] },
  copyWide: { flex: 1, minWidth: 320, gap: space['2'] },
  copyNarrow: { alignItems: 'center', gap: space['2'] },
  icon: {
    width: 52,
    height: 52,
    borderRadius: radius.md + 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headline: { marginTop: space['3'] },
  body: { maxWidth: 480, lineHeight: 23 },
  centered: { textAlign: 'center' },
  actionsWide: { flexDirection: 'row', flexWrap: 'wrap', gap: space['2'], marginTop: space['3'] },
  actionsNarrow: { alignSelf: 'stretch', gap: space['2'], marginTop: space['3'] },
  previewWide: { width: 400, flexGrow: 0, flexShrink: 1, maxWidth: '100%', alignSelf: 'flex-start' },
  previewNarrow: { alignSelf: 'stretch', maxWidth: '100%' },
  rule: { borderTopWidth: 1 },
});

export default ImportsEmpty;
