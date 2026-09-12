/**
 * Operations timeline on the transaction detail page (04 §4.7; decision §14.51).
 *
 * Newest first: time · person · action · what changed. People come from the member list
 * (`names`), you are "我"; a member who left the ledger keeps their name, nothing is
 * anonymised. `client` is deliberately not rendered — this release only has a web client
 * (decision §0.1), so showing it would be noise.
 */
import React from 'react';
import { Pressable, type StyleProp, StyleSheet, View, type ViewStyle } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { TransactionEvent, Uuid } from '@/api/types';
import type { CategoryIndex } from '@/domain/categories';
import { type Lang, useLang } from '@/i18n';
import { categoryName } from '@/i18n/category';
import { formatDate, formatDateTime, formatMoney } from '@/i18n/format';
import { density, radius, space } from '@/theme/tokens';
import { useColors } from '@/theme/ThemeProvider';
import { Text } from './Text';

/** More changed fields than this collapse behind "共 N 处改动，展开" (04 §4.7). */
export const CHANGES_COLLAPSE_AT = 3;

/** Short form of a batch id, the `#` number in "来自导入 #12". */
export function shortId(id: Uuid): string {
  return id.slice(0, 8);
}

export interface EventTimelineProps {
  events: readonly TransactionEvent[];
  /** `actor_id → display name` (caller falls back to the email prefix, 04 §4.7). */
  names: Readonly<Record<Uuid, string>>;
  meId: Uuid;
  lang?: Lang;
  /** Turns `category_l1` / `category_l2` codes into names. */
  index?: CategoryIndex;
  /** `source_id → account name`, for the account change line. */
  sourceNames?: Readonly<Record<Uuid, string>>;
  /** The transaction's currency, so amount changes format like everywhere else. */
  currency?: string;
  onPressBatch?(batchId: Uuid): void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

interface ChangeLine {
  field: string;
  before: string;
  after: string;
}

export function EventTimeline({
  events,
  names,
  meId,
  lang,
  index,
  sourceNames,
  currency,
  onPressBatch,
  style,
  testID,
}: EventTimelineProps): React.JSX.Element {
  const { t } = useTranslation();
  const colors = useColors();
  const activeLang = useLang();
  const l = lang ?? activeLang;
  const [expanded, setExpanded] = React.useState<Record<string, boolean>>({});
  const id = testID ?? 'events';

  const ordered = React.useMemo(
    () => [...events].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)),
    [events],
  );

  function actorName(actorId: Uuid): string {
    if (actorId === meId) return t('transaction:detail.events_actor_me');
    return names[actorId] ?? shortId(actorId);
  }

  /** One changed field rendered the way 04 §4.7 asks: money and dates formatted, codes named. */
  function renderValue(field: string, raw: unknown): string {
    if (raw === null || raw === undefined) return t('common:status.none');
    const text = String(raw);
    switch (field) {
      case 'amount':
        return currency === undefined ? text : formatMoney(text, currency, l);
      case 'occurred_at':
        return formatDate(text, l);
      case 'category_l1':
      case 'category_l2': {
        const category = index?.byCode[text];
        return category ? categoryName(category, l) : text;
      }
      case 'source_id':
        return sourceNames?.[text] ?? text;
      case 'transfer_subtype':
        return t(`transaction:transfer.subtype.${text}`);
      default:
        return text;
    }
  }

  function changeLines(event: TransactionEvent): ChangeLine[] {
    if (!event.changes) return [];
    return Object.entries(event.changes).map(([field, delta]) => ({
      field: t(`transaction:detail.event_field.${field}`),
      before: renderValue(field, delta.before),
      after: renderValue(field, delta.after),
    }));
  }

  return (
    <View testID={id} style={[styles.wrap, style]}>
      {ordered.map((event) => {
        const lines = changeLines(event);
        const open = expanded[event.id] === true;
        const visible = open ? lines : lines.slice(0, CHANGES_COLLAPSE_AT);
        const batchId = event.import_batch_id;
        const batchLabel =
          batchId === null
            ? null
            : t('transaction:list.chip.from_batch', { batch: shortId(batchId) });
        return (
          <View key={event.id} style={styles.row} testID={`${id}-row-${event.id}`}>
            <View style={styles.head}>
              <Text variant="caption" tone="muted" mono>
                {formatDateTime(event.at, l)}
              </Text>
              <Text variant="caption" tone="secondary" numberOfLines={1} style={styles.actor}>
                {actorName(event.actor_id)}
              </Text>
              <Text variant="caption" testID={`${id}-action-${event.id}`}>
                {t(`transaction:detail.event.${event.event}`)}
              </Text>
            </View>

            {visible.map((line) => (
              <Text key={line.field} variant="caption" tone="secondary">
                {`${line.field} ${line.before} → ${line.after}`}
              </Text>
            ))}

            {lines.length > CHANGES_COLLAPSE_AT && !open ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => setExpanded((prev) => ({ ...prev, [event.id]: true }))}
                testID={`${id}-expand-${event.id}`}
              >
                <Text variant="caption" tone="accent">
                  {t('transaction:detail.events_collapsed', { count: lines.length })}
                </Text>
              </Pressable>
            ) : null}

            {/* A reverted (deleted) batch has no page left to open, so the caller drops
                `onPressBatch` and the mark degrades to plain text (04 §4.7). */}
            {batchId !== null && batchLabel !== null ? (
              onPressBatch ? (
                <Pressable
                  accessibilityRole="link"
                  accessibilityLabel={batchLabel}
                  onPress={() => onPressBatch(batchId)}
                  testID={`${id}-batch-${event.id}`}
                  style={({ pressed }) => [
                    styles.batch,
                    { backgroundColor: pressed ? colors['bg.hover'] : 'transparent' },
                  ]}
                >
                  <Text variant="caption" tone="accent">
                    {batchLabel}
                  </Text>
                </Pressable>
              ) : (
                <Text variant="caption" tone="muted" testID={`${id}-batch-${event.id}`}>
                  {batchLabel}
                </Text>
              )
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space['2'], alignSelf: 'stretch' },
  row: { minHeight: 44, gap: space['1'], paddingVertical: space['1'] },
  head: { flexDirection: 'row', alignItems: 'center', gap: space['2'] },
  actor: { maxWidth: density.listRowHeight * 2 },
  batch: { alignSelf: 'flex-start', borderRadius: radius.sm },
});
