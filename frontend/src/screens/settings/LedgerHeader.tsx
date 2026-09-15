/**
 * Ledger settings → the page head (屏幕稿 12 账本设置 1440 / 375).
 *
 * Wide: a square letter avatar, the ledger name at the title step and one mono grey line
 * — 「建于 2025-06-14 · 328 笔交易 · 基准币种 CNY」 — with 「改名字」 pushed to the right.
 * Narrow: the same three facts inside the white card the mockup draws under the top bar,
 * with the pencil as an icon button.
 *
 * Renaming happens in place (04 §4.12): the name swaps for a `TextField` and the action
 * pair becomes 保存 / 取消. Only an owner sees the affordance at all (decision §2).
 */
import React from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';

import type { LedgerDetail, Uuid } from '@/api/types';
import { formatDate } from '@/i18n/format';
import { useLang } from '@/i18n';
import { useUpdateLedger } from '@/queries';
import { space } from '@/theme/tokens';
import { useIsWide } from '@/theme/useBreakpoint';
import { Avatar, Button, Card, Text, TextField, toast } from '@/ui';

/** Decision §14.13: a ledger name is 1–100 characters. */
export const LEDGER_NAME_MAX_LENGTH = 100;

const nameSchema = z.string().trim().min(1, 'required').max(LEDGER_NAME_MAX_LENGTH, 'max_length');

export interface LedgerHeaderProps {
  ledgerId: Uuid;
  /** `undefined` while `GET /ledgers/{id}` is still in flight. */
  detail: LedgerDetail | undefined;
  /** Name from the ledger list, so the header is never blank on the first paint. */
  fallbackName: string;
  memberCount: number;
  canEdit: boolean;
}

export function LedgerHeader({
  ledgerId,
  detail,
  fallbackName,
  memberCount,
  canEdit,
}: LedgerHeaderProps): React.JSX.Element {
  const { t } = useTranslation();
  const lang = useLang();
  const wide = useIsWide();
  // Not `{ silent: true }`: the header renders no server error of its own, so a failed
  // rename has to reach the user through the global error Toast.
  const update = useUpdateLedger(ledgerId);

  const serverName = detail?.name ?? fallbackName;
  const [editing, setEditing] = React.useState(false);
  const [name, setName] = React.useState(serverName);

  // 04 §3.8 step 3: a refreshed ledger (first load, or the invalidation a 409 triggers)
  // overwrites the field only while the user is not typing into it.
  React.useEffect(() => {
    if (editing) return;
    setName(serverName);
  }, [serverName, editing]);

  const parsed = nameSchema.safeParse(name);
  const errorKey = parsed.success ? undefined : parsed.error.issues[0]?.message;
  const error = errorKey
    ? t([`validation:${errorKey}`, 'validation:required'], { max: LEDGER_NAME_MAX_LENGTH })
    : null;

  const save = (): void => {
    if (!detail || !parsed.success) return;
    if (parsed.data === detail.name) {
      setEditing(false);
      return;
    }
    update.mutate(
      { name: parsed.data, updated_at: detail.updated_at },
      {
        onSuccess: () => {
          setEditing(false);
          toast.success(t('ledger:settings.header.name_saved_toast'));
        },
      },
    );
  };

  const created = detail ? formatDate(detail.created_at.slice(0, 10), lang) : '';
  const meta = detail
    ? wide
      ? t('ledger:settings.header.meta', {
          date: created,
          count: detail.counts.transactions,
          currency: detail.base_currency,
        })
      : t('ledger:settings.header.meta_narrow', { date: created, count: memberCount })
    : '';

  const identity = editing ? (
    <View style={{ flex: 1, minWidth: 0, gap: space['2'] }}>
      <TextField
        testID="ledger-name-input"
        label={t('ledger:settings.header.name_label')}
        accessibilityLabel={t('ledger:settings.header.name_label')}
        value={name}
        onChangeText={setName}
        error={error}
        maxLength={LEDGER_NAME_MAX_LENGTH}
        showCounter
        disabled={!detail || update.isPending}
      />
    </View>
  ) : (
    <View style={{ flex: 1, minWidth: 0 }}>
      <Text
        variant={wide ? 'title' : 'subheading'}
        weight={700}
        numberOfLines={1}
        accessibilityRole="header"
        testID="ledger-name"
      >
        {serverName}
      </Text>
      {meta === '' ? null : (
        <Text
          variant="caption"
          tone="muted"
          mono
          weight={450}
          // 13/19 — the step 屏幕稿 12 draws for 「建于 2025-06-14 · 328 笔交易 · …」.
          style={wide ? { fontSize: 13, lineHeight: 19 } : undefined}
          testID="ledger-header-meta"
        >
          {meta}
        </Text>
      )}
    </View>
  );

  const actions = !canEdit ? null : editing ? (
    <View style={{ flexDirection: 'row', gap: space['2'], flexShrink: 0 }}>
      <Button
        testID="ledger-name-cancel"
        label={t('ledger:settings.header.rename_cancel')}
        variant="ghost"
        onPress={() => {
          setEditing(false);
          setName(serverName);
        }}
      />
      <Button
        testID="ledger-name-save"
        label={t('ledger:settings.header.save')}
        onPress={save}
        loading={update.isPending}
        disabled={!detail || !parsed.success}
      />
    </View>
  ) : wide ? (
    <Button
      testID="ledger-rename"
      label={t('ledger:settings.header.rename')}
      icon="pencil"
      variant="secondary"
      onPress={() => setEditing(true)}
      style={{ flexShrink: 0 }}
    />
  ) : (
    <Button
      testID="ledger-rename"
      accessibilityLabel={t('ledger:settings.header.rename')}
      icon="pencil"
      iconOnly
      variant="soft"
      size="sm"
      onPress={() => setEditing(true)}
    />
  );

  const row = (
    <View
      style={{
        flexDirection: 'row',
        alignItems: editing ? 'flex-end' : 'center',
        gap: wide ? space['3'] + 2 : space['3'],
      }}
    >
      <Avatar name={serverName} shape="square" size={wide ? 48 : 44} />
      {identity}
      {actions}
    </View>
  );

  if (wide) {
    return (
      <View testID="ledger-settings-header" style={{ gap: space['3'] }}>
        {row}
      </View>
    );
  }
  return (
    <Card variant="raised" padded testID="ledger-settings-header" style={{ padding: space['4'] }}>
      {row}
    </Card>
  );
}

export default LedgerHeader;
