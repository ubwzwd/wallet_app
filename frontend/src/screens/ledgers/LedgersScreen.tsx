/**
 * `/ledgers` (04 §4.3): every ledger the user belongs to.
 *
 * A card carries only what one `GET /ledgers` already knows — name, base currency, member
 * count, my role and when it last changed. No net worth and no transaction count
 * (decision §14.52 A16: both would cost one accounts+rates round trip per ledger).
 */
import React from 'react';
import { Pressable, View } from 'react-native';
import { type Href, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import type { Ledger } from '@/api/types';
import { routes } from '@/domain/routes';
import { formatRelativeDay } from '@/i18n/format';
import { useLang } from '@/i18n';
import { useLedgers } from '@/queries';
import { density, radius, space } from '@/theme/tokens';
import { useColors } from '@/theme/ThemeProvider';
import { Badge, Button, Card, EmptyState, Page, Skeleton, Text } from '@/ui';

/** Soft cap of decision §2: the 11th ledger is refused by the server. */
export const MAX_LEDGERS = 10;

/** Skeleton cards shown while `GET /ledgers` is in flight (04 §4.3). */
const SKELETON_CARDS = 3;

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** The local calendar day an `IsoDateTime` falls on — what the relative label needs. */
function localDayOf(isoDateTime: string): string {
  const d = new Date(isoDateTime);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function LedgerCard({ ledger, onPress }: { ledger: Ledger; onPress(): void }): React.JSX.Element {
  const { t } = useTranslation();
  const lang = useLang();
  const colors = useColors();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={ledger.name}
      onPress={onPress}
      testID={`ledger-card-${ledger.id}`}
      style={({ pressed }) => ({
        borderRadius: radius.lg,
        backgroundColor: pressed ? colors['bg.hover'] : 'transparent',
      })}
    >
      <Card variant="outlined" style={{ gap: space['2'] }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space['2'] }}>
          <Text variant="heading" numberOfLines={1} style={{ flex: 1 }}>
            {ledger.name}
          </Text>
          <Badge
            label={
              ledger.role === 'owner'
                ? t('ledger:list.card.role_owner')
                : t('ledger:list.card.role_member')
            }
            tone={ledger.role === 'owner' ? 'info' : 'neutral'}
            testID={`ledger-role-${ledger.id}`}
          />
        </View>
        <View
          style={{ flexDirection: 'row', alignItems: 'center', gap: space['3'], flexWrap: 'wrap' }}
        >
          <Text variant="caption" tone="secondary" mono>
            {ledger.base_currency}
          </Text>
          <Text variant="caption" tone="secondary">
            {t('ledger:list.card.member_count', { count: ledger.member_count })}
          </Text>
          <Text variant="caption" tone="muted">
            {t('ledger:list.card.updated_at', {
              time: formatRelativeDay(localDayOf(ledger.updated_at), lang),
            })}
          </Text>
        </View>
      </Card>
    </Pressable>
  );
}

export default function LedgersScreen(): React.JSX.Element {
  const { t } = useTranslation();
  const router = useRouter();
  const query = useLedgers();

  const goCreate = React.useCallback(
    () => router.push(routes.ledgersNew() as Href),
    [router],
  );
  const goJoin = React.useCallback(() => router.push(routes.ledgersJoin() as Href), [router]);

  if (query.isPending) {
    return (
      <Page testID="ledgers-screen">
        <Text variant="title" accessibilityRole="header">
          {t('ledger:list.title')}
        </Text>
        {Array.from({ length: SKELETON_CARDS }, (_, i) => (
          <Skeleton key={i} variant="card" testID={`ledger-skeleton-${i}`} />
        ))}
      </Page>
    );
  }

  if (query.isError) {
    return (
      <Page testID="ledgers-screen">
        <Text variant="title" accessibilityRole="header">
          {t('ledger:list.title')}
        </Text>
        <EmptyState
          icon="alert-triangle"
          title={t('ledger:list.error_retry')}
          primaryAction={{ label: t('common:button.retry'), onPress: () => void query.refetch() }}
          testID="ledgers-error"
        />
      </Page>
    );
  }

  const items = query.data?.items ?? [];

  if (items.length === 0) {
    return (
      <Page testID="ledgers-screen">
        <EmptyState
          icon="wallet"
          title={t('ledger:list.empty.title')}
          primaryAction={{ label: t('ledger:list.empty.create_button'), onPress: goCreate }}
          secondaryAction={{ label: t('ledger:list.empty.join_button'), onPress: goJoin }}
          testID="ledgers-empty"
        />
      </Page>
    );
  }

  const atLimit = items.length >= MAX_LEDGERS;

  return (
    <Page testID="ledgers-screen">
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: space['2'],
          flexWrap: 'wrap',
        }}
      >
        <Text variant="title" accessibilityRole="header" style={{ flex: 1 }}>
          {t('ledger:list.title')}
        </Text>
        <Button
          testID="ledgers-create"
          label={t('ledger:list.empty.create_button')}
          icon="plus"
          size="sm"
          onPress={goCreate}
          disabled={atLimit}
        />
        <Button
          testID="ledgers-join"
          label={t('ledger:list.empty.join_button')}
          variant="secondary"
          size="sm"
          onPress={goJoin}
        />
      </View>
      {atLimit ? (
        <Text variant="caption" tone="muted" testID="ledgers-limit-hint">
          {t('ledger:create.limit_reached')}
        </Text>
      ) : null}
      <View style={{ gap: density.cardGap }}>
        {items.map((ledger) => (
          <LedgerCard
            key={ledger.id}
            ledger={ledger}
            onPress={() => router.push(routes.l(ledger.id).home() as Href)}
          />
        ))}
      </View>
    </Page>
  );
}
