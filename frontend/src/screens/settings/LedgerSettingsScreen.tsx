/**
 * `/l/:ledgerId/settings` — ledger settings (04 §4.12).
 *
 * Which blocks are on screen is decided by `myRole` (decision §2). The role comes from
 * the member list rather than the ledger list, so handing ownership to someone else
 * downgrades this page the moment the refreshed member list lands.
 */
import React from 'react';
import { useTranslation } from 'react-i18next';

import { useLedger, useMembers } from '@/queries';
import { useLedgerContext } from '@/store';
import { Page, Text } from '@/ui';

import { DangerZone } from './DangerZone';
import { InviteCard } from './InviteCard';
import { LedgerBasics } from './LedgerBasics';
import { MembersSection } from './MembersSection';

export default function LedgerSettingsScreen(): React.JSX.Element {
  const { t } = useTranslation();
  const { ledgerId, ledger, myRole } = useLedgerContext();
  const detail = useLedger(ledgerId);
  const membersQuery = useMembers(ledgerId);

  const members = React.useMemo(() => membersQuery.data?.items ?? [], [membersQuery.data]);
  const me = members.find((m) => m.is_me);
  const role = me?.role ?? myRole;
  const isOwner = role === 'owner';

  return (
    <Page testID="ledger-settings-screen">
      <Text variant="title" accessibilityRole="header">
        {t('ledger:settings.title')}
      </Text>

      <LedgerBasics ledgerId={ledgerId} detail={detail.data} canEdit={isOwner} />

      <MembersSection
        ledgerId={ledgerId}
        ledgerName={detail.data?.name ?? ledger.name}
        members={members}
        loading={membersQuery.isPending}
        isOwner={isOwner}
      />

      {isOwner ? <InviteCard ledgerId={ledgerId} members={members} /> : null}

      {isOwner && detail.data ? <DangerZone detail={detail.data} /> : null}
    </Page>
  );
}
