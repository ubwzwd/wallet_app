/**
 * Ledger settings → members (04 §4.12).
 *
 * One row per member: display name (falling back to the email prefix, decision §14.40),
 * email, role badge and join date — no avatars (decision §14.52 B22). The owner-only
 * actions are exactly the ones decision §2 grants: remove a member, transfer ownership.
 * Leaving lives here too, because a member's whole action list is that one button.
 */
import React from 'react';
import { View } from 'react-native';
import { type Href, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import type { LedgerMember, Uuid } from '@/api/types';
import { routes } from '@/domain/routes';
import { formatDate } from '@/i18n/format';
import { useLang } from '@/i18n';
import { memberLabel, useLeaveLedger, useRemoveMember, useTransferOwnership } from '@/queries';
import { space } from '@/theme/tokens';
import { useIsWide } from '@/theme/useBreakpoint';
import { Badge, Button, Card, Divider, Select, Skeleton, Text, confirm, toast } from '@/ui';

/** Decision §2 / §14.52 B7: a ledger holds at most 10 people. */
export const MAX_MEMBERS = 10;

export interface MembersSectionProps {
  ledgerId: Uuid;
  ledgerName: string;
  members: readonly LedgerMember[];
  loading: boolean;
  isOwner: boolean;
}

function MemberRow({
  member,
  isOwner,
  onRemove,
}: {
  member: LedgerMember;
  isOwner: boolean;
  onRemove(): void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const lang = useLang();
  const wide = useIsWide();
  const name = memberLabel(member);
  const removable = isOwner && member.role !== 'owner';

  return (
    <View
      testID={`member-row-${member.user_id}`}
      style={{
        flexDirection: wide ? 'row' : 'column',
        alignItems: wide ? 'center' : 'flex-start',
        gap: space['2'],
      }}
    >
      <View style={{ flex: 1, gap: space['1'] }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space['2'] }}>
          <Text weight={600}>{name}</Text>
          <Badge
            label={
              member.role === 'owner'
                ? t('ledger:settings.members.role_owner')
                : t('ledger:settings.members.role_member')
            }
            tone={member.role === 'owner' ? 'info' : 'neutral'}
            testID={`member-role-${member.user_id}`}
          />
        </View>
        <Text variant="caption" tone="secondary">
          {member.email}
        </Text>
        <Text variant="caption" tone="muted">
          {t('ledger:settings.members.joined_at', {
            date: formatDate(member.joined_at.slice(0, 10), lang),
          })}
        </Text>
      </View>
      {removable ? (
        <Button
          testID={`member-remove-${member.user_id}`}
          label={t('ledger:settings.members.remove_action')}
          accessibilityLabel={`${t('ledger:settings.members.remove_action')} ${name}`}
          variant="secondary"
          size="sm"
          onPress={onRemove}
        />
      ) : null}
    </View>
  );
}

export function MembersSection({
  ledgerId,
  ledgerName,
  members,
  loading,
  isOwner,
}: MembersSectionProps): React.JSX.Element {
  const { t } = useTranslation();
  const router = useRouter();
  const remove = useRemoveMember(ledgerId);
  const transfer = useTransferOwnership(ledgerId);
  const leave = useLeaveLedger(ledgerId);
  const [transferTo, setTransferTo] = React.useState<string | null>(null);

  const others = members.filter((m) => !m.is_me);

  const onRemove = (member: LedgerMember): void => {
    const name = memberLabel(member);
    void (async () => {
      const ok = await confirm({
        title: t('ledger:settings.members.remove_title'),
        body: t('ledger:settings.members.remove_confirm', { name }),
        tone: 'danger',
        confirmLabel: t('ledger:settings.members.remove_action'),
      });
      if (!ok) return;
      remove.mutate(member.user_id, {
        onSuccess: () => toast.success(t('ledger:settings.members.removed_toast', { name })),
      });
    })();
  };

  const onTransfer = (): void => {
    const target = members.find((m) => m.user_id === transferTo);
    if (!target) return;
    const name = memberLabel(target);
    void (async () => {
      const ok = await confirm({
        title: t('ledger:settings.members.transfer_title'),
        body: t('ledger:settings.members.transfer_confirm', { name }),
        doubleTap: true,
        confirmLabel: t('ledger:settings.members.transfer_submit'),
      });
      if (!ok) return;
      transfer.mutate(
        { to_user_id: target.user_id },
        {
          onSuccess: () => {
            setTransferTo(null);
            toast.success(t('ledger:settings.members.transferred_toast', { name }));
          },
        },
      );
    })();
  };

  const onLeave = (): void => {
    void (async () => {
      const ok = await confirm({
        title: t('ledger:settings.members.leave_title'),
        body: t('ledger:settings.members.leave_confirm', { name: ledgerName }),
        tone: 'danger',
        confirmLabel: t('ledger:settings.members.leave_action'),
      });
      if (!ok) return;
      leave.mutate(undefined, {
        onSuccess: () => {
          toast.success(t('ledger:settings.members.left_toast', { name: ledgerName }));
          router.replace(routes.ledgers() as Href);
        },
      });
    })();
  };

  return (
    <Card variant="outlined" style={{ gap: space['3'] }} testID="members-section">
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space['2'] }}>
        <Text variant="heading" accessibilityRole="header" style={{ flex: 1 }}>
          {t('ledger:settings.members.title')}
        </Text>
        <Text variant="caption" tone="muted" testID="member-count">
          {t('ledger:settings.members.count', { count: members.length })}
        </Text>
      </View>

      {loading ? (
        <Skeleton variant="row" testID="members-skeleton" />
      ) : (
        <View style={{ gap: space['3'] }}>
          {members.map((member, index) => (
            <View key={member.user_id} style={{ gap: space['3'] }}>
              {index === 0 ? null : <Divider />}
              <MemberRow member={member} isOwner={isOwner} onRemove={() => onRemove(member)} />
            </View>
          ))}
        </View>
      )}

      <Text variant="caption" tone="secondary" testID="permission-hint">
        {t('ledger:settings.members.permission_hint')}
      </Text>

      {isOwner && others.length > 0 ? (
        <View style={{ gap: space['2'] }} testID="transfer-ownership">
          <Select
            testID="transfer-target"
            label={t('ledger:settings.members.transfer_select_label')}
            placeholder={t('ledger:settings.members.transfer_placeholder')}
            value={transferTo}
            onChange={setTransferTo}
            options={others.map((m) => ({
              value: m.user_id,
              label: memberLabel(m),
              hint: m.email,
            }))}
          />
          <Button
            testID="transfer-submit"
            label={t('ledger:settings.members.transfer_ownership')}
            variant="secondary"
            size="sm"
            onPress={onTransfer}
            loading={transfer.isPending}
            disabled={transferTo === null}
          />
        </View>
      ) : null}

      <View style={{ gap: space['1'] }}>
        <Button
          testID="leave-ledger"
          label={t('ledger:settings.members.leave_action')}
          variant="secondary"
          size="sm"
          onPress={onLeave}
          loading={leave.isPending}
          disabled={isOwner}
        />
        {isOwner ? (
          <Text variant="caption" tone="muted" testID="leave-disabled-hint">
            {t('ledger:settings.members.leave_disabled_hint')}
          </Text>
        ) : null}
      </View>
    </Card>
  );
}

export default MembersSection;
