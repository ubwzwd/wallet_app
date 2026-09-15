/**
 * `/l/:ledgerId/settings` — ledger settings (04 §4.12), rebuilt against 屏幕稿 12.
 *
 * Wide: the ledger's own page head — square avatar, name, 「建于 … · N 笔交易 · 基准币种 CNY」
 * and 「改名字」 — over two columns at roughly 1.25 : 1. Left holds the members table with
 * the invite panel inside it and the base-currency card; right holds 权限 and 危险操作.
 * Narrow stacks the same blocks in that order under the top bar's title.
 *
 * Which blocks are on screen is decided by `myRole` (decision §2). The role comes from
 * the member list rather than the ledger list, so handing ownership to someone else
 * downgrades this page the moment the refreshed member list lands.
 */
import React from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useTopBar } from '@/navigation';
import { useLedger, useMembers } from '@/queries';
import { useLedgerContext } from '@/store';
import { space } from '@/theme/tokens';
import { useIsWide } from '@/theme/useBreakpoint';
import { Page } from '@/ui';

import { BaseCurrencyCard } from './BaseCurrencyCard';
import { DangerZone } from './DangerZone';
import { InviteCard } from './InviteCard';
import { LedgerHeader } from './LedgerHeader';
import { MembersCard } from './MembersCard';
import { PermissionsCard } from './PermissionsCard';

/** 屏幕稿 12: `minmax(0,1.25fr) minmax(0,1fr)` with a 24 gutter. */
const LEFT_FLEX = 1.25;
const COLUMN_GAP = space['6'];

export default function LedgerSettingsScreen(): React.JSX.Element {
  const { t } = useTranslation();
  const wide = useIsWide();
  const { ledgerId, ledger, myRole } = useLedgerContext();
  // 04 §1.4: on a narrow layout the top bar is the title; the page must not repeat it.
  useTopBar(t('ledger:settings.title'));
  const detail = useLedger(ledgerId);
  const membersQuery = useMembers(ledgerId);

  const members = React.useMemo(() => membersQuery.data?.items ?? [], [membersQuery.data]);
  const me = members.find((m) => m.is_me);
  const role = me?.role ?? myRole;
  const isOwner = role === 'owner';

  const left = (
    <>
      <MembersCard
        ledgerId={ledgerId}
        members={members}
        loading={membersQuery.isPending}
        isOwner={isOwner}
        invite={
          isOwner ? (
            <InviteCard
              ledgerId={ledgerId}
              members={members}
              membersLoaded={!membersQuery.isPending}
            />
          ) : undefined
        }
      />
      <BaseCurrencyCard ledgerId={ledgerId} detail={detail.data} canEdit={isOwner} />
    </>
  );

  const right = (
    <>
      <PermissionsCard />
      <DangerZone
        ledgerId={ledgerId}
        detail={detail.data}
        ledgerName={detail.data?.name ?? ledger.name}
        members={members}
        isOwner={isOwner}
      />
    </>
  );

  return (
    <Page testID="ledger-settings-screen">
      <LedgerHeader
        ledgerId={ledgerId}
        detail={detail.data}
        fallbackName={ledger.name}
        memberCount={members.length}
        canEdit={isOwner}
      />

      {wide ? (
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: COLUMN_GAP }}>
          <View style={{ flexGrow: LEFT_FLEX, flexShrink: 1, flexBasis: 0, gap: space['5'] }}>
            {left}
          </View>
          <View style={{ flexGrow: 1, flexShrink: 1, flexBasis: 0, gap: space['5'] }}>{right}</View>
        </View>
      ) : (
        <View style={{ gap: space['3'] }}>
          {left}
          {right}
        </View>
      )}
    </Page>
  );
}
