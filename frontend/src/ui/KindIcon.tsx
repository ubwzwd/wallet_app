/**
 * The round icon wells the mockups put in front of every row (01 / 07 / 08 / 09).
 *
 * Two families share one shape: the four transaction kinds (decision §1) and the four
 * account types (decision §14.48). Colour is never the only carrier (04 §6.2 rule 7), so
 * the well always holds an icon and always exposes a translated accessible name.
 */
import React from 'react';
import { type StyleProp, View, type ViewStyle } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { SourceType, TxKind } from '@/api/types';
import { type ColorToken, radius } from '@/theme/tokens';
import { useColors } from '@/theme/ThemeProvider';
import { Icon, KIND_ICON, SOURCE_TYPE_ICON, type IconName } from './Icon';

/** Foreground / subtle-background token pairs; the subtle tone is only ever the icon well. */
export const KIND_FG: Readonly<Record<TxKind, ColorToken>> = {
  expense: 'kind.expense',
  income: 'kind.income',
  refund: 'kind.refund',
  transfer: 'kind.transfer',
};
export const KIND_SUBTLE: Readonly<Record<TxKind, ColorToken>> = {
  expense: 'kind.expense.subtle',
  income: 'kind.income.subtle',
  refund: 'kind.refund.subtle',
  transfer: 'kind.transfer.subtle',
};

/** Account types (mockup 09): the saving card wears the accent, the others a status tint. */
export const SOURCE_TYPE_FG: Readonly<Record<SourceType, ColorToken>> = {
  checking: 'accent.solid',
  credit: 'status.danger.fg',
  cash: 'status.warning.fg',
  other: 'status.info.fg',
};
export const SOURCE_TYPE_SUBTLE: Readonly<Record<SourceType, ColorToken>> = {
  checking: 'accent.subtle',
  credit: 'status.danger.bg',
  cash: 'status.warning.bg',
  other: 'status.info.bg',
};

/** The i18n key of a kind's label — also useful to callers building their own chips. */
export function kindLabelKey(kind: TxKind): string {
  return `transaction:kind.${kind}`;
}

/** The i18n key of an account type's label. */
export function sourceTypeLabelKey(type: SourceType): string {
  return `source:type.${type}`;
}

interface WellProps {
  size: number;
  bg: string;
  fg: string;
  icon: IconName;
  label: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

function IconWell({ size, bg, fg, icon, label, style, testID }: WellProps): React.JSX.Element {
  return (
    <View
      testID={testID}
      accessibilityRole="image"
      accessibilityLabel={label}
      style={[
        {
          width: size,
          height: size,
          flexShrink: 0,
          borderRadius: radius.pill,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: bg,
        },
        style,
      ]}
    >
      <Icon name={icon} size={Math.round(size * 0.52)} color={fg} />
    </View>
  );
}

export interface KindIconProps {
  kind: TxKind;
  /** 34 in a narrow list row, 36 in a wide one, 32 inline (the mockups' three sizes). */
  size?: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** A circular well tinted with `kind.*.subtle`, holding the kind's arrow. */
export function KindIcon({ kind, size = 34, style, testID }: KindIconProps): React.JSX.Element {
  const colors = useColors();
  const { t } = useTranslation();
  return (
    <IconWell
      size={size}
      bg={colors[KIND_SUBTLE[kind]]}
      fg={colors[KIND_FG[kind]]}
      icon={KIND_ICON[kind]}
      label={t(kindLabelKey(kind))}
      style={style}
      testID={testID}
    />
  );
}

export interface SourceTypeIconProps {
  type: SourceType;
  size?: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** The same well for an account: card / bank / cash / wallet on its type tint. */
export function SourceTypeIcon({
  type,
  size = 36,
  style,
  testID,
}: SourceTypeIconProps): React.JSX.Element {
  const colors = useColors();
  const { t } = useTranslation();
  return (
    <IconWell
      size={size}
      bg={colors[SOURCE_TYPE_SUBTLE[type]]}
      fg={colors[SOURCE_TYPE_FG[type]]}
      icon={SOURCE_TYPE_ICON[type]}
      label={t(sourceTypeLabelKey(type))}
      style={style}
      testID={testID}
    />
  );
}
