/**
 * 两腿转账详情 `/l/:ledgerId/transfers/:pairId` (04 §4.7, decisions §1.2, §14.34, §14.53a,
 * 屏幕稿 07 两腿).
 *
 * The pair is the unit here: one `GET .../transactions/transfer/{pair_id}` (03 §5.30a) gives
 * both legs, and the header's date / subtype / note come from the **out** leg, which is what
 * decision §14.53a makes the pair's own value. The mockup's composition: badges 「⇄ 转账 ·
 * 信用卡还款 · 2 条腿」, the unsigned headline amount, the line that stops people reading a
 * transfer as spending, and the two tinted leg tiles with a round arrow between them. Each
 * leg keeps its own account, amount and currency (a cross-currency pair is normal), and no
 * "balance after" is shown (§14.52 A7).
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
import { ScrollView, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import type { Transaction } from '@/api/types';
import { monthOf } from '@/domain/dates';
import { absMoney } from '@/domain/money';
import { routes } from '@/domain/routes';
import { useLang } from '@/i18n';
import { formatDate } from '@/i18n/format';
import { errorMessage } from '@/i18n/errorCodes';
import { useTopBar } from '@/navigation';
import {
  qk,
  useCategories,
  useDeleteTransfer,
  useMemberNames,
  useMembers,
  useTransaction,
  useTransfer,
  useUnpairTransfer,
} from '@/queries';
import { useAuth, useLedgerContext } from '@/store';
import { space } from '@/theme/tokens';
import { useIsWide } from '@/theme/useBreakpoint';
import { Card, EmptyState, Page, PageHeader, Skeleton, Text, confirm, toast } from '@/ui';

import { DetailActions, type DetailAction } from './DetailActions';
import { DetailHeader } from './DetailHeader';
import { EventsCard } from './EventsCard';
import { TransferImpactCard } from './ImpactCard';
import { KeyFacts } from './KeyFacts';
import { TransferLegs } from './TransferLegs';
import { transferFacts } from './facts';
import { DetailColumns, InfoBadge } from './parts';
import { useSourceMap, useSourceNames } from './useSources';

export default function TransferDetailScreen(): React.JSX.Element {
  const { t } = useTranslation();
  const lang = useLang();
  const router = useRouter();
  const qc = useQueryClient();
  const wide = useIsWide();
  const { ledgerId, baseCurrency } = useLedgerContext();
  const params = useLocalSearchParams<{ pairId?: string }>();
  const pairId = typeof params.pairId === 'string' ? params.pairId : '';

  const query = useTransfer(ledgerId, pairId === '' ? undefined : pairId);
  const pair = query.data;

  const sourceMap = useSourceMap(ledgerId);
  const sourceNames = useSourceNames(ledgerId);
  const { index } = useCategories();
  const memberNames = useMemberNames(ledgerId);
  const members = useMembers(ledgerId);
  const { user } = useAuth();
  // Events belong to a transaction, not to a pair (03 §5.27 vs §5.30a).
  const outLeg = useTransaction(ledgerId, pair?.out.id);

  const remove = useDeleteTransfer(ledgerId);
  const unpair = useUnpairTransfer(ledgerId);

  // 屏幕稿 07 (decision B16): 「交易 · 09-08 · 招行储蓄卡 → 建行信用卡」, so the bar and the
  // breadcrumb both say which move this is without opening anything.
  const crumb = pair
    ? [
        t('transaction:list.title'),
        formatDate(pair.occurred_at, lang),
        t('transaction:list.row.transfer_pair', {
          from: sourceNames[pair.out.source_id] ?? pair.out.source_id,
          to: sourceNames[pair.in.source_id] ?? pair.in.source_id,
        }),
      ].join(' · ')
    : t('transaction:list.title');
  useTopBar(crumb);

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
      if (!ok || pairId === '' || !pair) return;
      // The out leg's id comes off the pair already on screen, never off the response:
      // 03 §5.34 answers `{ pair_id, unpaired: [leg, leg] }`, which has no `out` on it.
      const outId = pair.out.id;
      unpair.mutate(pairId, {
        onSuccess: () => {
          toast.success(t('transaction:detail.unpair_saved'));
          // The cached detail of that leg still says it belongs to a pair, and the leg's page
          // redirects to the pair — straight back to a pair that no longer exists. Clear the
          // relation here so the reader lands on the leg itself; the refetch confirms it.
          qc.setQueryData(qk.ledger(ledgerId).tx(outId), (prev?: Transaction) =>
            prev ? { ...prev, pair: null, transfer_pair_id: null } : prev,
          );
          router.replace(l.transaction(outId) as Href);
        },
      });
    });
  }, [ledgerId, l, pair, pairId, qc, router, t, unpair]);

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
      onPress: () => router.push(l.transferEdit(pair.pair_id) as Href),
    },
    {
      key: 'unpair',
      label: t('transaction:detail.unpair_action'),
      icon: 'unlink',
      tone: 'info',
      hint: t('transaction:detail.unpair_action_hint'),
      onPress: onUnpair,
      loading: unpair.isPending,
    },
    {
      key: 'delete',
      label: t('common:button.delete'),
      icon: 'trash-2',
      tone: 'danger',
      onPress: onDelete,
      loading: remove.isPending,
    },
  ];

  const facts = transferFacts(
    {
      t,
      lang,
      baseCurrency,
      sources: sourceMap,
      members: members.data?.items ?? [],
      membersReady: members.isSuccess,
      onOpenBatch: (batchId) => router.push(l.importBatch(batchId) as Href),
    },
    pair,
    outLeg.data,
  );

  const sheetTitle = t('transaction:detail.actions_sheet_title', {
    kind: t('transaction:kind.transfer'),
  });
  const actionBar = (
    <DetailActions actions={actions} sheetTitle={sheetTitle} testID="transfer-detail-actions" />
  );

  /* A cross-currency pair converts each leg on its own, so each leg carries its own rate
     line (decision §14.52 A24) — one line for the pair would hide the other half. */
  const legs = (
    <TransferLegs
      testID="transfer-detail-legs"
      out={pair.out}
      into={pair.in}
      sources={sourceMap}
      baseCurrency={baseCurrency}
      hint={
        pair.out.currency === pair.in.currency ? (
          <Text variant="caption" tone="muted" testID="transfer-detail-legs-hint">
            {t('transaction:detail.legs_hint')}
          </Text>
        ) : null
      }
    />
  );

  const main = (
    <>
      <DetailHeader
        testID="transfer-detail-header"
        kind="transfer"
        // Both legs are listed below with their own signs; the headline is the size of the
        // move, not a gain or a loss (a transfer changes no net worth).
        amount={absMoney(pair.out.amount)}
        currency={pair.out.currency}
        signDisplay="never"
        plain
        badges={
          <>
            <InfoBadge
              testID="transfer-detail-header-extra"
              label={t(`transaction:transfer.subtype.${pair.subtype}`)}
            />
            <InfoBadge label={t('transaction:detail.leg_count_pair')} />
          </>
        }
        actions={actionBar}
        sub={
          <Text variant="body" tone="secondary" testID="transfer-detail-note">
            {t('transaction:detail.transfer_note_pair', { currency: pair.out.currency })}
          </Text>
        }
      >
        {wide ? legs : null}
      </DetailHeader>

      {wide ? null : (
        <Card variant="raised" testID="transfer-detail-legs-card">
          {legs}
        </Card>
      )}

      <KeyFacts facts={facts} testID="transfer-detail-facts" />
    </>
  );

  const side = (
    <>
      {wide ? (
        <TransferImpactCard
          testID="transfer-detail-impact"
          month={monthOf(pair.occurred_at)}
          subtype={pair.subtype}
          amountIn={pair.in.amount}
          currency={pair.in.currency}
        />
      ) : null}
      <EventsCard
        testID="transfer-detail-events"
        events={outLeg.data?.events ?? []}
        names={memberNames}
        meId={user?.id ?? ''}
        index={index ?? undefined}
        sourceNames={sourceNames}
        currency={pair.out.currency}
        onPressBatch={(batchId) => router.push(l.importBatch(batchId) as Href)}
      />
    </>
  );

  return (
    <Page scroll={false} testID="transfer-detail">
      <PageHeader
        testID="transfer-detail-crumb"
        title=""
        style={styles.crumb}
        back={{ crumb, onPress: goBack, label: t('common:button.back') }}
      />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollBody}>
        <DetailColumns main={main} side={side} />
      </ScrollView>
      {wide ? null : actionBar}
    </Page>
  );
}

const styles = StyleSheet.create({
  crumb: { gap: 0 },
  scroll: { flex: 1, alignSelf: 'stretch' },
  scrollBody: { paddingBottom: space['4'] },
});
