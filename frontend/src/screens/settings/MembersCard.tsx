/**
 * Ledger settings → members (屏幕稿 12 账本设置).
 *
 * One white card: a 「成员 … 2 / 10」 head strip, then a real three-column table — 名称
 * (round letter avatar + name) / 角色 (badge) / 加入时间 — with the owner-only remove
 * button in a 52 column at the end. The founder's row says 「建立」 rather than 「加入」.
 * The invite panel lives inside the same card, under the last row (mockup note: the code
 * has to be readable while the member list is still on screen, so it never opens a modal).
 *
 * Narrow screens drop the column heads and stack name / badge over the join date.
 */
import React from 'react';
import { Pressable, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import type { LedgerMember, Uuid } from '@/api/types';
import { formatDate } from '@/i18n/format';
import { useLang } from '@/i18n';
import { memberLabel, useRemoveMember } from '@/queries';
import { radius, space } from '@/theme/tokens';
import { useColors } from '@/theme/ThemeProvider';
import { useIsWide } from '@/theme/useBreakpoint';
import { Avatar, Badge, Icon, ListCard, Skeleton, Text, confirm, toast } from '@/ui';

/** Decision §2 / §14.52 B7: a ledger holds at most 10 people. */
export const MAX_MEMBERS = 10;

/** 屏幕稿 12: one elastic name column, a 110 role column, an elastic date, 52 for 「－」. */
const ROLE_WIDTH = 110;
const ACTION_WIDTH = 52;
const GRID_GAP = space['3'] + 2;
const GRID_PADDING = space['5'];

export interface MembersCardProps {
  ledgerId: Uuid;
  members: readonly LedgerMember[];
  loading: boolean;
  isOwner: boolean;
  /** The invite panel, rendered inside this card under the last row (owner only). */
  invite?: React.ReactNode;
}

/** The founder's row reads 「2025-06-14 建立」, everyone else's 「2025-06-15 加入」. */
function joinedKey(member: LedgerMember): string {
  return member.role === 'owner'
    ? 'ledger:settings.members.joined_founder'
    : 'ledger:settings.members.joined_at';
}

/**
 * 屏幕稿 12's remove control: a 34 rounded square on `bg.subtle` with danger ink — no
 * `Button` variant pairs that fill with that ink, so the row draws its own. The hit slop
 * takes the 34 box to the 44 minimum (04 §7.1).
 */
function RemoveButton({
  label,
  onPress,
  testID,
}: {
  label: string;
  onPress(): void;
  testID: string;
}): React.JSX.Element {
  const colors = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={5}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => ({
        width: 34,
        height: 34,
        borderRadius: radius.md - 3,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: pressed ? colors['status.danger.bg'] : colors['bg.subtle'],
      })}
    >
      <Icon name="x" size={18} color={colors['status.danger.fg']} />
    </Pressable>
  );
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
  const joined = t(joinedKey(member), { date: formatDate(member.joined_at.slice(0, 10), lang) });
  const badge = (
    <Badge
      label={
        member.role === 'owner'
          ? t('ledger:settings.members.role_owner')
          : t('ledger:settings.members.role_member')
      }
      tone={member.role === 'owner' ? 'accent' : 'neutral'}
      testID={`member-role-${member.user_id}`}
    />
  );
  const remove = removable ? (
    <RemoveButton
      label={`${t('ledger:settings.members.remove_action')} ${name}`}
      onPress={onRemove}
      testID={`member-remove-${member.user_id}`}
    />
  ) : null;

  if (!wide) {
    return (
      <View
        testID={`member-row-${member.user_id}`}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: space['3'],
          paddingHorizontal: space['4'],
          paddingVertical: space['3'],
          minHeight: 64,
        }}
      >
        <Avatar name={name} size={36} tone={member.role === 'owner' ? 'accent' : 'muted'} />
        <View style={{ flex: 1, minWidth: 0, gap: space['1'] }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space['2'] }}>
            <Text variant="subheading" weight={500} numberOfLines={1}>
              {name}
            </Text>
            {badge}
          </View>
          <Text variant="caption" tone="muted" mono testID={`member-joined-${member.user_id}`}>
            {joined}
          </Text>
        </View>
        {remove}
      </View>
    );
  }

  return (
    <View
      testID={`member-row-${member.user_id}`}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: GRID_GAP,
        paddingHorizontal: GRID_PADDING,
        paddingVertical: space['3'],
        minHeight: 58,
      }}
    >
      <View
        style={{
          flexGrow: 1,
          flexShrink: 1,
          flexBasis: 0,
          minWidth: 0,
          flexDirection: 'row',
          alignItems: 'center',
          gap: space['3'],
        }}
      >
        <Avatar name={name} size={36} tone={member.role === 'owner' ? 'accent' : 'muted'} />
        <Text variant="subheading" weight={500} numberOfLines={1} style={{ flexShrink: 1 }}>
          {name}
        </Text>
      </View>
      <View style={{ width: ROLE_WIDTH }}>{badge}</View>
      <View style={{ flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 0 }}>
        <Text
          variant="body"
          tone="secondary"
          mono
          weight={450}
          numberOfLines={1}
          testID={`member-joined-${member.user_id}`}
        >
          {joined}
        </Text>
      </View>
      <View style={{ width: ACTION_WIDTH, alignItems: 'flex-end' }}>{remove}</View>
    </View>
  );
}

export function MembersCard({
  ledgerId,
  members,
  loading,
  isOwner,
  invite,
}: MembersCardProps): React.JSX.Element {
  const { t } = useTranslation();
  const colors = useColors();
  const wide = useIsWide();
  const remove = useRemoveMember(ledgerId);

  const onRemove = (member: LedgerMember): void => {
    const name = memberLabel(member);
    void (async () => {
      const ok = await confirm({
        title: t('ledger:settings.members.remove_title'),
        body: t('ledger:settings.members.remove_confirm', { name }),
        tone: 'danger',
        icon: 'x',
        confirmLabel: t('ledger:settings.members.remove_action'),
      });
      if (!ok) return;
      remove.mutate(member.user_id, {
        onSuccess: () => toast.success(t('ledger:settings.members.removed_toast', { name })),
      });
    })();
  };

  const head = (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'baseline',
        gap: space['3'],
        paddingHorizontal: wide ? GRID_PADDING : space['4'],
        paddingVertical: space['2'],
      }}
    >
      <Text variant={wide ? 'heading' : 'subheading'} weight={700} style={{ flex: 1 }}>
        {t('ledger:settings.members.title')}
      </Text>
      <Text variant="caption" tone="muted" mono weight={450} testID="member-count">
        {t('ledger:settings.members.count', { count: members.length })}
      </Text>
    </View>
  );

  const columns = wide ? (
    <View
      testID="members-columns"
      style={{
        flexDirection: 'row',
        gap: GRID_GAP,
        paddingHorizontal: GRID_PADDING,
        paddingVertical: space['2'] + 2,
        backgroundColor: colors['bg.subtle'],
      }}
    >
      <Text variant="micro" tone="muted" mono weight={600} style={{ flexGrow: 1, flexBasis: 0 }}>
        {t('ledger:settings.members.col_name')}
      </Text>
      <Text variant="micro" tone="muted" mono weight={600} style={{ width: ROLE_WIDTH }}>
        {t('ledger:settings.members.col_role')}
      </Text>
      <Text variant="micro" tone="muted" mono weight={600} style={{ flexGrow: 1, flexBasis: 0 }}>
        {t('ledger:settings.members.col_joined')}
      </Text>
      <View style={{ width: ACTION_WIDTH }} />
    </View>
  ) : null;

  // The invite panel goes in the footer slot, not into the row list: `ListCard` keys its
  // children by position, so a member arriving would remount the panel and throw away the
  // one-shot code it is holding.
  const footer =
    invite === undefined ? undefined : (
      <View style={{ padding: wide ? space['4'] : space['3'] }}>{invite}</View>
    );

  return (
    <ListCard divided header={head} footer={footer} testID="members-section">
      {columns}
      {loading ? (
        <View style={{ padding: space['4'] }}>
          <Skeleton variant="row" testID="members-skeleton" />
        </View>
      ) : (
        members.map((member) => (
          <MemberRow
            key={member.user_id}
            member={member}
            isOwner={isOwner}
            onRemove={() => onRemove(member)}
          />
        ))
      )}
    </ListCard>
  );
}

export default MembersCard;
