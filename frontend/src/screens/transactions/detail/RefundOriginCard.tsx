/**
 * The original expense behind a refund (04 §4.7, decisions §14.46 04-D-6, §14.52 A25, §14.53f).
 *
 * Three states, and all three have to be distinguishable:
 *  - linked: the summary card (date, merchant, amount, account, category, 已退 / 可退), with
 *    「解除关联」and「改选」— both relations stay editable after an import (decision §14.34);
 *  - never linked (`refund_of === null`): 「未关联原支出」+「去关联」;
 *  - linked to something that has since been deleted (`refund_of` set, `refund_of_detail`
 *    null): 「原单已删除」, still offering to re-point or clear the dangling link.
 *
 * Under the card, `other_refunds[]` — the *other* refunds against the same original, oldest
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
import { useColors } from '@/theme/ThemeProvider';
import { Button, Card, Text } from '@/ui';

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
  const colors = useColors();
  const id = testID ?? 'detail-origin';

  const title = (
    <Text variant="subheading" accessibilityRole="header">
      {t('transaction:detail.original_title')}
    </Text>
  );

  if (!origin) {
    // Never linked, or linked to a row that no longer exists — two different sentences.
    const deleted = refundOf !== null;
    return (
      <Card testID={id} style={styles.card}>
        {title}
        <Text variant="body" tone={deleted ? 'warning' : 'muted'} testID={`${id}-none`}>
          {t(
            deleted
              ? 'transaction:detail.original_deleted'
              : 'transaction:detail.original_none',
          )}
        </Text>
        <View style={styles.actions}>
          <Button
            testID={`${id}-pick`}
            variant="secondary"
            size="sm"
            label={t('transaction:detail.original_link_action')}
            onPress={onPick}
            disabled={busy}
          />
          {deleted ? (
            <Button
              testID={`${id}-unlink`}
              variant="ghost"
              size="sm"
              label={t('transaction:detail.original_unlink_action')}
              onPress={onUnlink}
              disabled={busy}
            />
          ) : null}
        </View>
      </Card>
    );
  }

  const account = sourceNames[origin.source_id] ?? null;
  const category = categoryPath(index, origin.category_l1, origin.category_l2, lang);
  const others = [...origin.other_refunds].sort((a, b) =>
    a.occurred_at < b.occurred_at ? -1 : a.occurred_at > b.occurred_at ? 1 : 0,
  );

  return (
    <Card testID={id} style={styles.card}>
      {title}

      <Pressable
        accessibilityRole="link"
        accessibilityLabel={origin.merchant ?? t('transaction:detail.original_title')}
        testID={`${id}-open`}
        onPress={() => onOpen(origin.id)}
        style={({ pressed }) => [
          styles.origin,
          {
            borderColor: colors['border.default'],
            backgroundColor: pressed ? colors['bg.hover'] : 'transparent',
          },
        ]}
      >
        <View style={styles.originMain}>
          <Text variant="body" testID={`${id}-merchant`}>
            {origin.merchant ?? formatDate(origin.occurred_at, lang)}
          </Text>
          <Text variant="caption" tone="muted" testID={`${id}-meta`}>
            {[formatDate(origin.occurred_at, lang), category, account]
              .filter((s): s is string => Boolean(s))
              .join(' · ')}
          </Text>
        </View>
        <Text variant="body" tone="expense" mono testID={`${id}-amount`}>
          {formatMoney(origin.amount, origin.currency, lang)}
        </Text>
      </Pressable>

      <Text variant="caption" tone="secondary" testID={`${id}-summary`}>
        {t('transaction:detail.refunds_summary', {
          refunded: formatMoney(origin.refunded_total, origin.currency, lang, {
            signDisplay: 'never',
          }),
          refundable: formatMoney(origin.refundable, origin.currency, lang),
        })}
      </Text>

      <View style={styles.actions}>
        <Button
          testID={`${id}-pick`}
          variant="secondary"
          size="sm"
          label={t('transaction:detail.original_relink_action')}
          onPress={onPick}
          disabled={busy}
        />
        <Button
          testID={`${id}-unlink`}
          variant="ghost"
          size="sm"
          label={t('transaction:detail.original_unlink_action')}
          onPress={onUnlink}
          disabled={busy}
        />
      </View>

      {others.length > 0 ? (
        <View style={styles.others} testID={`${id}-others`}>
          <Text variant="caption" tone="muted">
            {t('transaction:detail.other_refunds_title')}
          </Text>
          {others.map((r) => (
            <View key={r.id} style={styles.otherRow} testID={`${id}-other-${r.id}`}>
              <Text variant="caption" mono>
                {formatDate(r.occurred_at, lang)}
              </Text>
              <Text variant="caption" tone="muted" numberOfLines={1} style={styles.otherNote}>
                {r.note ?? ''}
              </Text>
              <Text variant="caption" tone="refund" mono>
                {formatMoney(r.amount, r.currency, lang)}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: space['2'], alignSelf: 'stretch' },
  origin: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space['3'],
    minHeight: 44,
    padding: space['2'],
    borderWidth: 1,
    borderRadius: radius.md,
  },
  originMain: { flex: 1, gap: 2 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space['2'] },
  others: { gap: space['1'], alignSelf: 'stretch' },
  otherRow: { flexDirection: 'row', alignItems: 'center', gap: space['2'] },
  otherNote: { flex: 1 },
});
