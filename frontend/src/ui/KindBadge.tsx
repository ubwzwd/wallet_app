/**
 * The four transaction kinds (decision §1) as a round icon chip and as a read-only badge.
 * Colour is never the only carrier (04 §6.2 rule 7): both forms always pair the semantic
 * colour with an icon, and the badge adds the translated label.
 */
import React from 'react';
import { type StyleProp, View, type ViewStyle } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { TxKind } from '@/api/types';
import { type ColorToken, radius, space } from '@/theme/tokens';
import { useColors } from '@/theme/ThemeProvider';
import { Badge, type BadgeTone } from './Badge';
import { Icon, KIND_ICON } from './Icon';

/** Foreground / subtle-background token pairs; the subtle tone is only ever the icon well. */
const KIND_FG: Readonly<Record<TxKind, ColorToken>> = {
  expense: 'kind.expense',
  income: 'kind.income',
  refund: 'kind.refund',
  transfer: 'kind.transfer',
};
const KIND_SUBTLE: Readonly<Record<TxKind, ColorToken>> = {
  expense: 'kind.expense.subtle',
  income: 'kind.income.subtle',
  refund: 'kind.refund.subtle',
  transfer: 'kind.transfer.subtle',
};
const KIND_BADGE_TONE: Readonly<Record<TxKind, BadgeTone>> = {
  expense: 'kind-expense',
  income: 'kind-income',
  refund: 'kind-refund',
  transfer: 'kind-transfer',
};

/** The i18n key of a kind's label — also useful to callers building their own chips. */
export function kindLabelKey(kind: TxKind): string {
  return `transaction:kind.${kind}`;
}

export interface KindIconProps {
  kind: TxKind;
  size?: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** A circular well tinted with `kind.*.subtle`, holding the kind's icon. */
export function KindIcon({ kind, size = 32, style, testID }: KindIconProps): React.JSX.Element {
  const colors = useColors();
  const { t } = useTranslation();
  return (
    <View
      testID={testID}
      accessibilityRole="image"
      accessibilityLabel={t(kindLabelKey(kind))}
      style={[
        {
          width: size,
          height: size,
          borderRadius: radius.pill,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: colors[KIND_SUBTLE[kind]],
        },
        style,
      ]}
    >
      <Icon name={KIND_ICON[kind]} size={Math.round(size * 0.56)} color={colors[KIND_FG[kind]]} />
    </View>
  );
}

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
      <KindIcon kind={kind} />
      <KindBadge kind={kind} />
    </View>
  );
}
