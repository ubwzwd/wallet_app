/**
 * `/accounts` (04 §4.8, decision §14.62), drawn against 屏幕稿 09.
 *
 * My own accounts: an account belongs to its owner and is shared into ledgers, so this page
 * lives outside any ledger. The three numbers — assets, liabilities, net worth — are the
 * server's (`GET /sources`, in my base currency), never summed here; each active account
 * carries a 「共享到」 chip per ledger I belong to.
 *
 * Wide: a page header — 「账户」 + 「4 个在用 · 2 个已归档 · 净资产 ¥34,627.10」 + 「＋ 新建账户」
 * — over one white table whose foot strip carries 「合计 · 在用」. Narrow: the net-worth card
 * the mockup draws, then one white card per account type with its converted subtotal
 * (decision §14.50). Both end with the folded 「已归档账户」 block.
 *
 * The list is always fetched with `include_archived=1`: the folded section has to name how
 * many archived accounts there are before it is opened, and the server leaves archived
 * accounts out of the three numbers regardless of whether they were fetched. The
 * `?include_archived=1` **URL** parameter is an entry parameter only (decision §14.66 j):
 * the home page's 「不含 N 个已归档账户」 opens the page with the section unfolded, the page
 * reads it once, and folding or unfolding it afterwards is component state — the address
 * is never rewritten, so it leaves no history entry.
 */
import React from 'react';
import { View } from 'react-native';
import { type Href, useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { isApiClientError } from '@/api/errors';
import type { FinanceSource } from '@/api/types';
import { SOURCE_TYPE_ORDER } from '@/domain/networth';
import { routes } from '@/domain/routes';
import { formatAmountPlain, formatMoney } from '@/i18n/format';
import { useLang } from '@/i18n';
import { useTopBar } from '@/navigation';
import { useDeleteSource, useLedgers, useMySources } from '@/queries';
import { useOptionalLedgerContext } from '@/store';
import { space } from '@/theme/tokens';
import { useIsWide } from '@/theme/useBreakpoint';
import { Button, EmptyState, Page, PageHeader, Skeleton, Text, confirm, toast } from '@/ui';

import { ArchivedPanel } from './ArchivedPanel';
import { NetWorthCard } from './NetWorthCard';
import { SourceGroup } from './SourceGroup';
import { SourcesTable } from './SourcesTable';
import { currencyCount, groupSubtotal } from './sourceFormat';
import { useShareToggle } from './useShareToggle';

/** Skeleton cards while `GET /sources` is in flight. */
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
  // Only a default: a new account opened from inside a ledger starts shared into it.
  const ledgerId = useOptionalLedgerContext()?.ledgerId;
  // The narrow layout carries the page title in the top bar (04 §1.4); the wide one has no
  // top bar, so there the `PageHeader` below is the only place it is written.
  useTopBar(t('source:list.title'));
  const params = useLocalSearchParams<{ include_archived?: string | string[] }>();
  const rawFlag = Array.isArray(params.include_archived)
    ? params.include_archived[0]
    : params.include_archived;
  // Read on entry, then the page's own (§14.66 j).
  const [showArchived, setShowArchived] = React.useState(() => rawFlag === '1');

  const query = useMySources({ include_archived: true });
  const ledgers = useLedgers();
  const share = useShareToggle(ledgers.data?.items ?? []);
  const remove = useDeleteSource();
  const [deleteBlockedId, setDeleteBlockedId] = React.useState<string | null>(null);

  const goNew = React.useCallback(
    () => router.push(routes.accountNew(ledgerId) as Href),
    [ledgerId, router],
  );
  const openSource = React.useCallback(
    (source: FinanceSource) => router.push(routes.accountEdit(source.id) as Href),
    [router],
  );
  const toggleArchived = React.useCallback(() => setShowArchived((open) => !open), []);

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
  // My base currency — the one the server converted every balance and total into.
  const baseCurrency = query.data?.base_currency ?? '';
  const netWorth = query.data?.net_worth ?? null;
  const active = byType(items.filter((s) => !s.archived));
  const archived = byType(items.filter((s) => s.archived));
  const unconvertible = active.filter((s) => s.balance_base === null).length;
  const totalText = (amount: string | null, format: (m: string) => string): string =>
    amount === null ? t('source:list.total_unavailable') : format(amount);

  /** 屏幕稿 09: 「4 个在用 · 2 个已归档 · 净资产 ¥34,627.10」 on the title's baseline. */
  const meta = [
    t('source:list.meta_active', { count: active.length }),
    archived.length > 0 ? t('source:list.meta_archived', { count: archived.length }) : null,
    // 「净资产 SGD 0.00」 with no accounts is noise, not information — the same rule
    // 屏幕稿 15 applies to the empty transaction list's stat line.
    items.length === 0
      ? null
      : t('source:list.meta_net_worth', {
          amount: totalText(netWorth, (m) => formatMoney(m, baseCurrency, lang)),
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
    // The wide header already carries a 「新建账户」 button; a second identical primary
    // button inside the empty state would put the same call to action on screen twice.
    return (
      <Page testID="sources-screen">
        {header}
        <EmptyState
          icon="wallet"
          title={t('source:list.empty.title')}
          primaryAction={
            wide ? undefined : { label: t('source:list.empty.button'), onPress: goNew }
          }
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
          assets={query.data.assets}
          liabilities={query.data.liabilities}
          netWorth={netWorth}
          archivedCount={archived.length}
          baseCurrency={baseCurrency}
          lang={lang}
          onNew={goNew}
        />
      )}

      {unconvertible > 0 ? (
        <Text variant="caption" tone="warning" testID="sources-no-rate">
          {t('source:list.no_rate_hint', { count: unconvertible })}
        </Text>
      ) : null}

      {wide ? (
        <SourcesTable
          sources={active}
          // Bare digits, like every other number in the table's two money columns
          // (屏幕稿 09: 「34,627.10」); the page header's meta keeps its ¥.
          total={totalText(netWorth, (m) => formatAmountPlain(m, baseCurrency))}
          mixed={currencyCount(active) > 1}
          share={share}
          {...rowProps}
        />
      ) : (
        <View style={{ gap: space['4'] }}>
          {SOURCE_TYPE_ORDER.filter((type) => active.some((s) => s.type === type)).map((type) => (
            <SourceGroup
              key={type}
              type={type}
              sources={active.filter((s) => s.type === type)}
              subtotal={groupSubtotal(active.filter((s) => s.type === type))}
              share={share}
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
