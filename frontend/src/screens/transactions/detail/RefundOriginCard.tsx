/**
 * 「原支出」 — the original expense behind a refund (04 §4.7, decisions §14.46 04-D-6,
 * §14.52 A25, §14.53f, 屏幕稿 08).
 *
 * Three states, and all three have to be distinguishable:
 *  - linked: a beige head carrying the summary row (icon, merchant, date · category, the
 *    amount) with 已退 / 可退 under it and 「改选」 / 「解除关联」 as links — both relations
 *    stay editable after an import (decision §14.34);
 *  - never linked (`refund_of === null`): 「未关联原支出」+「去关联」;
 *  - linked to something that has since been deleted (`refund_of` set, `refund_of_detail`
 *    null): 「原单已删除」, still offering to 「改选」 (re-point) or clear the dangling link.
 *
 * Under the head, `other_refunds[]` — the *other* refunds against the same original, oldest
 * first — so nobody registers the same refund twice. Those elements carry no `source_id`
 * (03 §5.27), so no account name is shown for them; the block disappears when empty.
 */
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import type { RefundOrigin, Uuid } from '@/api/types';
import type { CategoryIndex } from '@/domain/categories';
import { useLang } from '@/i18n';
import { categoryName } from '@/i18n/category';
import { formatDate, formatMoney } from '@/i18n/format';
import { radius, space } from '@/theme/tokens';
import { useColors, useTheme } from '@/theme/ThemeProvider';
import { Icon, Text, raisedShadow } from '@/ui';

import { ActionButton } from './ActionButton';
import { TintSideCard } from './parts';

export interface RefundOriginCardProps {
  refundOf: Uuid | null;
  origin: RefundOrigin | null | undefined;
  sourceNames: Readonly<Record<Uuid, string>>;
  index: CategoryIndex | null;
  onOpen(id: Uuid): void;
  /** Opens the picker — "去关联" when nothing is linked, "改选" when something is. */
  onPick(): void;
  onUnlink(): void;
  busy?: boolean;
  testID?: string;
}

/** `category_l1` / `category_l2` codes → "消费购物 / 数码"; also used by the detail header. */
export function categoryPath(
  index: CategoryIndex | null,
  l1: string | null,
  l2: string | null,
  lang: string,
): string | null {
  if (l1 === null) return null;
  const parent = index?.byCode[l1];
  if (!parent) return l1;
  const child = l2 === null ? null : index?.byCode[l2];
  const head = categoryName(parent, lang);
  return child ? `${head} / ${categoryName(child, lang)}` : head;
}

/** A text link in the beige head: a caption line is 16 tall, so 14 each side makes 44. */
function HeadLink({
  label,
  onPress,
  disabled,
  testID,
}: {
  label: string;
  onPress(): void;
  disabled: boolean;
  testID: string;
}): React.JSX.Element {
  return (
    // touch-target-exempt: a text link; `hitSlop` gives it the 44×44 target.
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={{ top: 14, bottom: 14, left: space['2'], right: space['2'] }}
      testID={testID}
    >
      <Text variant="caption" weight={600} tone={disabled ? 'muted' : 'warning'}>
        {label}
      </Text>
    </Pressable>
  );
}

export function RefundOriginCard({
  refundOf,
  origin,
  sourceNames,
  index,
  onOpen,
  onPick,
  onUnlink,
  busy = false,
  testID,
}: RefundOriginCardProps): React.JSX.Element {
  const { t } = useTranslation();
  const lang = useLang();
  const { colors, scheme } = useTheme();
  const id = testID ?? 'detail-origin';

  if (!origin) {
    // Never linked, or linked to a row that no longer exists — two different sentences.
    const deleted = refundOf !== null;
    return (
      <TintSideCard title={t('transaction:detail.original_title')} testID={id}>
        <Text variant="caption" tone="warning" testID={`${id}-none`}>
          {t(
            deleted ? 'transaction:detail.original_deleted' : 'transaction:detail.original_none',
          )}
        </Text>
        <View style={styles.actions}>
          <ActionButton
            testID={`${id}-pick`}
            tone="refund"
            icon="link"
            // A dangling link is re-pointed, not linked for the first time: 「改选」.
            label={t(
              deleted
                ? 'transaction:detail.original_relink_action'
                : 'transaction:detail.original_link_action',
            )}
            onPress={onPick}
            disabled={busy}
          />
          {deleted ? (
            <ActionButton
              testID={`${id}-unlink`}
              tone="neutral"
              icon="unlink"
              label={t('transaction:detail.original_unlink_action')}
              onPress={onUnlink}
              disabled={busy}
            />
          ) : null}
        </View>
      </TintSideCard>
    );
  }

  const account = sourceNames[origin.source_id] ?? null;
  const category = categoryPath(index, origin.category_l1, origin.category_l2, lang);
  const others = [...origin.other_refunds].sort((a, b) =>
    a.occurred_at < b.occurred_at ? -1 : a.occurred_at > b.occurred_at ? 1 : 0,
  );

  return (
    <View
      testID={id}
      style={[
        styles.card,
        raisedShadow(colors, scheme),
        { backgroundColor: colors['bg.raised'] },
      ]}
    >
      <View style={[styles.head, { backgroundColor: colors['status.warning.bg'] }]}>
        <View style={styles.headRow}>
          <Text variant="subheading" weight={700} style={styles.headTitle} accessibilityRole="header">
            {t('transaction:detail.original_title')}
          </Text>
          <HeadLink
            testID={`${id}-pick`}
            label={t('transaction:detail.original_relink_action')}
            onPress={onPick}
            disabled={busy}
          />
          <HeadLink
            testID={`${id}-unlink`}
            label={t('transaction:detail.original_unlink_action')}
            onPress={onUnlink}
            disabled={busy}
          />
        </View>

        {/* touch-target-exempt: `styles.origin` is 52 tall and stretches the head's width. */}
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={origin.merchant ?? t('transaction:detail.original_title')}
          testID={`${id}-open`}
          onPress={() => onOpen(origin.id)}
          style={({ pressed }) => [
            styles.origin,
            { backgroundColor: pressed ? colors['bg.hover'] : 'transparent' },
          ]}
        >
          <View style={[styles.well, { backgroundColor: colors['kind.expense.subtle'] }]}>
            <Icon name="arrow-down" size={16} color={colors['kind.expense']} />
          </View>
          <View style={styles.originMain}>
            <Text variant="body" weight={500} numberOfLines={1} testID={`${id}-merchant`}>
              {origin.merchant ?? formatDate(origin.occurred_at, lang)}
            </Text>
            <Text variant="caption" tone="warning" mono numberOfLines={1} testID={`${id}-meta`}>
              {[formatDate(origin.occurred_at, lang), category, account]
                .filter((s): s is string => Boolean(s))
                .join(' · ')}
            </Text>
          </View>
          <Text variant="body" tone="expense" mono weight={500} testID={`${id}-amount`}>
            {formatMoney(origin.amount, origin.currency, lang)}
          </Text>
        </Pressable>

        <Text
          variant="caption"
          tone="warning"
          mono
          weight={500}
          style={styles.summary}
          testID={`${id}-summary`}
        >
          {t('transaction:detail.refunds_summary', {
            refunded: formatMoney(origin.refunded_total, origin.currency, lang, {
              signDisplay: 'never',
            }),
            refundable: formatMoney(origin.refundable, origin.currency, lang),
          })}
        </Text>
      </View>

      {others.length > 0 ? (
        <View style={styles.others} testID={`${id}-others`}>
          <Text variant="micro" tone="muted" mono weight={600}>
            {t('transaction:detail.other_refunds_title')}
          </Text>
          {others.map((r) => (
            <View key={r.id} style={styles.otherRow} testID={`${id}-other-${r.id}`}>
              <Text variant="caption" tone="secondary" mono>
                {formatDate(r.occurred_at, lang)}
              </Text>
              <Text variant="caption" tone="muted" numberOfLines={1} style={styles.otherNote}>
                {r.note ?? ''}
              </Text>
              <Text variant="caption" tone="refund" mono weight={500}>
                {formatMoney(r.amount, r.currency, lang)}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.lg, overflow: 'hidden', alignSelf: 'stretch' },
  head: { padding: space['4'] + 2, gap: space['2'] + 2 },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: space['3'] },
  headTitle: { flex: 1, minWidth: 0 },
  origin: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space['3'],
    minHeight: 52,
    paddingVertical: space['1'],
    paddingHorizontal: space['1'],
    borderRadius: radius.sm,
  },
  well: {
    width: 32,
    height: 32,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  originMain: { flex: 1, minWidth: 0, gap: 1 },
  summary: { alignSelf: 'stretch', textAlign: 'right' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space['2'] },
  others: { gap: space['1'], padding: space['4'] },
  otherRow: { flexDirection: 'row', alignItems: 'center', gap: space['2'], minHeight: 24 },
  otherNote: { flex: 1, minWidth: 0 },
});
