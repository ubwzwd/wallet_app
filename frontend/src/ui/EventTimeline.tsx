/**
 * Operations timeline on the transaction detail page (04 §4.7; decision §14.51).
 *
 * Newest first, drawn the way mockups 07 / 08 draw it: an 8px dot in the gutter, then
 * 「手动录入 · 我」 at 13/19, then the time underneath in small muted mono, then whatever
 * that entry changed. The newest dot is solid `accent.solid`; the older ones step back to
 * `border.strong`, so the reader's eye lands on the last thing that happened.
 *
 * People come from the member list (`names`), you are "我"; a member who left the ledger
 * keeps their name, nothing is anonymised. `client` is deliberately not rendered — this
 * release only has a web client (decision §0.1), so showing it would be noise.
 */
import React from 'react';
import { Pressable, type StyleProp, StyleSheet, View, type ViewStyle } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { TransactionEvent, Uuid } from '@/api/types';
import type { CategoryIndex } from '@/domain/categories';
import { type Lang, useLang } from '@/i18n';
import { categoryName } from '@/i18n/category';
import { formatDate, formatDateTimeShort, formatMoney } from '@/i18n/format';
import { radius, space } from '@/theme/tokens';
import { useColors } from '@/theme/ThemeProvider';
import { Text } from './Text';

/** More changed fields than this collapse behind "共 N 处改动，展开" (04 §4.7). */
export const CHANGES_COLLAPSE_AT = 3;

/** Short form of a batch id, the `#` number in "来自导入 #12". */
export function shortId(id: Uuid): string {
  return id.slice(0, 8);
}

/**
 * The backend can report a change on any of its `SINGLE_FIELDS`, which is wider than the
 * `transaction:detail.event_field.*` block. For the fields the language pack names under
 * another key we reuse that name; anything still missing degrades to the bare field name,
 * so a namespaced i18n key can never reach the screen.
 */
export const EVENT_FIELD_ALIASES: Readonly<Record<string, string>> = {
  kind: 'transaction:list.filter.kind_label',
  currency: 'transaction:form.currency',
  counterparty: 'transaction:transfer.counterparty_label',
  refund_of: 'transaction:form.refund_of',
};

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
  /** Raw field name, used as the React key. */
  field: string;
  /** Translated field name shown to the reader. */
  name: string;
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
        return formatDate(text);
      case 'category_l1':
      case 'category_l2': {
        const category = index?.byCode[text];
        return category ? categoryName(category, l) : text;
      }
      case 'source_id':
        return sourceNames?.[text] ?? text;
      case 'transfer_subtype':
        return t(`transaction:transfer.subtype.${text}`);
      case 'transfer_role':
        return t(`transaction:transfer.role.${text}`);
      case 'kind':
        // Changing kind between the three non-transfer kinds is a supported edit
        // (04 §4.6.6), so the old/new value must read as 支出 / 退款, not as a code.
        return t(`transaction:kind.${text}`);
      case 'refund_of':
        return shortId(text);
      default:
        return text;
    }
  }

  /** Never returns a raw i18n key: unknown fields fall back to their own name. */
  function fieldName(field: string): string {
    const keys = [`transaction:detail.event_field.${field}`];
    const alias = EVENT_FIELD_ALIASES[field];
    if (alias !== undefined) keys.push(alias);
    return t(keys, { defaultValue: field });
  }

  function changeLines(event: TransactionEvent): ChangeLine[] {
    if (!event.changes) return [];
    return Object.entries(event.changes).map(([field, delta]) => ({
      field,
      name: fieldName(field),
      before: renderValue(field, delta.before),
      after: renderValue(field, delta.after),
    }));
  }

  return (
    <View testID={id} style={[styles.wrap, style]}>
      {ordered.map((event, position) => {
        const lines = changeLines(event);
        const open = expanded[event.id] === true;
        const visible = open ? lines : lines.slice(0, CHANGES_COLLAPSE_AT);
        const batchId = event.import_batch_id;
        const batchLabel =
          batchId === null
            ? null
            : t('transaction:list.chip.from_batch', { batch: shortId(batchId) });
        const newest = position === 0;
        return (
          <View key={event.id} style={styles.row} testID={`${id}-row-${event.id}`}>
            <View
              testID={`${id}-dot-${event.id}`}
              style={[
                styles.dot,
                {
                  backgroundColor: newest ? colors['accent.solid'] : colors['border.strong'],
                },
              ]}
            />
            <View style={styles.body}>
              {/* 「手动录入 · 我」 — one line, the way the mockup writes it. */}
              <Text weight={500} style={styles.title} testID={`${id}-action-${event.id}`}>
                {`${t(`transaction:detail.event.${event.event}`)} · ${actorName(event.actor_id)}`}
              </Text>
              <Text mono tone="muted" style={styles.meta} testID={`${id}-at-${event.id}`}>
                {formatDateTimeShort(event.at)}
              </Text>

              {visible.map((line) => (
                <Text key={line.field} variant="caption" tone="secondary">
                  {`${line.name} ${line.before} → ${line.after}`}
                </Text>
              ))}

              {lines.length > CHANGES_COLLAPSE_AT && !open ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setExpanded((prev) => ({ ...prev, [event.id]: true }))}
                  testID={`${id}-expand-${event.id}`}
                  hitSlop={space['3']}
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
                    hitSlop={space['3']}
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
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  // Mockups 07 / 08: 12 between entries, a 10 gutter between the dot and the text.
  wrap: { gap: space['3'], alignSelf: 'stretch' },
  row: { flexDirection: 'row', gap: 10, alignSelf: 'stretch' },
  // The dot hangs beside the first line rather than centring on the whole entry.
  dot: { width: 8, height: 8, borderRadius: radius.pill, flexShrink: 0, marginTop: 6 },
  body: { flex: 1, minWidth: 0, gap: space['1'] },
  title: { fontSize: 13, lineHeight: 19 },
  meta: { fontSize: 12, lineHeight: 17 },
  batch: { alignSelf: 'flex-start', borderRadius: radius.sm },
});
