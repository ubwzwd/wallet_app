/**
 * 两腿转账详情 `/l/:ledgerId/transfers/:pairId` (04 §4.7, decisions §1.2, §14.34, §14.53a).
 *
 * The pair is the unit here: one `GET .../transactions/transfer/{pair_id}` (03 §5.30a) gives
 * both legs, and the header's date / subtype / note come from the **out** leg, which is what
 * decision §14.53a makes the pair's own value. Each leg keeps its own account, amount and
 * currency (a cross-currency pair is normal), and no "balance after" is shown (§14.52 A7).
 *
 * Three operations, all on the pair and never on one leg: 编辑 (the shared form), 拆开 (both
 * legs survive as single legs and stop being related — so the page moves to the out leg's
 * own detail), 删除 (both legs go, through the transfer endpoint).
 *
 * The operations timeline lives on the transaction detail response, not on the pair's, so
 * it is read from the out leg's own detail. That query failing costs nothing: the block
 * simply does not render.
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { absMoney } from '@/domain/money';
import { routes } from '@/domain/routes';
import { errorMessage } from '@/i18n/errorCodes';
import { useTopBar } from '@/navigation';
import {
  useCategories,
  useDeleteTransfer,
  useMemberNames,
  useTransaction,
  useTransfer,
  useUnpairTransfer,
} from '@/queries';
import { useAuth, useLedgerContext } from '@/store';
import { space } from '@/theme/tokens';
import { Card, EmptyState, EventTimeline, Page, Skeleton, Text, confirm, toast } from '@/ui';

import { DetailActions, type DetailAction } from './DetailActions';
import { DetailHeader } from './DetailHeader';
import { TransferLegs } from './PairSection';
import { RateLine } from './RateLine';
import { useSourceNames } from './TransactionDetailScreen';

export default function TransferDetailScreen(): React.JSX.Element {
  const { t } = useTranslation();
  const router = useRouter();
  const { ledgerId, baseCurrency } = useLedgerContext();
  const params = useLocalSearchParams<{ pairId?: string }>();
  const pairId = typeof params.pairId === 'string' ? params.pairId : '';
  useTopBar(t('transaction:list.title'));

  const query = useTransfer(ledgerId, pairId === '' ? undefined : pairId);
  const pair = query.data;

  const sourceNames = useSourceNames(ledgerId);
  const { index } = useCategories();
  const memberNames = useMemberNames(ledgerId);
  const { user } = useAuth();
  // Events belong to a transaction, not to a pair (03 §5.27 vs §5.30a).
  const outLeg = useTransaction(ledgerId, pair?.out.id);

  const remove = useDeleteTransfer(ledgerId);
  const unpair = useUnpairTransfer(ledgerId);

  const l = routes.l(ledgerId);

  const goList = React.useCallback((): void => {
    router.replace(l.transactions() as Href);
  }, [l, router]);

  const goBack = React.useCallback((): void => {
    if (router.canGoBack()) router.back();
    else goList();
  }, [goList, router]);

  const onDelete = React.useCallback((): void => {
    void confirm({
      title: t('transaction:list.delete_confirm'),
      body: t('transaction:list.delete_transfer_confirm'),
      tone: 'danger',
      confirmLabel: t('common:button.delete'),
      cancelLabel: t('common:button.cancel'),
    }).then((ok) => {
      if (!ok || pairId === '') return;
      remove.mutate(pairId, {
        onSuccess: () => {
          toast.success(t('transaction:list.deleted_toast'));
          goBack();
        },
      });
    });
  }, [goBack, pairId, remove, t]);

  const onUnpair = React.useCallback((): void => {
    void confirm({
      title: t('transaction:detail.unpair_action'),
      body: t('transaction:detail.unpair_confirm'),
      confirmLabel: t('transaction:detail.unpair_action'),
      cancelLabel: t('common:button.cancel'),
    }).then((ok) => {
      if (!ok || pairId === '') return;
      unpair.mutate(pairId, {
        onSuccess: (result) => {
          toast.success(t('transaction:detail.unpair_saved'));
          // The pair no longer exists; the out leg's own page is where this reader is now.
          router.replace(l.transaction(result.out.id) as Href);
        },
      });
    });
  }, [l, pairId, router, t, unpair]);

  if (query.isError) {
    return (
      <Page testID="transfer-detail">
        <EmptyState
          testID="transfer-detail-error"
          icon="alert-triangle"
          title={errorMessage(t, query.error)}
          primaryAction={{ label: t('common:button.retry'), onPress: () => void query.refetch() }}
          secondaryAction={{ label: t('transaction:list.title'), onPress: goList }}
        />
      </Page>
    );
  }

  if (query.isPending || !pair) {
    return (
      <Page testID="transfer-detail">
        <Skeleton variant="table" rows={6} testID="transfer-detail-skeleton" />
      </Page>
    );
  }

  const actions: DetailAction[] = [
    {
      key: 'edit',
      label: t('common:button.edit'),
      icon: 'pencil',
      variant: 'primary',
      onPress: () => router.push(l.transferEdit(pair.pair_id) as Href),
    },
    {
      key: 'unpair',
      label: t('transaction:detail.unpair_action'),
      icon: 'unlink',
      onPress: onUnpair,
      loading: unpair.isPending,
    },
    {
      key: 'delete',
      label: t('common:button.delete'),
      icon: 'trash-2',
      variant: 'danger',
      onPress: onDelete,
      loading: remove.isPending,
    },
  ];

  const events = outLeg.data?.events ?? [];

  return (
    <Page testID="transfer-detail">
      <DetailHeader
        testID="transfer-detail-header"
        kind="transfer"
        // Both legs are listed below with their own signs; the headline is the size of the
        // move, not a gain or a loss (a transfer changes no net worth).
        amount={absMoney(pair.out.amount)}
        currency={pair.out.currency}
        signDisplay="never"
        occurredAt={pair.occurred_at}
        badgeExtra={t(`transaction:transfer.subtype.${pair.subtype}`)}
        note={pair.note}
      />

      <RateLine
        testID="transfer-detail-rate"
        amount={pair.out.amount}
        currency={pair.out.currency}
        baseCurrency={baseCurrency}
        amountBase={pair.out.amount_base}
        rateUsed={pair.out.rate_used}
        rateDate={pair.out.rate_date}
        occurredAt={pair.out.occurred_at}
      />

      <DetailActions actions={actions} testID="transfer-detail-actions" />

      <TransferLegs
        testID="transfer-detail-legs"
        out={pair.out}
        into={pair.in}
        sourceNames={sourceNames}
      />

      {events.length > 0 ? (
        <Card testID="transfer-detail-events-card" style={styles.events}>
          <Text variant="subheading" accessibilityRole="header">
            {t('transaction:detail.events_title')}
          </Text>
          <EventTimeline
            testID="transfer-detail-events"
            events={events}
            names={memberNames}
            meId={user?.id ?? ''}
            index={index ?? undefined}
            sourceNames={sourceNames}
            currency={pair.out.currency}
            onPressBatch={(batchId) => router.push(l.importBatch(batchId) as Href)}
          />
        </Card>
      ) : null}
    </Page>
  );
}

const styles = StyleSheet.create({
  events: { gap: space['2'], alignSelf: 'stretch' },
});
