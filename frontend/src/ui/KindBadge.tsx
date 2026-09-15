/**
 * The four transaction kinds (decision §1) as a read-only badge, plus the account type
 * badge the account table shows (mockup 09: 储蓄卡 / 信用卡 / 现金).
 *
 * The round icon well lives in `KindIcon.tsx`; this module is only about the pills.
 * Colour is never the only carrier (04 §6.2 rule 7), so the kind badge always pairs the
 * semantic colour with an icon and the translated label.
 */
import React from 'react';
import { type StyleProp, View, type ViewStyle } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { SourceType, TxKind } from '@/api/types';
import { space } from '@/theme/tokens';
import { Badge, type BadgeTone } from './Badge';
import { KIND_ICON } from './Icon';
import { KindIcon, kindLabelKey, sourceTypeLabelKey } from './KindIcon';

const KIND_BADGE_TONE: Readonly<Record<TxKind, BadgeTone>> = {
  expense: 'kind-expense',
  income: 'kind-income',
  refund: 'kind-refund',
  transfer: 'kind-transfer',
};

/** Mockup 09 paints the type pill with the same tints as the account's icon well. */
const SOURCE_TYPE_BADGE_TONE: Readonly<Record<SourceType, BadgeTone>> = {
  checking: 'accent',
  credit: 'danger',
  cash: 'warning',
  other: 'info',
};

export interface KindBadgeProps {
  kind: TxKind;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function KindBadge({ kind, style, testID }: KindBadgeProps): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <Badge
      testID={testID}
      tone={KIND_BADGE_TONE[kind]}
      icon={KIND_ICON[kind]}
      label={t(kindLabelKey(kind))}
      style={style}
    />
  );
}

export interface SourceTypeBadgeProps {
  type: SourceType;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** The account type as a plain pill — no icon, the row already carries the type's well. */
export function SourceTypeBadge({
  type,
  style,
  testID,
}: SourceTypeBadgeProps): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <Badge
      testID={testID}
      tone={SOURCE_TYPE_BADGE_TONE[type]}
      label={t(sourceTypeLabelKey(type))}
      style={style}
    />
  );
}

export interface KindRowProps {
  kind: TxKind;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** Icon well + badge, the pairing the transaction list row header uses. */
export function KindRow({ kind, style, testID }: KindRowProps): React.JSX.Element {
  return (
    <View
      testID={testID}
      style={[{ flexDirection: 'row', alignItems: 'center', gap: space['2'] }, style]}
    >
      <KindIcon kind={kind} size={32} />
      <KindBadge kind={kind} />
    </View>
  );
}
