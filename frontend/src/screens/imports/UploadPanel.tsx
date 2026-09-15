/**
 * The right half of screen 10: 「现在做」 — the target account, the drop zone, the paste
 * box, and the small 「最近导入」 list the mockup keeps in the sidebar.
 *
 * The account row is the mockup's 60-tall well (icon + name + 「储蓄卡 · CNY · 12,480.35」 +
 * chevron) rather than a text field, so the picker's list lives here too: a popover on wide
 * layouts, a bottom sheet on narrow ones — the same split `Select` makes, never `Platform`.
 * Archived accounts are not offered (decision §3), which is `selectableSources`' job.
 */
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import type { FinanceSource, ImportBatchListItem, Uuid } from '@/api/types';
import { type Lang } from '@/i18n';
import { formatMoney } from '@/i18n/format';
import { radius, space } from '@/theme/tokens';
import { useColors } from '@/theme/ThemeProvider';
import { useIsWide } from '@/theme/useBreakpoint';
import {
  Button,
  Icon,
  ListCard,
  ListRow,
  Popover,
  SOURCE_TYPE_ICON,
  Sheet,
  Text,
  selectableSources,
} from '@/ui';

/** The dashed-looking drop zone of 屏幕稿 10 (1.5px inset ring, not a border). */
const DROP_RING = 1.5;

function sourceHint(source: FinanceSource, lang: Lang, typeLabel: string): string {
  return [typeLabel, source.default_currency, formatMoney(source.balance, source.default_currency, lang)].join(
    ' · ',
  );
}

export interface TargetSourceRowProps {
  sources: readonly FinanceSource[];
  value: Uuid | null;
  onChange(next: Uuid): void;
  lang: Lang;
  testID: string;
}

/** The 「目标账户」 well plus its option list. */
export function TargetSourceRow({
  sources,
  value,
  onChange,
  lang,
  testID,
}: TargetSourceRowProps): React.JSX.Element {
  const { t } = useTranslation();
  const colors = useColors();
  const wide = useIsWide();
  const [open, setOpen] = React.useState(false);
  const anchorRef = React.useRef<View>(null);

  const options = React.useMemo(() => selectableSources(sources), [sources]);
  const selected = options.find((s) => s.id === value) ?? null;

  const list = (
    <View style={styles.options}>
      {options.map((source) => (
        <ListRow
          key={source.id}
          testID={`${testID}-option-${source.id}`}
          icon={
            <View style={[styles.well, { backgroundColor: colors['accent.subtle'] }]}>
              <Icon name={SOURCE_TYPE_ICON[source.type]} size={18} color={colors['accent.solid']} />
            </View>
          }
          title={source.name}
          subtitle={sourceHint(source, lang, t(`source:type.${source.type}`))}
          selected={source.id === value}
          onPress={() => {
            onChange(source.id);
            setOpen(false);
          }}
          trailing={
            source.id === value ? (
              <Icon name="check" size={18} color={colors['accent.solid']} />
            ) : undefined
          }
        />
      ))}
    </View>
  );

  return (
    <View style={styles.field}>
      <Text variant="caption" tone="secondary" weight={600}>
        {t('import:upload.source_label')}
      </Text>
      <View ref={anchorRef}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          accessibilityLabel={t('import:upload.source_label')}
          onPress={() => setOpen((o) => !o)}
          testID={`${testID}-trigger`}
          style={({ pressed }) => [
            styles.trigger,
            {
              height: wide ? 60 : 56,
              backgroundColor: pressed ? colors['bg.hover'] : colors['bg.canvas'],
            },
          ]}
        >
          <View style={[styles.well, { backgroundColor: colors['accent.subtle'] }]}>
            <Icon
              name={selected ? SOURCE_TYPE_ICON[selected.type] : 'wallet'}
              size={18}
              color={colors['accent.solid']}
            />
          </View>
          <View style={styles.triggerText}>
            <Text
              variant="subheading"
              weight={500}
              tone={selected ? 'primary' : 'muted'}
              numberOfLines={1}
              testID={`${testID}-value`}
            >
              {selected ? selected.name : t('import:upload.source_placeholder')}
            </Text>
            {selected ? (
              <Text variant="caption" tone="muted" mono numberOfLines={1}>
                {sourceHint(selected, lang, t(`source:type.${selected.type}`))}
              </Text>
            ) : null}
          </View>
          <Icon name="chevron-right" size={18} color={colors['fg.muted']} />
        </Pressable>
      </View>

      <Popover
        open={open && wide}
        onClose={() => setOpen(false)}
        anchorRef={anchorRef}
        closeLabel={t('import:upload.source_label')}
        testID={testID}
      >
        {list}
      </Popover>
      {wide ? null : (
        <Sheet
          open={open}
          onClose={() => setOpen(false)}
          title={t('import:upload.source_label')}
          testID={`${testID}-sheet`}
        >
          {list}
        </Sheet>
      )}
    </View>
  );
}

export interface DropZoneProps {
  /** A refused or failed file paints the zone in the danger tint (屏幕稿 10 · 校验失败). */
  tone: 'default' | 'danger';
  title: string;
  body: string;
  /** The caller names the two lines, because what they say changes what they mean. */
  titleTestID: string;
  bodyTestID: string;
  onChoose(): void;
  testID?: string;
}

export function DropZone({
  tone,
  title,
  body,
  titleTestID,
  bodyTestID,
  onChoose,
  testID = 'upload-dropzone',
}: DropZoneProps): React.JSX.Element {
  const { t } = useTranslation();
  const colors = useColors();
  const wide = useIsWide();
  const danger = tone === 'danger';
  return (
    <View
      testID={testID}
      style={[
        styles.drop,
        {
          paddingVertical: wide ? space['7'] : space['5'],
          backgroundColor: colors['bg.surface'],
          borderColor: danger ? colors['kind.expense'] : colors['border.strong'],
        },
      ]}
    >
      <View
        style={[
          styles.dropIcon,
          {
            width: wide ? 52 : 44,
            height: wide ? 52 : 44,
            backgroundColor: danger ? colors['status.danger.bg'] : colors['accent.subtle'],
          },
        ]}
      >
        <Icon
          name="upload"
          size={22}
          color={danger ? colors['status.danger.fg'] : colors['accent.solid']}
        />
      </View>
      <Text
        variant={wide ? 'heading' : 'subheading'}
        weight={600}
        style={styles.centered}
        numberOfLines={2}
        testID={titleTestID}
      >
        {title}
      </Text>
      <Text
        variant="caption"
        tone={danger ? 'danger' : 'muted'}
        style={styles.centered}
        testID={bodyTestID}
      >
        {body}
      </Text>
      <Button
        testID="upload-choose-file"
        label={t('import:upload.choose_file')}
        onPress={onChoose}
        style={styles.dropButton}
      />
    </View>
  );
}

/** 「或者粘贴文本」: a hairline, the label, another hairline. */
export function PasteDivider(): React.JSX.Element {
  const { t } = useTranslation();
  const colors = useColors();
  return (
    <View style={styles.divider}>
      <View style={[styles.line, { backgroundColor: colors['border.default'] }]} />
      <Text variant="caption" tone="muted">
        {t('import:upload.paste_divider')}
      </Text>
      <View style={[styles.line, { backgroundColor: colors['border.default'] }]} />
    </View>
  );
}

export interface RecentImportsProps {
  batches: readonly ImportBatchListItem[];
  onPress(batchId: Uuid): void;
}

/** 屏幕稿 10's 「最近导入」 — file name on the left, entry count on the right. */
export function RecentImports({ batches, onPress }: RecentImportsProps): React.JSX.Element {
  const { t } = useTranslation();
  const colors = useColors();
  return (
    <View style={[styles.recent, { backgroundColor: colors['bg.canvas'] }]} testID="upload-recent">
      <Text variant="micro" tone="muted" mono weight={600}>
        {t('import:upload.recent_title')}
      </Text>
      {batches.length === 0 ? (
        <Text variant="caption" tone="muted" testID="upload-recent-empty">
          {t('import:upload.recent_empty')}
        </Text>
      ) : (
        batches.map((batch) => (
          // touch-target-exempt: a 22-high text line inside a list, with hit slop to 44.
          <Pressable
            key={batch.id}
            accessibilityRole="button"
            accessibilityLabel={batch.filename ?? t('import:history.pasted_filename')}
            hitSlop={space['3']}
            onPress={() => onPress(batch.id)}
            testID={`upload-recent-${batch.id}`}
            style={styles.recentRow}
          >
            <Text variant="caption" numberOfLines={1} style={styles.recentName}>
              {batch.filename ?? t('import:history.pasted_filename')}
            </Text>
            <Text variant="caption" tone="success" mono>
              {t('import:upload.recent_count', { count: batch.row_count })}
            </Text>
          </Pressable>
        ))
      )}
    </View>
  );
}

/** The white card everything above sits in. */
export function UploadCard({
  children,
  testID,
}: {
  children: React.ReactNode;
  testID?: string;
}): React.JSX.Element {
  const wide = useIsWide();
  return (
    <ListCard style={wide ? styles.cardWide : styles.cardNarrow} testID={testID}>
      {children}
    </ListCard>
  );
}

const styles = StyleSheet.create({
  field: { gap: space['2'] - 2 },
  trigger: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space['3'],
    paddingHorizontal: space['4'],
    borderRadius: radius.md,
  },
  triggerText: { flex: 1, minWidth: 0 },
  well: {
    width: 34,
    height: 34,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  options: { maxHeight: 320 },
  drop: {
    alignItems: 'center',
    gap: space['1'],
    paddingHorizontal: space['4'],
    borderRadius: radius.md + 2,
    borderWidth: DROP_RING,
  },
  dropIcon: {
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space['2'],
  },
  dropButton: { marginTop: space['3'] },
  centered: { textAlign: 'center' },
  divider: { flexDirection: 'row', alignItems: 'center', gap: space['3'] },
  line: { flex: 1, height: 1 },
  cardWide: { padding: space['5'] + 2, gap: space['4'] },
  cardNarrow: { padding: space['4'], gap: space['3'] },
  recent: { borderRadius: radius.md, padding: space['3'] + 2, gap: space['2'] },
  recentRow: { flexDirection: 'row', alignItems: 'center', gap: space['2'], minHeight: 22 },
  recentName: { flex: 1, minWidth: 0 },
});
