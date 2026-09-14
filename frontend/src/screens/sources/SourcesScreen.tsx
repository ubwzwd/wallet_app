/**
 * `/l/:ledgerId/sources` (04 §4.8): every account in the ledger, grouped by type.
 *
 * Three numbers on top — assets / liabilities / net worth, the same reading as the home
 * page (decision §7, §14.50) — then one group per type in the frozen §14.48 order, each
 * with its converted subtotal, and the archived accounts folded away at the bottom.
 *
 * The list is always fetched with `include_archived=1`: the folded section has to name how
 * many archived accounts there are before it is opened, and `sumSources` leaves archived
 * accounts out of the three numbers regardless of whether they were fetched. The
 * `?include_archived=1` **URL** parameter therefore only decides whether the section is
 * open, and is kept in sync so the state survives a reload or a shared link.
 */
import React from 'react';
import { Pressable, View } from 'react-native';
import { type Href, useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { isApiClientError } from '@/api/errors';
import type { FinanceSource } from '@/api/types';
import { absMoney, isZeroMoney } from '@/domain/money';
import { SOURCE_TYPE_ORDER, sumSources } from '@/domain/networth';
import { routes } from '@/domain/routes';
import { formatMoney } from '@/i18n/format';
import { useLang } from '@/i18n';
import { useTopBar } from '@/navigation';
import { useDeleteSource, useSources } from '@/queries';
import { useLedgerContext } from '@/store';
import { density, radius, space } from '@/theme/tokens';
import { useColors } from '@/theme/ThemeProvider';
import { useIsWide } from '@/theme/useBreakpoint';
import {
  Button,
  Card,
  EmptyState,
  Icon,
  Page,
  Skeleton,
  StatTile,
  Text,
  confirm,
  toast,
} from '@/ui';

import { SourceGroup, SourceRow } from './SourceGroup';

/** Skeleton cards while `GET /ledgers/{id}/sources` is in flight. */
const SKELETON_CARDS = 3;

/** The server's refusal when an account still has transactions (decision §3). */
const HAS_TRANSACTIONS = 'source_has_transactions';

export default function SourcesScreen(): React.JSX.Element {
  const { t } = useTranslation();
  const lang = useLang();
  const colors = useColors();
  const router = useRouter();
  const wide = useIsWide();
  const { ledgerId, baseCurrency } = useLedgerContext();
  // The narrow layout carries the page title in the top bar (04 §1.4); the wide one has
  // no top bar, so there the heading below is the only one.
  useTopBar(t('source:list.title'));
  const params = useLocalSearchParams<{ include_archived?: string | string[] }>();
  const rawFlag = Array.isArray(params.include_archived)
    ? params.include_archived[0]
    : params.include_archived;
  const showArchived = rawFlag === '1';

  const query = useSources(ledgerId, { include_archived: true });
  const remove = useDeleteSource(ledgerId);
  const [deleteBlockedId, setDeleteBlockedId] = React.useState<string | null>(null);

  const goNew = React.useCallback(
    () => router.push(routes.l(ledgerId).sourceNew() as Href),
    [ledgerId, router],
  );
  const openSource = React.useCallback(
    (source: FinanceSource) =>
      router.push(routes.l(ledgerId).sourceEdit(source.id) as Href),
    [ledgerId, router],
  );
  const toggleArchived = React.useCallback(
    () => router.replace(routes.l(ledgerId).sources(!showArchived) as Href),
    [ledgerId, router, showArchived],
  );

  const onDelete = React.useCallback(
    async (source: FinanceSource): Promise<void> => {
      const ok = await confirm({
        title: t('source:list.delete_confirm_title'),
        body: t('source:list.delete_confirm'),
        confirmLabel: t('source:list.delete_action'),
        tone: 'danger',
        doubleTap: true,
      });
      if (!ok) return;
      try {
        await remove.mutateAsync(source.id);
      } catch (e) {
        // The global toast already carried the error copy (04 §3.9); the row additionally
        // explains the one failure the user can act on — archive it instead (decision §3).
        if (isApiClientError(e) && e.code === HAS_TRANSACTIONS) setDeleteBlockedId(source.id);
        return;
      }
      setDeleteBlockedId(null);
      toast.success(t('source:list.deleted_toast', { name: source.name }));
    },
    [remove, t],
  );

  const header = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space['2'], flexWrap: 'wrap' }}>
      {wide ? (
        <Text variant="title" accessibilityRole="header" style={{ flex: 1 }} testID="sources-title">
          {t('source:list.title')}
        </Text>
      ) : (
        <View style={{ flex: 1 }} />
      )}
      <Button
        testID="sources-new"
        label={t('source:list.new_button')}
        icon="plus"
        size="sm"
        onPress={goNew}
      />
    </View>
  );

  if (query.isPending) {
    return (
      <Page testID="sources-screen">
        {header}
        {Array.from({ length: SKELETON_CARDS }, (_, i) => (
          <Skeleton key={i} variant="card" testID={`source-skeleton-${i}`} />
        ))}
      </Page>
    );
  }

  if (query.isError) {
    return (
      <Page testID="sources-screen">
        {header}
        <EmptyState
          icon="alert-triangle"
          title={t('source:list.error_retry')}
          primaryAction={{ label: t('common:button.retry'), onPress: () => void query.refetch() }}
          testID="sources-error"
        />
      </Page>
    );
  }

  const items = query.data?.items ?? [];

  if (items.length === 0) {
    return (
      <Page testID="sources-screen">
        <EmptyState
          icon="wallet"
          title={t('source:list.empty.title')}
          primaryAction={{ label: t('source:list.empty.button'), onPress: goNew }}
          testID="sources-empty"
        />
      </Page>
    );
  }

  const summary = sumSources(items);
  const active = items.filter((s) => !s.archived);
  const archived = items.filter((s) => s.archived);

  return (
    <Page testID="sources-screen">
      {header}
      <View
        style={{
          flexDirection: wide ? 'row' : 'column',
          gap: density.cardGap,
        }}
      >
        <StatTile
          testID="sources-assets"
          label={t('source:list.assets')}
          value={formatMoney(summary.assets, baseCurrency, lang)}
          style={{ flex: wide ? 1 : undefined }}
        />
        <StatTile
          testID="sources-liabilities"
          label={t('source:list.liabilities')}
          value={formatMoney(absMoney(summary.liabilities), baseCurrency, lang)}
          tone={isZeroMoney(summary.liabilities) ? 'primary' : 'expense'}
          style={{ flex: wide ? 1 : undefined }}
        />
        <StatTile
          testID="sources-net-worth"
          label={t('source:list.net_worth')}
          value={formatMoney(summary.net, baseCurrency, lang)}
          sub={
            summary.archivedCount > 0
              ? t('source:list.excluded_archived', { count: summary.archivedCount })
              : undefined
          }
          style={{ flex: wide ? 1 : undefined }}
        />
      </View>
      {summary.unconvertibleCount > 0 ? (
        <Text variant="caption" tone="warning" testID="sources-no-rate">
          {t('source:list.no_rate_hint', { count: summary.unconvertibleCount })}
        </Text>
      ) : null}

      {SOURCE_TYPE_ORDER.filter((type) => active.some((s) => s.type === type)).map((type) => (
        <SourceGroup
          key={type}
          type={type}
          sources={active.filter((s) => s.type === type)}
          subtotal={summary.byType[type].subtotal}
          baseCurrency={baseCurrency}
          onOpen={openSource}
          onDelete={(s) => void onDelete(s)}
          deleteBlockedId={deleteBlockedId}
          wide={wide}
        />
      ))}

      {archived.length > 0 ? (
        <Card variant="outlined" style={{ gap: space['2'] }} testID="sources-archived-section">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              showArchived
                ? t('source:list.archived_collapse')
                : t('source:list.archived_expand')
            }
            accessibilityState={{ expanded: showArchived }}
            onPress={toggleArchived}
            testID="sources-archived-toggle"
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              gap: space['2'],
              borderRadius: radius.md,
              backgroundColor: pressed ? colors['bg.hover'] : 'transparent',
            })}
          >
            <Icon name={showArchived ? 'chevron-down' : 'chevron-right'} />
            <Text variant="heading" style={{ flex: 1 }}>
              {t('source:list.archived_section', { count: archived.length })}
            </Text>
          </Pressable>
          {showArchived
            ? archived.map((source) => (
                <SourceRow
                  key={source.id}
                  source={source}
                  baseCurrency={baseCurrency}
                  onOpen={openSource}
                  onDelete={(s) => void onDelete(s)}
                  deleteBlocked={deleteBlockedId === source.id}
                  wide={wide}
                />
              ))
            : null}
        </Card>
      ) : null}
    </Page>
  );
}
