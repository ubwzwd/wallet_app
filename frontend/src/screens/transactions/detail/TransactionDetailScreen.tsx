/**
 * 交易详情 `/l/:ledgerId/transactions/:txId` (04 §4.7).
 *
 * One screen for expense / income / refund / single-leg transfer. `GET /transactions/{tid}`
 * carries four extras over a list row (§3.3) and each one owns a block here: `refunds[]` →
 * `RefundsSection`, `refund_of_detail` → `RefundOriginCard`, `events[]` → `EventTimeline`,
 * and `pair` → nothing, because a leg of a two-leg transfer is not a page: it redirects to
 * `/transfers/:pairId`, which is the only address that survives a refresh or a shared link.
 *
 * The write operations here are all one-shot: delete, and the refund link (PATCH
 * `refund_of`, either cleared or re-pointed — decision §14.34 keeps both relations editable
 * after an import). None of them passes `{ silent: true }`: there is no form to render an
 * error into, so the global mutation toast (04 §3.9) is exactly the right place, and a 409
 * `stale_update` is handled once, globally (04 §3.8).
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import { Redirect, useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useTranslation } from 'react-i18next';

import type { Uuid } from '@/api/types';
import { absMoney } from '@/domain/money';
import { routes } from '@/domain/routes';
import { useLang } from '@/i18n';
import { errorMessage } from '@/i18n/errorCodes';
import { useTopBar } from '@/navigation';
import {
  useCategories,
  useDeleteTransaction,
  useMemberNames,
  useSources,
  useTransaction,
  useUpdateTransaction,
} from '@/queries';
import { useAuth, useLedgerContext } from '@/store';
import { space } from '@/theme/tokens';
import { Card, EmptyState, EventTimeline, Page, Skeleton, Text, confirm, toast } from '@/ui';

import { TransactionPicker } from '../TransactionPicker';
import { DetailActions, type DetailAction } from './DetailActions';
import { DetailHeader } from './DetailHeader';
import { PairSection } from './PairSection';
import { RateLine } from './RateLine';
import { RefundOriginCard, categoryPath } from './RefundOriginCard';
import { RefundsSection } from './RefundsSection';

/** `source_id → name`, the lookup every block on this page needs. */
export function useSourceNames(ledgerId: Uuid): Record<Uuid, string> {
  const sources = useSources(ledgerId, { include_archived: true });
  const items = sources.data?.items;
  return React.useMemo(() => {
    const out: Record<Uuid, string> = {};
    for (const s of items ?? []) out[s.id] = s.name;
    return out;
  }, [items]);
}

export default function TransactionDetailScreen(): React.JSX.Element {
  const { t } = useTranslation();
  const lang = useLang();
  const router = useRouter();
  const { ledgerId, baseCurrency } = useLedgerContext();
  const params = useLocalSearchParams<{ txId?: string }>();
  const txId = typeof params.txId === 'string' ? params.txId : '';
  useTopBar(t('transaction:list.title'));

  const query = useTransaction(ledgerId, txId === '' ? undefined : txId);
  const tx = query.data;

  const sourceNames = useSourceNames(ledgerId);
  const { index } = useCategories();
  const memberNames = useMemberNames(ledgerId);
  const { user } = useAuth();

  const remove = useDeleteTransaction(ledgerId);
  const update = useUpdateTransaction(ledgerId, txId);
  const [pickerOpen, setPickerOpen] = React.useState(false);

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
  if (tx.pair) {
    return <Redirect href={l.transfer(tx.pair.pair_id) as Href} />;
  }

  const category = categoryPath(index, tx.category_l1, tx.category_l2, lang);
  const actions: DetailAction[] = [
    {
      key: 'edit',
      label: t('common:button.edit'),
      icon: 'pencil',
      variant: 'primary',
      onPress: () => router.push(l.transactionEdit(tx.id) as Href),
    },
    {
      key: 'duplicate',
      label: t('transaction:detail.duplicate_action'),
      icon: 'copy',
      onPress: () => router.push(l.transactionNew({ copy_of: tx.id }) as Href),
    },
    ...(tx.kind === 'expense'
      ? [
          {
            key: 'refund',
            label: t('transaction:detail.refund_action'),
            icon: 'undo-2' as const,
            onPress: () =>
              router.push(l.transactionNew({ kind: 'refund', refund_of: tx.id }) as Href),
          },
        ]
      : []),
    {
      key: 'delete',
      label: t('common:button.delete'),
      icon: 'trash-2',
      variant: 'danger',
      onPress: onDelete,
      loading: remove.isPending,
    },
  ];

  const events = tx.events ?? [];

  return (
    <Page testID="tx-detail">
      <DetailHeader
        testID="tx-detail-header"
        kind={tx.kind}
        amount={tx.amount}
        currency={tx.currency}
        occurredAt={tx.occurred_at}
        merchant={tx.merchant}
        sourceName={sourceNames[tx.source_id] ?? null}
        categoryText={category}
        badgeExtra={
          tx.kind === 'transfer' && tx.transfer_subtype
            ? t(`transaction:transfer.subtype.${tx.transfer_subtype}`)
            : null
        }
        note={tx.note}
      />

      <RateLine
        testID="tx-detail-rate"
        amount={tx.amount}
        currency={tx.currency}
        baseCurrency={baseCurrency}
        amountBase={tx.amount_base}
        rateUsed={tx.rate_used}
        rateDate={tx.rate_date}
        occurredAt={tx.occurred_at}
      />

      <DetailActions actions={actions} testID="tx-detail-actions" />

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

      {tx.kind === 'transfer' ? (
        <PairSection testID="tx-detail-pair" tx={tx} sourceNames={sourceNames} />
      ) : null}

      {events.length > 0 ? (
        <Card testID="tx-detail-events-card" style={styles.events}>
          <Text variant="subheading" accessibilityRole="header">
            {t('transaction:detail.events_title')}
          </Text>
          <EventTimeline
            testID="tx-detail-events"
            events={events}
            names={memberNames}
            meId={user?.id ?? ''}
            index={index ?? undefined}
            sourceNames={sourceNames}
            currency={tx.currency}
            onPressBatch={(batchId) => router.push(l.importBatch(batchId) as Href)}
          />
        </Card>
      ) : null}

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
    </Page>
  );
}

const styles = StyleSheet.create({
  events: { gap: space['2'], alignSelf: 'stretch' },
});
