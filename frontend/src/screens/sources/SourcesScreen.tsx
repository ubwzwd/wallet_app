/**
 * `/l/:ledgerId/sources` (04 §4.8), rebuilt against 屏幕稿 09.
 *
 * Wide: a page header — 「账户」 + 「4 个在用 · 2 个已归档 · 净资产 ¥34,627.10」 + 「＋ 新建账户」
 * — over one white table whose foot strip carries 「合计 · 在用」. Narrow: the net-worth card
 * the mockup draws, then one white card per account type with its converted subtotal
 * (decision §14.50). Both end with the folded 「已归档账户」 block.
 *
 * The list is always fetched with `include_archived=1`: the folded section has to name how
 * many archived accounts there are before it is opened, and `sumSources` leaves archived
 * accounts out of the three numbers regardless of whether they were fetched. The
 * `?include_archived=1` **URL** parameter therefore only decides whether the section is
 * open, and is kept in sync so the state survives a reload or a shared link.
 */
import React from 'react';
import { View } from 'react-native';
import { type Href, useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { isApiClientError } from '@/api/errors';
import type { FinanceSource } from '@/api/types';
import { SOURCE_TYPE_ORDER, sumSources } from '@/domain/networth';
import { routes } from '@/domain/routes';
import { formatMoney } from '@/i18n/format';
import { useLang } from '@/i18n';
import { useTopBar } from '@/navigation';
import { useDeleteSource, useSources } from '@/queries';
import { useLedgerContext } from '@/store';
import { space } from '@/theme/tokens';
import { useIsWide } from '@/theme/useBreakpoint';
import { Button, EmptyState, Page, PageHeader, Skeleton, Text, confirm, toast } from '@/ui';

import { ArchivedPanel } from './ArchivedPanel';
import { NetWorthCard } from './NetWorthCard';
import { SourceGroup } from './SourceGroup';
import { SourcesTable } from './SourcesTable';
import { currencyCount } from './sourceFormat';

/** Skeleton cards while `GET /ledgers/{id}/sources` is in flight. */
const SKELETON_CARDS = 3;

/** The server's refusal when an account still has transactions (decision §3). */
const HAS_TRANSACTIONS = 'source_has_transactions';

/**
 * Rows read in the frozen §14.48 type order — 储蓄卡 → 信用卡 → 现金 → 其他 — at both
 * widths: the narrow layout groups by type, and the wide table (屏幕稿 09 账户列表 1440)
 * has to list the same accounts in the same order. Within a type the server's order stands.
 */
function byType(sources: readonly FinanceSource[]): FinanceSource[] {
  return SOURCE_TYPE_ORDER.flatMap((type) => sources.filter((s) => s.type === type));
}

export default function SourcesScreen(): React.JSX.Element {
  const { t } = useTranslation();
  const lang = useLang();
  const router = useRouter();
  const wide = useIsWide();
  const { ledgerId, baseCurrency } = useLedgerContext();
  // The narrow layout carries the page title in the top bar (04 §1.4); the wide one has no
  // top bar, so there the `PageHeader` below is the only place it is written.
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
    (source: FinanceSource) => router.push(routes.l(ledgerId).sourceEdit(source.id) as Href),
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

  const items = query.data?.items ?? [];
  const summary = sumSources(items);
  const active = byType(items.filter((s) => !s.archived));
  const archived = byType(items.filter((s) => s.archived));

  /** 屏幕稿 09: 「4 个在用 · 2 个已归档 · 净资产 ¥34,627.10」 on the title's baseline. */
  const meta = [
    t('source:list.meta_active', { count: active.length }),
    archived.length > 0 ? t('source:list.meta_archived', { count: archived.length }) : null,
    t('source:list.meta_net_worth', {
      amount: formatMoney(summary.net, baseCurrency, lang),
    }),
  ]
    .filter((part): part is string => part !== null)
    .join(' · ');

  const header = wide ? (
    <PageHeader
      testID="sources"
      title={t('source:list.title')}
      meta={query.isSuccess ? meta : undefined}
      actions={
        <Button
          testID="sources-new"
          label={t('source:list.new_button')}
          icon="plus"
          onPress={goNew}
        />
      }
    />
  ) : null;

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

  if (items.length === 0) {
    return (
      <Page testID="sources-screen">
        {header}
        <EmptyState
          icon="wallet"
          title={t('source:list.empty.title')}
          primaryAction={{ label: t('source:list.empty.button'), onPress: goNew }}
          testID="sources-empty"
        />
      </Page>
    );
  }

  const rowProps = {
    baseCurrency,
    lang,
    onOpen: openSource,
    onDelete: (s: FinanceSource) => void onDelete(s),
    deleteBlockedId,
  };

  return (
    <Page testID="sources-screen">
      {header}
      {wide ? null : (
        <NetWorthCard
          summary={summary}
          baseCurrency={baseCurrency}
          lang={lang}
          onNew={goNew}
        />
      )}

      {summary.unconvertibleCount > 0 ? (
        <Text variant="caption" tone="warning" testID="sources-no-rate">
          {t('source:list.no_rate_hint', { count: summary.unconvertibleCount })}
        </Text>
      ) : null}

      {wide ? (
        <SourcesTable
          sources={active}
          total={formatMoney(summary.net, baseCurrency, lang)}
          mixed={currencyCount(active) > 1}
          {...rowProps}
        />
      ) : (
        <View style={{ gap: space['4'] }}>
          {SOURCE_TYPE_ORDER.filter((type) => active.some((s) => s.type === type)).map((type) => (
            <SourceGroup
              key={type}
              type={type}
              sources={active.filter((s) => s.type === type)}
              subtotal={summary.byType[type].subtotal}
              {...rowProps}
            />
          ))}
        </View>
      )}

      {archived.length > 0 ? (
        <ArchivedPanel
          sources={archived}
          expanded={showArchived}
          onToggle={toggleArchived}
          {...rowProps}
        />
      ) : null}
    </Page>
  );
}
