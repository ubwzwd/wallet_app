/**
 * `/l/:ledgerId/imports/guide` — step 0 of the import flow (04 §4.10, decision §6).
 *
 * Everything on this page comes out of `GET /import-format`: the two skill texts, the
 * column table, the sample CSV and the category-table version. Nothing is hardcoded —
 * the skill and the category table are generated from the same source, so a column name
 * baked in here would drift the day the table changes (decision §6, §14.30).
 *
 * The upload page deliberately does NOT show "your skill version": the app cannot know
 * which version the user installed, only which one the uploaded file declares
 * (decision §14.52 A18).
 */
import React from 'react';
import { ScrollView, View } from 'react-native';
import { type Href, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import type { ImportFormat } from '@/api/types';
import { routes } from '@/domain/routes';
import { useLang } from '@/i18n';
import { useTopBar } from '@/navigation';
import { useImportFormat } from '@/queries';
import { useLedgerContext } from '@/store';
import { radius, space } from '@/theme/tokens';
import { useColors } from '@/theme/ThemeProvider';
import { useIsWide } from '@/theme/useBreakpoint';
import { Button, Card, EmptyState, Page, SegmentedControl, Skeleton, Text, toast } from '@/ui';

import { useCopyText } from './useCopyText';

type SkillTab = 'claude' | 'chatgpt';

/** Filenames of the two downloads; neither is fetched from the backend (04 §4.10). */
const SKILL_FILENAME = 'SKILL.md';
const INSTRUCTIONS_FILENAME = 'wallet-import-instructions.txt';
const SAMPLE_FILENAME = 'sample.csv';

/** A code block tall enough to read but not so tall it buries the rest of the page. */
const CODE_MAX_HEIGHT = 320;

/** Split a CSV line on commas, honouring the double-quote escaping RFC 4180 describes. */
function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      cells.push(cell);
      cell = '';
    } else {
      cell += ch;
    }
  }
  cells.push(cell);
  return cells;
}

/** The sample CSV as a grid; blank lines are dropped, everything else kept verbatim. */
export function parseSampleCsv(text: string): string[][] {
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map(splitCsvLine);
}

function CodeBlock({ text, testID }: { text: string; testID: string }): React.JSX.Element {
  const colors = useColors();
  return (
    <ScrollView
      nestedScrollEnabled
      style={{
        maxHeight: CODE_MAX_HEIGHT,
        borderRadius: radius.md,
        backgroundColor: colors['bg.subtle'],
      }}
      contentContainerStyle={{ padding: space['3'] }}
      testID={`${testID}-scroll`}
    >
      <Text variant="caption" mono selectable testID={testID}>
        {text}
      </Text>
    </ScrollView>
  );
}

function SectionHeading({ children }: { children: string }): React.JSX.Element {
  return (
    <Text variant="heading" accessibilityRole="header">
      {children}
    </Text>
  );
}

interface FormatSectionProps {
  format: ImportFormat;
}

/** The 11-column table, rendered from `columns` — never from a hardcoded list. */
function FormatTable({ format }: FormatSectionProps): React.JSX.Element {
  const { t } = useTranslation();
  const lang = useLang();
  const colors = useColors();
  const wide = useIsWide();

  return (
    <View style={{ gap: space['2'] }} testID="guide-format-table">
      {wide ? (
        <View style={{ flexDirection: 'row', gap: space['2'] }}>
          <Text variant="caption" tone="muted" style={{ flex: 2 }}>
            {t('import:guide.table.name')}
          </Text>
          <Text variant="caption" tone="muted" style={{ flex: 4 }}>
            {t('import:guide.table.desc')}
          </Text>
          <Text variant="caption" tone="muted" style={{ flex: 1 }}>
            {t('import:guide.table.required')}
          </Text>
        </View>
      ) : null}
      {format.columns.map((column) => (
        <View
          key={column.name}
          testID={`guide-column-${column.name}`}
          style={{
            flexDirection: wide ? 'row' : 'column',
            gap: wide ? space['2'] : space['1'],
            paddingVertical: space['2'],
            borderTopWidth: 1,
            borderTopColor: colors['border.default'],
          }}
        >
          <Text variant="body" mono style={{ flex: wide ? 2 : undefined }}>
            {column.name}
          </Text>
          <Text variant="caption" tone="secondary" style={{ flex: wide ? 4 : undefined }}>
            {lang === 'zh' ? column.desc_zh : column.desc_en}
          </Text>
          <Text
            variant="caption"
            tone={column.required ? 'warning' : 'muted'}
            style={{ flex: wide ? 1 : undefined }}
          >
            {column.required ? t('import:guide.required_yes') : t('import:guide.required_no')}
          </Text>
        </View>
      ))}
    </View>
  );
}

/** The sample file as a horizontally scrollable read-only grid (04 §4.10 step 0). */
function SampleTable({ format }: FormatSectionProps): React.JSX.Element {
  const colors = useColors();
  const grid = React.useMemo(() => parseSampleCsv(format.sample_csv), [format.sample_csv]);

  return (
    <ScrollView horizontal nestedScrollEnabled testID="guide-sample-scroll">
      <View style={{ gap: space['1'] }} testID="guide-sample-table">
        {grid.map((row, rowIndex) => (
          <View
            key={rowIndex}
            testID={`guide-sample-row-${rowIndex}`}
            style={{ flexDirection: 'row', gap: space['2'] }}
          >
            {row.map((cell, cellIndex) => (
              <Text
                key={cellIndex}
                variant="caption"
                mono
                numberOfLines={1}
                tone={rowIndex === 0 ? 'muted' : 'primary'}
                style={{
                  minWidth: 96,
                  paddingVertical: space['1'],
                  paddingHorizontal: space['2'],
                  borderRadius: radius.sm,
                  backgroundColor: rowIndex <= 1 ? colors['bg.subtle'] : 'transparent',
                }}
              >
                {cell}
              </Text>
            ))}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

export default function ImportGuideScreen(): React.JSX.Element {
  const { t } = useTranslation();
  const router = useRouter();
  const lang = useLang();
  const { ledgerId } = useLedgerContext();
  const { copy, download } = useCopyText();
  useTopBar(t('import:guide.title'));

  const query = useImportFormat();
  const [tab, setTab] = React.useState<SkillTab>('claude');

  const goUpload = React.useCallback(
    () => router.push(routes.l(ledgerId).importsNew() as Href),
    [ledgerId, router],
  );

  const onCopy = React.useCallback(
    (text: string): void => {
      void copy(text).then((ok) => {
        if (ok) toast.success(t('import:guide.copied_toast'));
      });
    },
    [copy, t],
  );

  if (query.isPending) {
    return (
      <Page testID="import-guide-screen">
        <Skeleton variant="card" testID="guide-skeleton" />
        <Skeleton variant="card" />
      </Page>
    );
  }

  if (query.isError || !query.data) {
    return (
      <Page testID="import-guide-screen">
        <EmptyState
          icon="alert-triangle"
          title={t('import:guide.error_retry')}
          primaryAction={{ label: t('common:button.retry'), onPress: () => void query.refetch() }}
          testID="guide-error"
        />
      </Page>
    );
  }

  const format = query.data;
  const skillText = tab === 'claude' ? format.skill_markdown : format.skill_text;
  const downloadName = tab === 'claude' ? SKILL_FILENAME : INSTRUCTIONS_FILENAME;
  const downloadLabel =
    tab === 'claude'
      ? t('import:guide.download_skill')
      : t('import:guide.download_instructions');

  return (
    <Page testID="import-guide-screen">
      <Text variant="title" accessibilityRole="header" testID="guide-title">
        {t('import:guide.title')}
      </Text>

      <Card variant="outlined" style={{ gap: space['3'] }} testID="guide-step-1">
        <SectionHeading>{t('import:guide.step1_title')}</SectionHeading>
        <SegmentedControl<SkillTab>
          testID="guide-skill-tabs"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'claude', label: t('import:guide.tab_claude') },
            { value: 'chatgpt', label: t('import:guide.tab_chatgpt') },
          ]}
        />
        <CodeBlock text={skillText} testID="guide-skill-text" />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space['2'] }}>
          <Button
            testID="guide-skill-copy"
            label={t('import:guide.copy')}
            icon="copy"
            variant="secondary"
            size="sm"
            onPress={() => onCopy(skillText)}
          />
          <Button
            testID="guide-skill-download"
            label={downloadLabel}
            icon="download"
            variant="secondary"
            size="sm"
            onPress={() => {
              download(downloadName, skillText, 'text/markdown;charset=utf-8');
            }}
          />
        </View>
      </Card>

      <Card variant="outlined" style={{ gap: space['2'] }} testID="guide-step-2">
        <SectionHeading>{t('import:guide.step2_title')}</SectionHeading>
        <Text variant="body" tone="secondary">
          {t('import:guide.step2_body')}
        </Text>
        <Text variant="caption" tone="muted" testID="guide-privacy-hint">
          {t('import:guide.step2_privacy_hint')}
        </Text>
      </Card>

      <Card variant="outlined" style={{ gap: space['3'] }} testID="guide-step-3">
        <SectionHeading>{t('import:guide.step3_title')}</SectionHeading>
        <Text variant="body" tone="secondary" testID="guide-instructions">
          {lang === 'zh' ? format.instructions_zh : format.instructions_en}
        </Text>
        <Button
          testID="guide-go-upload"
          label={t('import:guide.step3_action')}
          onPress={goUpload}
          style={{ alignSelf: 'flex-start' }}
        />
      </Card>

      <Card variant="outlined" style={{ gap: space['2'] }} testID="guide-format">
        <SectionHeading>{t('import:guide.format_title')}</SectionHeading>
        <Text variant="caption" tone="secondary" mono testID="guide-version-line">
          {t('import:guide.version_line', { version: format.version })}
        </Text>
        <FormatTable format={format} />
        <Text variant="caption" tone="muted" testID="guide-blank-category-hint">
          {t('import:guide.blank_category_hint')}
        </Text>
      </Card>

      <Card variant="outlined" style={{ gap: space['3'] }} testID="guide-sample">
        <SectionHeading>{t('import:guide.sample_title')}</SectionHeading>
        <SampleTable format={format} />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space['2'] }}>
          <Button
            testID="guide-sample-copy"
            label={t('import:guide.copy_csv')}
            icon="copy"
            variant="secondary"
            size="sm"
            onPress={() => onCopy(format.sample_csv)}
          />
          <Button
            testID="guide-sample-download"
            label={t('import:guide.download_sample')}
            icon="download"
            variant="secondary"
            size="sm"
            onPress={() => {
              download(SAMPLE_FILENAME, format.sample_csv, 'text/csv;charset=utf-8');
            }}
          />
        </View>
      </Card>

      <Text variant="caption" tone="muted" testID="guide-version">
        {t('import:guide.footer_version', { version: format.version })}
      </Text>
    </Page>
  );
}
