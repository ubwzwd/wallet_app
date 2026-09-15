/**
 * 交易详情 `/l/:ledgerId/transactions/:txId` (04 §4.7, 屏幕稿 07 单腿 / 08).
 *
 * One screen for expense / income / refund / single-leg transfer, laid out the way the
 * mockups draw it: a breadcrumb over a `minmax(0,1fr) 300px` grid — headline card and fact
 * list on the left, 「对 N 月的影响」 / 退款 / 操作记录 on the right. Narrow stacks the same
 * blocks and moves the operations into a sheet behind the pinned 「修改」 bar.
 *
 * `GET /transactions/{tid}` carries four extras over a list row (§3.3) and each one owns a
 * block here: `refunds[]` → `RefundsSection`, `refund_of_detail` → `RefundOriginCard`,
 * `events[]` → `EventsCard`, and `pair` → nothing, because a leg of a two-leg transfer is
 * not a page: it redirects to `/transfers/:pairId`, the only address that survives a
 * refresh or a shared link.
 *
 * The writes are one-shot: delete, and the refund link (PATCH `refund_of`, cleared or
 * re-pointed — decision §14.34 keeps both relations editable after an import). Neither
 * passes `{ silent: true }`: there is no form to render an error into, so the global
 * mutation toast (04 §3.9) is the right place, and a 409 is handled globally (04 §3.8).
 */
import React from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { Redirect, useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useTranslation } from 'react-i18next';

import type { FinanceSource, Uuid } from '@/api/types';
import { monthOf } from '@/domain/dates';
import { absMoney } from '@/domain/money';
import { routes } from '@/domain/routes';
import { useLang } from '@/i18n';
import { formatDate } from '@/i18n/format';
import { errorMessage } from '@/i18n/errorCodes';
import { useTopBar } from '@/navigation';
import {
  useCategories,
  useDeleteTransaction,
  useMemberNames,
  useMembers,
  useSources,
  useTransaction,
  useUpdateTransaction,
} from '@/queries';
import { useAuth, useLedgerContext } from '@/store';
import { space } from '@/theme/tokens';
import { useIsWide } from '@/theme/useBreakpoint';
import { EmptyState, Page, PageHeader, Skeleton, confirm, toast } from '@/ui';

import { TransactionPicker } from '../TransactionPicker';
import { DetailActions, type DetailAction } from './DetailActions';
import { EventsCard } from './EventsCard';
import { ImpactCard, SingleLegImpactCard } from './ImpactCard';
import { KeyFacts } from './KeyFacts';
import { PairSection } from './PairSection';
import { RefundOriginCard, categoryPath } from './RefundOriginCard';
import { RefundsSection } from './RefundsSection';
import type { SourceMap } from './TransferLegs';
import { TxHeadline } from './TxHeadline';
import { transactionFacts } from './facts';
import { DetailColumns } from './parts';

/** Every account of the ledger, archived ones included — a detail page shows history. */
export function useSourceMap(ledgerId: Uuid): SourceMap {
  const sources = useSources(ledgerId, { include_archived: true });
  const items = sources.data?.items;
  return React.useMemo(() => {
    const out: Record<Uuid, FinanceSource> = {};
    for (const s of items ?? []) out[s.id] = s;
    return out;
  }, [items]);
}

/** `source_id → name`, the lookup the pickers and the timeline need. */
export function useSourceNames(ledgerId: Uuid): Record<Uuid, string> {
  const map = useSourceMap(ledgerId);
  return React.useMemo(() => {
    const out: Record<Uuid, string> = {};
    for (const [id, s] of Object.entries(map)) out[id] = s.name;
    return out;
  }, [map]);
}

export default function TransactionDetailScreen(): React.JSX.Element {
  const { t } = useTranslation();
  const lang = useLang();
  const router = useRouter();
  const wide = useIsWide();
  const { ledgerId, baseCurrency } = useLedgerContext();
  const params = useLocalSearchParams<{ txId?: string }>();
  const txId = typeof params.txId === 'string' ? params.txId : '';

  const query = useTransaction(ledgerId, txId === '' ? undefined : txId);
  const tx = query.data;

  const sourceMap = useSourceMap(ledgerId);
  const sourceNames = useSourceNames(ledgerId);
  const { index } = useCategories();
  const memberNames = useMemberNames(ledgerId);
  const members = useMembers(ledgerId);
  const { user } = useAuth();

  const remove = useDeleteTransaction(ledgerId);
  const update = useUpdateTransaction(ledgerId, txId);
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [pairOpen, setPairOpen] = React.useState(false);

  // 屏幕稿 07 (decision B16) titles a single leg 「交易 · 9月5日 · 对方：工资卡」; everything
  // else names the merchant, which is what a breadcrumb is for.
  const singleLeg = tx !== undefined && tx.kind === 'transfer' && tx.transfer_pair_id === null;
  const crumb = tx
    ? [
        t('transaction:list.title'),
        ...(singleLeg
          ? [
              formatDate(tx.occurred_at, lang),
              t('transaction:list.row.counterparty', {
                name: tx.counterparty ?? t('transaction:detail.counterparty_external'),
              }),
            ]
          : [tx.merchant ?? formatDate(tx.occurred_at, lang)]),
      ].join(' · ')
    : t('transaction:list.title');
  useTopBar(crumb);

  const l = routes.l(ledgerId);

  const goList = React.useCallback((): void => {
    router.replace(l.transactions() as Href);
  }, [l, router]);

  /** Back where the reader came from; a deep link has nowhere to go back to. */
  const goBack = React.useCallback((): void => {
    if (router.canGoBack()) router.back();
    else goList();
  }, [goList, router]);

  const onDelete = React.useCallback((): void => {
    void confirm({
      title: t('transaction:list.delete_confirm'),
      tone: 'danger',
      confirmLabel: t('common:button.delete'),
      cancelLabel: t('common:button.cancel'),
    }).then((ok) => {
      if (!ok || txId === '') return;
      remove.mutate(txId, {
        onSuccess: () => {
          toast.success(t('transaction:list.deleted_toast'));
          goBack();
        },
      });
    });
  }, [goBack, remove, t, txId]);

  const setRefundOf = React.useCallback(
    (next: Uuid | null): void => {
      if (!tx) return;
      update.mutate(
        { refund_of: next, updated_at: tx.updated_at },
        { onSuccess: () => toast.success(t('transaction:detail.refund_link_saved')) },
      );
    },
    [t, tx, update],
  );

  const onUnlinkRefund = React.useCallback((): void => {
    void confirm({
      title: t('transaction:detail.original_unlink_action'),
      body: t('transaction:detail.original_unlink_confirm'),
      confirmLabel: t('transaction:detail.original_unlink_action'),
      cancelLabel: t('common:button.cancel'),
    }).then((ok) => {
      if (ok) setRefundOf(null);
    });
  }, [setRefundOf, t]);

  if (query.isError) {
    return (
      <Page testID="tx-detail">
        <EmptyState
          testID="tx-detail-error"
          icon="alert-triangle"
          title={errorMessage(t, query.error)}
          primaryAction={{ label: t('common:button.retry'), onPress: () => void query.refetch() }}
          secondaryAction={{ label: t('transaction:list.title'), onPress: goList }}
        />
      </Page>
    );
  }

  if (query.isPending || !tx) {
    return (
      <Page testID="tx-detail">
        <Skeleton variant="table" rows={6} testID="tx-detail-skeleton" />
      </Page>
    );
  }

  // A leg of a two-leg transfer has no page of its own: both legs live at the pair's URL.
  // `pair` is the expansion, `transfer_pair_id` the raw relation — either one being set
  // means this row is half of a pair, so neither may be trusted alone.
  const pairId = tx.pair?.pair_id ?? tx.transfer_pair_id;
  if (pairId !== null && pairId !== undefined) {
    return <Redirect href={l.transfer(pairId) as Href} />;
  }

  const isTransfer = tx.kind === 'transfer';
  const category = categoryPath(index, tx.category_l1, tx.category_l2, lang);
  const sheetTitle = t('transaction:detail.actions_sheet_title', {
    kind: t(`transaction:kind.${tx.kind}`),
  });

  const actions: DetailAction[] = [
    ...(isTransfer
      ? [
          {
            key: 'pair',
            label: t('transaction:detail.pair_action'),
            icon: 'link' as const,
            tone: 'primary' as const,
            hint: t('transaction:detail.pair_action_hint'),
            onPress: () => setPairOpen(true),
          },
        ]
      : []),
    {
      key: 'edit',
      label: t('common:button.edit'),
      icon: 'pencil',
      onPress: () => router.push(l.transactionEdit(tx.id) as Href),
    },
    ...(tx.kind === 'expense'
      ? [
          {
            key: 'refund',
            label: t('transaction:detail.refund_action'),
            icon: 'link' as const,
            tone: 'refund' as const,
            hint: t('transaction:detail.refund_action_hint'),
            onPress: () =>
              router.push(l.transactionNew({ kind: 'refund', refund_of: tx.id }) as Href),
          },
        ]
      : []),
    ...(isTransfer
      ? []
      : [
          {
            key: 'duplicate',
            label: t('transaction:detail.duplicate_action'),
            icon: 'copy' as const,
            hint: t('transaction:detail.duplicate_action_hint'),
            onPress: () => router.push(l.transactionNew({ copy_of: tx.id }) as Href),
          },
        ]),
    {
      key: 'delete',
      label: t('common:button.delete'),
      icon: 'trash-2',
      tone: 'danger',
      onPress: onDelete,
      loading: remove.isPending,
    },
  ];

  const facts = transactionFacts(
    {
      t,
      lang,
      baseCurrency,
      sources: sourceMap,
      members: members.data?.items ?? [],
      onOpenBatch: (batchId) => router.push(l.importBatch(batchId) as Href),
    },
    tx,
    category,
  );

  const actionBar = (
    <DetailActions actions={actions} sheetTitle={sheetTitle} testID="tx-detail-actions" />
  );

  const main = (
    <>
      <TxHeadline
        tx={tx}
        sources={sourceMap}
        category={category}
        baseCurrency={baseCurrency}
        actions={actionBar}
      />
      <KeyFacts facts={facts} testID="tx-detail-facts" />
    </>
  );

  const side = (
    <>
      {wide && isTransfer ? (
        <SingleLegImpactCard
          testID="tx-detail-impact"
          month={monthOf(tx.occurred_at)}
          amount={tx.amount_base ?? tx.amount}
          currency={baseCurrency}
        />
      ) : null}

      {wide && tx.kind !== 'transfer' ? (
        <ImpactCard
          testID="tx-detail-impact"
          ledgerId={ledgerId}
          kind={tx.kind}
          amountBase={tx.amount_base}
          categoryL1={tx.category_l1}
          occurredAt={tx.occurred_at}
          baseCurrency={baseCurrency}
          index={index}
        />
      ) : null}

      {tx.kind === 'expense' ? (
        <RefundsSection
          testID="tx-detail-refunds"
          refunds={tx.refunds ?? []}
          refundedTotal={tx.refunded_total ?? '0'}
          refundable={tx.refundable ?? absMoney(tx.amount)}
          currency={tx.currency}
          sourceNames={sourceNames}
          onOpen={(id) => router.push(l.transaction(id) as Href)}
        />
      ) : null}

      {tx.kind === 'refund' ? (
        <RefundOriginCard
          testID="tx-detail-origin"
          refundOf={tx.refund_of}
          origin={tx.refund_of_detail}
          sourceNames={sourceNames}
          index={index}
          onOpen={(id) => router.push(l.transaction(id) as Href)}
          onPick={() => setPickerOpen(true)}
          onUnlink={onUnlinkRefund}
          busy={update.isPending}
        />
      ) : null}

      <EventsCard
        testID="tx-detail-events"
        events={tx.events ?? []}
        names={memberNames}
        meId={user?.id ?? ''}
        index={index ?? undefined}
        sourceNames={sourceNames}
        currency={tx.currency}
        onPressBatch={(batchId) => router.push(l.importBatch(batchId) as Href)}
      />
    </>
  );

  return (
    <Page scroll={false} testID="tx-detail">
      <PageHeader
        testID="tx-detail-crumb"
        title=""
        style={styles.crumb}
        back={{ crumb, onPress: goBack, label: t('common:button.back') }}
      />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollBody}>
        <DetailColumns main={main} side={side} />
      </ScrollView>

      {wide ? null : actionBar}

      {/* Re-pointing the refund at another expense: the kind is fixed to `expense`
          (decision §14.52 B11) and picking one PATCHes `refund_of` straight away. */}
      <TransactionPicker
        testID="tx-detail-origin-picker"
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSelect={(picked) => setRefundOf(picked.id)}
        title={t('transaction:picker.title_refund_origin')}
        fixed={{ kind: ['expense'] }}
      />

      {isTransfer ? (
        <PairSection
          testID="tx-detail-pair"
          tx={tx}
          sourceNames={sourceNames}
          open={pairOpen}
          onClose={() => setPairOpen(false)}
        />
      ) : null}
    </Page>
  );
}

const styles = StyleSheet.create({
  // The breadcrumb form carries no title, so the header's own title/crumb gap is dropped.
  crumb: { gap: 0 },
  scroll: { flex: 1, alignSelf: 'stretch' },
  scrollBody: { paddingBottom: space['4'] },
});
