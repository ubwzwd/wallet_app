/**
 * The left half of screen 10: 「三步」 + the skill text.
 *
 * Three numbered steps (the first badge filled, the other two tinted), then a hairline and
 * the skill block: a title with the version and size on the right, a mono code box a few
 * lines tall, and the two actions — copy (primary) and download (soft).
 *
 * Nothing here is hardcoded: the body of every step is language-pack copy, and the code box
 * shows exactly what `GET /import-format` returned for the selected tab (decision §6,
 * §14.30). Step 3 links to the standard-format page rather than repeating the 11 columns.
 */
import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import type { ImportFormat } from '@/api/types';
import { formatBytes } from '@/i18n/format';
import { radius, space } from '@/theme/tokens';
import { useColors } from '@/theme/ThemeProvider';
import { useIsWide } from '@/theme/useBreakpoint';
import { Button, ListCard, SegmentedControl, Text, toast } from '@/ui';

import { useCopyText } from './useCopyText';

export type SkillTab = 'claude' | 'chatgpt';

/** Filenames of the two downloads; neither is fetched from the backend (04 §4.10). */
const SKILL_FILENAME = 'SKILL.md';
const INSTRUCTIONS_FILENAME = 'wallet-import-instructions.txt';

/** 屏幕稿 10: the code box shows the first few lines and clips the rest. */
const CODE_HEIGHT_WIDE = 150;
const CODE_HEIGHT_NARROW = 104;

/**
 * UTF-8 byte length without a `TextEncoder` (React Native has none on every platform):
 * ASCII is one byte, the BMP three, astral pairs four across their two code units.
 */
export function utf8Bytes(text: string): number {
  let bytes = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
  }
  return bytes;
}

interface StepProps {
  n: number;
  title: string;
  body: string;
  first: boolean;
  trailing?: React.ReactNode;
}

function Step({ n, title, body, first, trailing }: StepProps): React.JSX.Element {
  const colors = useColors();
  const wide = useIsWide();
  const size = wide ? 30 : 26;
  return (
    <View style={styles.step} testID={`import-step-${n}`}>
      <View
        style={[
          styles.badge,
          {
            width: size,
            height: size,
            backgroundColor: first ? colors['accent.solid'] : colors['bg.selected'],
          },
        ]}
      >
        <Text
          variant="body"
          mono
          weight={600}
          style={{ color: colors[first ? 'accent.fg' : 'accent.solid'] }}
        >
          {String(n)}
        </Text>
      </View>
      <View style={styles.stepText}>
        <Text variant="subheading" weight={600}>
          {title}
        </Text>
        <Text variant="body" tone="muted" style={styles.stepBody}>
          {body}
        </Text>
        {trailing}
      </View>
    </View>
  );
}

export interface ImportStepsProps {
  format: ImportFormat;
  /** Step 3's link to `/imports/guide`. */
  onOpenFormat(): void;
  testID?: string;
}

export function ImportSteps({
  format,
  onOpenFormat,
  testID = 'import-steps',
}: ImportStepsProps): React.JSX.Element {
  const { t } = useTranslation();
  const colors = useColors();
  const wide = useIsWide();
  const { copy, download } = useCopyText();
  const [tab, setTab] = React.useState<SkillTab>('claude');

  const skillText = tab === 'claude' ? format.skill_markdown : format.skill_text;
  const downloadName = tab === 'claude' ? SKILL_FILENAME : INSTRUCTIONS_FILENAME;
  const downloadLabel =
    tab === 'claude'
      ? t('import:upload.download_skill')
      : t('import:upload.download_instructions');

  const onCopy = React.useCallback((): void => {
    void copy(skillText).then((ok) => {
      if (ok) toast.success(t('import:upload.copied_toast'));
    });
  }, [copy, skillText, t]);

  return (
    <ListCard style={wide ? styles.cardWide : styles.cardNarrow} testID={testID}>
      <Text variant={wide ? 'heading' : 'subheading'} weight={700} accessibilityRole="header">
        {t('import:upload.steps_title')}
      </Text>

      <View style={wide ? styles.stepsWide : styles.stepsNarrow}>
        <Step n={1} first title={t('import:upload.step1_title')} body={t('import:upload.step1_body')} />
        <Step n={2} first={false} title={t('import:upload.step2_title')} body={t('import:upload.step2_body')} />
        <Step
          n={3}
          first={false}
          title={t('import:upload.step3_title')}
          body={t('import:upload.step3_body')}
          trailing={
            <Button
              testID="upload-format-link"
              label={t('import:upload.format_link')}
              variant="ghost"
              size="sm"
              onPress={onOpenFormat}
              style={styles.formatLink}
            />
          }
        />
      </View>

      <View style={[styles.rule, { borderTopColor: colors['border.default'] }]} />

      <View style={styles.skillHead}>
        <Text variant={wide ? 'subheading' : 'caption'} weight={wide ? 700 : 600} tone={wide ? 'primary' : 'secondary'}>
          {t('import:upload.skill_title')}
        </Text>
        <Text variant="caption" tone="muted" mono testID="upload-skill-meta">
          {t('import:upload.skill_meta', {
            version: format.version,
            size: formatBytes(utf8Bytes(skillText)),
          })}
        </Text>
      </View>

      <SegmentedControl<SkillTab>
        testID="guide-skill-tabs"
        size="sm"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'claude', label: t('import:upload.tab_claude') },
          { value: 'chatgpt', label: t('import:upload.tab_chatgpt') },
        ]}
      />

      <ScrollView
        nestedScrollEnabled
        style={[
          styles.code,
          {
            maxHeight: wide ? CODE_HEIGHT_WIDE : CODE_HEIGHT_NARROW,
            backgroundColor: colors['bg.canvas'],
          },
        ]}
        contentContainerStyle={styles.codeInner}
        testID="guide-skill-text-scroll"
      >
        <Text variant="caption" mono tone="secondary" selectable testID="guide-skill-text">
          {skillText}
        </Text>
      </ScrollView>

      <View style={styles.actions}>
        <Button
          testID="guide-skill-copy"
          label={t('import:upload.copy_skill')}
          icon="copy"
          onPress={onCopy}
          style={wide ? undefined : styles.grow}
        />
        <Button
          testID="guide-skill-download"
          label={downloadLabel}
          icon="download"
          variant="soft"
          onPress={() => {
            download(downloadName, skillText, 'text/markdown;charset=utf-8');
          }}
          style={wide ? undefined : styles.grow}
        />
      </View>
    </ListCard>
  );
}

const styles = StyleSheet.create({
  cardWide: { padding: space['5'] + 2, gap: space['3'] },
  cardNarrow: { padding: space['4'], gap: space['3'] },
  stepsWide: { gap: space['4'] + 2, marginTop: space['1'] },
  stepsNarrow: { gap: space['3'] + 2, marginTop: space['1'] },
  step: { flexDirection: 'row', gap: space['3'] + 2, alignItems: 'flex-start' },
  badge: {
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  stepText: { flex: 1, minWidth: 0, gap: 3 },
  stepBody: { lineHeight: 21 },
  formatLink: { alignSelf: 'flex-start', paddingHorizontal: 0, marginLeft: -space['1'] },
  rule: { borderTopWidth: 1, marginTop: space['2'] },
  skillHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space['3'],
  },
  code: { borderRadius: radius.md, flexGrow: 0 },
  codeInner: { paddingHorizontal: space['4'], paddingVertical: space['3'] + 2 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space['2'] + 2 },
  grow: { flexGrow: 1 },
});

export default ImportSteps;
