/**
 * Localised currency names (屏幕稿 09 / 12 / 14).
 *
 * `GET /rates/currencies` answers with the ISO English name of every code it knows
 * (「Chinese Renminbi Yuan」), which is what 屏幕稿 12 does *not* print: it reads
 * 「基准币种 · CNY 人民币」. The backend payload is not localised and is out of this
 * phase's scope, so the language pack carries a short table of the codes people here
 * actually use and the server's name stays as the fallback for everything else.
 */
import { useTranslation } from 'react-i18next';

/** The codes `ledger:settings.currency.names` covers, in both language packs. */
export const LOCALISED_CURRENCIES = [
  'CNY',
  'SGD',
  'USD',
  'HKD',
  'EUR',
  'JPY',
  'GBP',
  'AUD',
  'TWD',
  'KRW',
] as const;

/**
 * `code → name`: the language pack first, the server's English name for the rest.
 * Pass the `names` map of `useCurrencies()`; both maps may be missing entries.
 */
export function useCurrencyNames(
  serverNames?: Readonly<Record<string, string>>,
): Record<string, string> {
  const { t } = useTranslation();
  const merged: Record<string, string> = { ...(serverNames ?? {}) };
  for (const code of LOCALISED_CURRENCIES) {
    merged[code] = t(`ledger:settings.currency.names.${code}`);
  }
  return merged;
}
