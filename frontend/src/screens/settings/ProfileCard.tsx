/**
 * Personal settings → the profile card (屏幕稿 14).
 *
 * A 64 round letter avatar, the display name (「我」 while it is empty) and the email in
 * mono, a hairline, then the two fields that describe *you*: 显示名 and 默认币种, side by
 * side on a wide screen. Narrow keeps only 显示名 here — the mockup moves 默认币种 into the
 * 偏好 card, next to 外观 and 语言.
 */
import React from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';

import type { User } from '@/api/types';
import { formatDateTime } from '@/i18n/format';
import { useLang } from '@/i18n';
import { space } from '@/theme/tokens';
import { useColors } from '@/theme/ThemeProvider';
import { useIsWide } from '@/theme/useBreakpoint';
import { Avatar, Card, Skeleton, Text, TextField } from '@/ui';

/** Decision §14.6: a display name is at most 40 characters, and may be empty. */
export const DISPLAY_NAME_MAX_LENGTH = 40;

/** The part of an email before `@` — what an empty display name falls back to. */
export function emailPrefix(email: string): string {
  const at = email.indexOf('@');
  return at > 0 ? email.slice(0, at) : email;
}

export interface ProfileCardProps {
  /** `undefined` while `GET /me` is still in flight. */
  user: User | undefined;
  name: string;
  onNameChange(next: string): void;
  disabled: boolean;
  /** The 默认币种 field; the wide layout puts it in this card's second column. */
  currencyField?: React.ReactNode;
  /** The 「保存」 button for the display name — the only field here that is not saved on
   *  change, so it rides inside the field's trailing slot (§14.61). */
  nameAction?: React.ReactNode;
}

export function ProfileCard({
  user,
  name,
  onNameChange,
  disabled,
  currencyField,
  nameAction,
}: ProfileCardProps): React.JSX.Element {
  const { t } = useTranslation();
  const lang = useLang();
  const colors = useColors();
  const wide = useIsWide();

  // The two fields share the row only on a wide screen; in a column `flexBasis: 0` would
  // size them by height and collapse them to nothing.
  const columnStyle = wide
    ? { flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 0 }
    : { minWidth: 0 };

  const nameField = (
    <View style={columnStyle}>
      <TextField
        testID="settings-display-name"
        label={t('settings:display_name_label')}
        accessibilityLabel={t('settings:display_name_label')}
        placeholder={t('settings:display_name_placeholder')}
        value={name}
        onChangeText={onNameChange}
        // No counter: 屏幕稿 14 leaves the field clean, and 40 characters is a cap nobody
        // bumps into for a nickname. `maxLength` still enforces it.
        maxLength={DISPLAY_NAME_MAX_LENGTH}
        disabled={disabled}
        hint={t('settings:display_name_hint', {
          fallback: user ? emailPrefix(user.email) : '',
        })}
        suffix={nameAction}
      />
    </View>
  );

  return (
    <Card
      variant="raised"
      testID="profile-card"
      style={{ padding: wide ? space['6'] - 2 : space['4'], gap: space['5'] }}
    >
      {user ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space['4'] }}>
          <Avatar
            name={user.display_name ?? emailPrefix(user.email)}
            size={wide ? 64 : 56}
            tone="accent"
          />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text variant="heading" weight={700} numberOfLines={1} testID="settings-display-title">
              {user.display_name ?? t('settings:display_name_empty')}
            </Text>
            <Text variant="caption" tone="muted" mono weight={450} testID="settings-email">
              {user.email}
            </Text>
            <Text variant="micro" tone="muted" mono testID="settings-created-at">
              {`${t('settings:created_at_label')} ${formatDateTime(user.created_at)}`}
            </Text>
          </View>
        </View>
      ) : (
        <Skeleton variant="row" testID="settings-profile-skeleton" />
      )}

      <View
        style={{
          flexDirection: wide ? 'row' : 'column',
          gap: space['5'],
          paddingTop: space['5'],
          borderTopWidth: 1,
          borderTopColor: colors['border.default'],
        }}
      >
        {nameField}
        {currencyField === undefined ? null : <View style={columnStyle}>{currencyField}</View>}
      </View>
    </Card>
  );
}

export default ProfileCard;
