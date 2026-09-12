/**
 * Money display (04 §4.5 行内容, §6.2 规则 2 / 6): mono + tabular figures, a real U+2212
 * minus, and the kind's semantic colour — except transfers, which stay `fg.primary`
 * because moving money between your own accounts changes nothing (`kindSemantics`).
 *
 * When the row's currency differs from the ledger's base currency a second line shows the
 * converted amount; `amount_base === null` means "no rate yet" and must say so instead of
 * silently reading as 0 (04 §4.5).
 */
import React from 'react';
import { type StyleProp, View, type ViewStyle } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { Money, TxKind } from '@/api/types';
import type { TypeVariant } from '@/theme/tokens';
import { type Lang, useLang } from '@/i18n';
import { type FormatMoneyOptions, formatConverted, formatMoney } from '@/i18n/format';
import { Text, type TextTone } from './Text';

/** 04 §6.2 rule 2: a transfer amount is never painted with `kind.transfer`. */
export const KIND_AMOUNT_TONE: Readonly<Record<TxKind, TextTone>> = {
  expense: 'expense',
  income: 'income',
  refund: 'refund',
  transfer: 'primary',
};

export interface MoneyBase {
  amount_base: Money | null;
  base_currency: string;
}

export interface MoneyTextProps {
  amount: Money;
  currency: string;
  /** Decides the colour only; the sign already lives in `amount`. */
  kind?: TxKind;
  /** Renders the `≈ ¥1,032.40` second line when `base_currency !== currency`. */
  base?: MoneyBase;
  size?: TypeVariant;
  lang?: Lang;
  signDisplay?: FormatMoneyOptions['signDisplay'];
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function MoneyText({
  amount,
  currency,
  kind,
  base,
  size = 'subheading',
  lang,
  signDisplay,
  style,
  testID,
}: MoneyTextProps): React.JSX.Element {
  const { t } = useTranslation();
  const activeLang = useLang();
  const l = lang ?? activeLang;
  const tone: TextTone = kind ? KIND_AMOUNT_TONE[kind] : 'primary';
  const showConverted = base !== undefined && base.base_currency !== currency;

  return (
    <View style={style}>
      <Text variant={size} tone={tone} mono testID={testID}>
        {formatMoney(amount, currency, l, signDisplay ? { signDisplay } : undefined)}
      </Text>
      {showConverted ? (
        <Text
          variant="caption"
          tone="muted"
          mono={base.amount_base !== null}
          testID={testID ? `${testID}-base` : undefined}
        >
          {base.amount_base === null
            ? t('transaction:list.rate_missing')
            : formatConverted(amount, currency, base.amount_base, base.base_currency, l)}
        </Text>
      ) : null}
    </View>
  );
}
