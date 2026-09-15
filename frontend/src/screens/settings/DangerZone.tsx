/**
 * Ledger settings → 危险操作 (屏幕稿 12, 04 §4.12, decision §14.52 A22).
 *
 * Three rows in one white card — 转让 owner / 退出账本 / 删除账本 — each a round icon well,
 * a title, one line of consequence and a chevron. Transferring opens in place (the member
 * picker unfolds under its row); leaving goes through `confirm`, and deleting opens
 * 屏幕稿 12's own dialog, which only unlocks once the ledger's name has been typed out by
 * hand. No CSV export first (decision §14.52 A1).
 *
 * A member sees the card with 退出账本 alone: decision §2 grants them nothing else here.
 */
import React from 'react';
import { Pressable, View } from 'react-native';
import { type Href, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import type { LedgerDetail, LedgerMember, Uuid } from '@/api/types';
import { routes } from '@/domain/routes';
import {
  memberLabel,
  useDeleteLedger,
  useLeaveLedger,
  useTransferOwnership,
} from '@/queries';
import { space } from '@/theme/tokens';
import { useColors } from '@/theme/ThemeProvider';
import { useIsWide } from '@/theme/useBreakpoint';
import { Button, Icon, type IconName, ListCard, Select, Text, confirm, toast } from '@/ui';
import type { TintTone } from '@/ui';

import { DeleteLedgerDialog } from './DeleteLedgerDialog';
import { IconWell } from './IconWell';
import { SectionLabel } from './SectionLabel';

export interface DangerZoneProps {
  ledgerId: Uuid;
  /** `undefined` while `GET /ledgers/{id}` is still in flight. */
  detail: LedgerDetail | undefined;
  ledgerName: string;
  members: readonly LedgerMember[];
  isOwner: boolean;
}

interface DangerRowProps {
  icon: IconName;
  tone: TintTone;
  title: string;
  subtitle: string;
  danger?: boolean;
  disabled?: boolean;
  onPress(): void;
  testID: string;
}

function DangerRow({
  icon,
  tone,
  title,
  subtitle,
  danger = false,
  disabled = false,
  onPress,
  testID,
}: DangerRowProps): React.JSX.Element {
  const colors = useColors();
  const wide = useIsWide();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      accessibilityLabel={title}
      disabled={disabled}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => ({
        minHeight: 60,
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: space['3'],
        paddingHorizontal: wide ? space['5'] : space['4'],
        paddingVertical: space['3'],
        opacity: disabled ? 0.55 : 1,
        backgroundColor: pressed && !disabled ? colors['bg.hover'] : 'transparent',
      })}
    >
      <IconWell name={icon} tone={tone} size={32} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text variant="subheading" weight={500} tone={danger ? 'danger' : 'primary'}>
          {title}
        </Text>
        <Text variant="caption" tone="muted">
          {subtitle}
        </Text>
      </View>
      <Icon name="chevron-right" size={16} color={colors['fg.muted']} />
    </Pressable>
  );
}

export function DangerZone({
  ledgerId,
  detail,
  ledgerName,
  members,
  isOwner,
}: DangerZoneProps): React.JSX.Element {
  const { t } = useTranslation();
  const router = useRouter();
  const wide = useIsWide();
  const transfer = useTransferOwnership(ledgerId);
  const leave = useLeaveLedger(ledgerId);
  const remove = useDeleteLedger(ledgerId);

  const [transferOpen, setTransferOpen] = React.useState(false);
  const [transferTo, setTransferTo] = React.useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = React.useState(false);

  const others = members.filter((m) => !m.is_me);
  const name = detail?.name ?? ledgerName;

  const onTransfer = (): void => {
    const target = members.find((m) => m.user_id === transferTo);
    if (!target) return;
    const who = memberLabel(target);
    void (async () => {
      const ok = await confirm({
        title: t('ledger:settings.danger.transfer_confirm_title'),
        body: t('ledger:settings.danger.transfer_confirm', { name: who }),
        icon: 'key-round',
        doubleTap: true,
        confirmLabel: t('ledger:settings.danger.transfer_submit'),
      });
      if (!ok) return;
      transfer.mutate(
        { to_user_id: target.user_id },
        {
          onSuccess: () => {
            setTransferTo(null);
            setTransferOpen(false);
            toast.success(t('ledger:settings.danger.transferred_toast', { name: who }));
          },
        },
      );
    })();
  };

  const onLeave = (): void => {
    void (async () => {
      const ok = await confirm({
        title: t('ledger:settings.danger.leave_confirm_title'),
        body: t('ledger:settings.danger.leave_confirm', { name }),
        tone: 'danger',
        icon: 'log-out',
        confirmLabel: t('ledger:settings.danger.leave_action'),
      });
      if (!ok) return;
      leave.mutate(undefined, {
        onSuccess: () => {
          toast.success(t('ledger:settings.danger.left_toast', { name }));
          router.replace(routes.ledgers() as Href);
        },
      });
    })();
  };

  // 屏幕稿 12 · 删除账本 is its own dialog (count tiles, a danger-ringed name box, a grey
  // foot band), not the generic `confirm()` — see `DeleteLedgerDialog.tsx`.
  const onDelete = (): void => {
    if (!detail) return;
    setDeleteOpen(true);
  };

  const confirmDelete = (): void => {
    if (!detail) return;
    remove.mutate(undefined, {
      onSuccess: () => {
        setDeleteOpen(false);
        toast.success(t('ledger:settings.danger.deleted_toast', { name: detail.name }));
        router.replace(routes.ledgers() as Href);
      },
    });
  };

  // 屏幕稿 12 1440 heads the card from inside; the 375 frame sets a small mono label in the
  // danger ink above it instead.
  const head = wide ? (
    <View style={{ paddingHorizontal: space['5'], paddingVertical: space['2'] }}>
      <Text variant="subheading" weight={700} tone="danger" accessibilityRole="header">
        {t('ledger:settings.danger.title')}
      </Text>
    </View>
  ) : undefined;

  const card = (
    <ListCard divided header={head} testID="danger-zone">
      {isOwner ? (
        <View>
          <DangerRow
            testID="transfer-ownership"
            icon="key-round"
            tone="info"
            title={t('ledger:settings.danger.transfer_title')}
            subtitle={
              others.length === 0
                ? t('ledger:settings.danger.transfer_sub_none')
                : t('ledger:settings.danger.transfer_sub')
            }
            disabled={others.length === 0}
            onPress={() => setTransferOpen((v) => !v)}
          />
          {transferOpen && others.length > 0 ? (
            <View
              style={{
                paddingHorizontal: wide ? space['5'] : space['4'],
                paddingBottom: space['4'],
                gap: space['2'] + 2,
              }}
              testID="transfer-panel"
            >
              <Select
                testID="transfer-target"
                label={t('ledger:settings.danger.transfer_select_label')}
                placeholder={t('ledger:settings.danger.transfer_placeholder')}
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
                label={t('ledger:settings.danger.transfer_submit')}
                variant="secondary"
                onPress={onTransfer}
                loading={transfer.isPending}
                disabled={transferTo === null}
              />
            </View>
          ) : null}
        </View>
      ) : null}

      <DangerRow
        testID="leave-ledger"
        icon="log-out"
        tone="warning"
        title={t('ledger:settings.danger.leave_title')}
        subtitle={
          isOwner
            ? t('ledger:settings.danger.leave_sub_owner')
            : t('ledger:settings.danger.leave_sub')
        }
        disabled={isOwner}
        onPress={onLeave}
      />

      {isOwner ? (
        <DangerRow
          testID="delete-ledger"
          icon="trash-2"
          tone="danger"
          danger
          title={t('ledger:settings.danger.delete_title')}
          subtitle={t('ledger:settings.danger.delete_sub', {
            count: detail?.counts.transactions ?? 0,
          })}
          disabled={!detail}
          onPress={onDelete}
        />
      ) : null}
    </ListCard>
  );

  const dialog = detail ? (
    <DeleteLedgerDialog
      open={deleteOpen}
      name={detail.name}
      counts={{
        transactions: detail.counts.transactions,
        sources: detail.counts.sources,
        imports: detail.counts.import_batches,
      }}
      busy={remove.isPending}
      onCancel={() => setDeleteOpen(false)}
      onConfirm={confirmDelete}
    />
  ) : null;

  if (wide) {
    return (
      <>
        {card}
        {dialog}
      </>
    );
  }
  return (
    <View>
      <SectionLabel title={t('ledger:settings.danger.title')} danger />
      {card}
      {dialog}
    </View>
  );
}

export default DangerZone;
