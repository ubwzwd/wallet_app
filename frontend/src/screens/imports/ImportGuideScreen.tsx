/**
 * `/imports/guide` — 「标准格式说明」, the secondary page step 3 of the import
 * page links to (04 §4.10, decision §6, §14.56: the steps and the skill text now live on
 * `/imports/new`; only the format reference stayed here).
 *
 * Everything on this page comes out of `GET /import-format`: the column table, the sample
 * CSV and the category-table version. Nothing is hardcoded — the skill and the category
 * table are generated from the same source, so a column name baked in here would drift the
 * day the table changes (decision §6, §14.30).
 *
 * The upload page deliberately does NOT show "your skill version": the app cannot know
 * which version the user installed, only which one the uploaded file declares
 * (decision §14.52 A18).
 */
import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import type { ImportFormat } from '@/api/types';
import { useLang } from '@/i18n';
import { useBack, useTopBar } from '@/navigation';
import { useImportFormat } from '@/queries';
import { radius, space } from '@/theme/tokens';
import { useColors } from '@/theme/ThemeProvider';
import { useIsWide } from '@/theme/useBreakpoint';
import {
  Button,
  EmptyState,
  ListCard,
  Page,
  PageHeader,
  Skeleton,
  Text,
  toast,
} from '@/ui';

import { useCopyText } from './useCopyText';

const SAMPLE_FILENAME = 'sample.csv';

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

function CardTitle({ children }: { children: string }): React.JSX.Element {
  return (
    <Text variant="subheading" weight={700} accessibilityRole="header">
      {children}
    </Text>
  );
}

/** The 11-column table, rendered from `columns` — never from a hardcoded list. */
function FormatTable({ format }: { format: ImportFormat }): React.JSX.Element {
  const { t } = useTranslation();
  const lang = useLang();
  const colors = useColors();
  const wide = useIsWide();

  const head = (
    <View style={[styles.row, styles.headRow, { backgroundColor: colors['bg.canvas'] }]}>
      <Text variant="micro" tone="secondary" mono weight={600} style={styles.colName}>
        {t('import:guide.table.name')}
      </Text>
      <Text variant="micro" tone="secondary" mono weight={600} style={styles.colDesc}>
        {t('import:guide.table.desc')}
      </Text>
      <Text variant="micro" tone="secondary" mono weight={600} style={styles.colRequired}>
        {t('import:guide.table.required')}
      </Text>
    </View>
  );

  return (
    <ListCard divided header={wide ? head : undefined} testID="guide-format-table">
      {format.columns.map((column) => (
        <View
          key={column.name}
          testID={`guide-column-${column.name}`}
          style={[styles.row, wide ? styles.bodyRow : styles.bodyRowNarrow]}
        >
          <Text variant="body" mono weight={500} style={wide ? styles.colName : undefined}>
            {column.name}
          </Text>
          <Text variant="caption" tone="secondary" style={wide ? styles.colDesc : undefined}>
            {lang === 'zh' ? column.desc_zh : column.desc_en}
          </Text>
          <Text
            variant="caption"
            tone={column.required ? 'warning' : 'muted'}
            style={wide ? styles.colRequired : undefined}
          >
            {column.required ? t('import:guide.required_yes') : t('import:guide.required_no')}
          </Text>
        </View>
      ))}
    </ListCard>
  );
}

/** The sample file as a horizontally scrollable read-only grid (04 §4.10 step 0). */
function SampleTable({ format }: { format: ImportFormat }): React.JSX.Element {
  const colors = useColors();
  const grid = React.useMemo(() => parseSampleCsv(format.sample_csv), [format.sample_csv]);

  return (
    <ScrollView horizontal nestedScrollEnabled testID="guide-sample-scroll">
      <View style={styles.sample} testID="guide-sample-table">
        {grid.map((row, rowIndex) => (
          <View key={rowIndex} testID={`guide-sample-row-${rowIndex}`} style={styles.sampleRow}>
            {row.map((cell, cellIndex) => (
              <Text
                key={cellIndex}
                variant="caption"
                mono
                numberOfLines={1}
                tone={rowIndex === 0 ? 'muted' : 'primary'}
                style={[
                  styles.cell,
                  { backgroundColor: rowIndex <= 1 ? colors['bg.subtle'] : 'transparent' },
                ]}
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
  const { copy, download } = useCopyText();
  useTopBar(t('import:guide.title'));
  const back = useBack();

  const query = useImportFormat();

  const onCopy = React.useCallback(
    (text: string): void => {
      void copy(text).then((ok) => {
        if (ok) toast.success(t('import:guide.copied_toast'));
      });
    },
    [copy, t],
  );

  const header = (
    <PageHeader
      title={t('import:guide.title')}
      back={{
        crumb: t('import:guide.crumb'),
        label: t('import:guide.back'),
        // History first; a deep link goes to the upload page (`useBack`, §14.64 f).
        onPress: back.goBack,
      }}
      testID="guide-header"
    />
  );

  if (query.isPending) {
    return (
      <Page testID="import-guide-screen">
        {header}
        <Skeleton variant="card" testID="guide-skeleton" />
        <Skeleton variant="card" />
      </Page>
    );
  }

  if (query.isError || !query.data) {
    return (
      <Page testID="import-guide-screen">
        {header}
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

  return (
    <Page readingWidth testID="import-guide-screen">
      {header}

      <View style={styles.section} testID="guide-format">
        <CardTitle>{t('import:guide.format_title')}</CardTitle>
        <Text variant="body" tone="secondary" testID="guide-intro">
          {t('import:guide.intro')}
        </Text>
        <Text variant="caption" tone="secondary" mono testID="guide-version-line">
          {t('import:guide.version_line', { version: format.version })}
        </Text>
        <FormatTable format={format} />
        <Text variant="caption" tone="muted" testID="guide-blank-category-hint">
          {t('import:guide.blank_category_hint')}
        </Text>
      </View>

      <View style={styles.section} testID="guide-sample">
        <CardTitle>{t('import:guide.sample_title')}</CardTitle>
        <ListCard style={styles.sampleCard}>
          <SampleTable format={format} />
        </ListCard>
        <View style={styles.actions}>
          <Button
            testID="guide-sample-copy"
            label={t('import:guide.copy_csv')}
            icon="copy"
            variant="soft"
            size="sm"
            onPress={() => onCopy(format.sample_csv)}
          />
          <Button
            testID="guide-sample-download"
            label={t('import:guide.download_sample')}
            icon="download"
            variant="soft"
            size="sm"
            onPress={() => {
              download(SAMPLE_FILENAME, format.sample_csv, 'text/csv;charset=utf-8');
            }}
          />
        </View>
      </View>

      <Text variant="caption" tone="muted" mono testID="guide-version">
        {t('import:guide.footer_version', { version: format.version })}
      </Text>
    </Page>
  );
}

const styles = StyleSheet.create({
  section: { alignSelf: 'stretch', gap: space['3'] },
  sampleCard: { padding: space['4'] },
  row: { flexDirection: 'row', alignItems: 'center', gap: space['3'] },
  headRow: { paddingHorizontal: space['4'], paddingVertical: space['3'] },
  bodyRow: { paddingHorizontal: space['4'], paddingVertical: space['3'] },
  bodyRowNarrow: {
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: space['1'],
    paddingHorizontal: space['3'],
    paddingVertical: space['3'],
  },
  colName: { flex: 2, minWidth: 0 },
  colDesc: { flex: 4, minWidth: 0 },
  colRequired: { flex: 1, minWidth: 0, textAlign: 'right' },
  sample: { gap: space['1'], paddingVertical: space['1'] },
  sampleRow: { flexDirection: 'row', gap: space['2'] },
  cell: {
    minWidth: 96,
    paddingVertical: space['1'],
    paddingHorizontal: space['2'],
    borderRadius: radius.sm,
  },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space['2'] },
});
