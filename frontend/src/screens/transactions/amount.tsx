/**
 * How the 交易 feature writes money (决策 §14.59a, 屏幕稿 01 / 02 / 07 / 08).
 *
 * One rule, applied from the list row to the impact card: an amount in the ledger's **base
 * currency** is written bare — 「−45.00」, 「+18,000.00」 — because the page has already said
 * once which currency it counts in and a 「¥」 on every line of a grid is noise. Anything in
 * another currency keeps its symbol (「−S$12.40」), because there the symbol is the only
 * thing telling the two numbers apart.
 *
 * The exceptions §14.59a keeps for `formatMoney` are the *headline* numbers — the detail
 * page's big amount, the form's 「这一笔」 — and the 「≈ ¥66.20」 conversion line, both of
 * which stand alone rather than in a column.
 */
import React from 'react';
import { type StyleProp, View, type ViewStyle } from 'react-native';
import { useTranslation } from 'react-i18next';

import type { Money, TxKind } from '@/api/types';
import { type Lang, useLang } from '@/i18n';
import {
  type FormatMoneyOptions,
  formatAmountPlain,
  formatConverted,
  formatMoney,
} from '@/i18n/format';
import { useLedgerContext } from '@/store';
import type { TypeVariant } from '@/theme/tokens';
import { KIND_AMOUNT_TONE, type MoneyBase, Text, type TextTone } from '@/ui';

export type SignDisplay = NonNullable<FormatMoneyOptions['signDisplay']>;

/**
 * 「3,000.00」 / 「+5,000.00」 — the bare number with `formatMoney`'s sign rules.
 *
 * `formatAmountPlain` writes its own U+2212 and never a '+', so `never` drops that minus
 * and `always` adds the plus here.
 */
export function plainAmount(
  amount: Money | number,
  currency: string,
  signDisplay: SignDisplay = 'auto',
): string {
  const value = typeof amount === 'number' ? amount : Number(amount);
  const digits = formatAmountPlain(amount, currency);
  if (signDisplay === 'never') return value < 0 ? digits.slice(1) : digits;
  if (signDisplay === 'always' && value > 0) return `+${digits}`;
  return digits;
}

/** Bare in the base currency, symbol in every other one (§14.59a). */
export function amountText(
  amount: Money | number,
  currency: string,
  baseCurrency: string,
  lang: Lang,
  signDisplay: SignDisplay = 'auto',
): string {
  if (currency.toUpperCase() === baseCurrency.toUpperCase()) {
    return plainAmount(amount, currency, signDisplay);
  }
  return formatMoney(amount, currency, lang, { signDisplay });
}

/** `amountText` bound to the open ledger's base currency and the active language. */
export function useAmountText(): (
  amount: Money | number,
  currency: string,
  signDisplay?: SignDisplay,
) => string {
  const lang = useLang();
  const { baseCurrency } = useLedgerContext();
  return React.useCallback(
    (amount, currency, signDisplay) =>
      amountText(amount, currency, baseCurrency, lang, signDisplay),
    [baseCurrency, lang],
  );
}

export interface RowAmountProps {
  amount: Money;
  currency: string;
  /** The ledger's base currency: it decides bare vs. symbol, nothing else. */
  baseCurrency: string;
  /** Decides the colour only; the sign already lives in `amount`. */
  kind?: TxKind;
  /** Renders the 「≈ ¥66.20」 second line when `base_currency !== currency`. */
  base?: MoneyBase;
  size?: TypeVariant;
  lang?: Lang;
  signDisplay?: SignDisplay;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * The amount cell of a list row or a table row (屏幕稿 02) — `MoneyText`'s shape with
 * §14.59a's writing rule. A row's own currency is what is printed; the ledger's base
 * currency only decides whether the symbol is worth the space.
 *
 * Positive amounts carry a '+' by default because 屏幕稿 02 writes 「+18,000.00」: without
 * the symbol the sign is the only mark separating money coming in from money going out.
 * Transfers opt out (`signDisplay="auto"`): a transfer moves nothing in or out.
 */
export function RowAmount({
  amount,
  currency,
  baseCurrency,
  kind,
  base,
  size = 'subheading',
  lang,
  signDisplay,
  style,
  testID,
}: RowAmountProps): React.JSX.Element {
  const { t } = useTranslation();
  const activeLang = useLang();
  const l = lang ?? activeLang;
  const tone: TextTone = kind ? KIND_AMOUNT_TONE[kind] : 'primary';
  const sign: SignDisplay = signDisplay ?? (kind === 'transfer' ? 'auto' : 'always');
  const showConverted = base !== undefined && base.base_currency !== currency;

  return (
    <View style={style}>
      <Text variant={size} tone={tone} mono testID={testID}>
        {amountText(amount, currency, baseCurrency, l, sign)}
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
