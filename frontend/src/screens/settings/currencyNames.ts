/**
 * Compatibility shim: the currency-name table moved to `@/i18n/currencyNames`, where it sits
 * next to the language pack it reads from and is reachable from outside `src/screens/settings`
 * (屏幕稿 09 / 12 / 14 all name a currency). The settings pages still import it from here for
 * one round; the acceptance task deletes this file once they point at the new path.
 *
 * @deprecated Import from `@/i18n/currencyNames` instead.
 */
export { LOCALISED_CURRENCIES, useCurrencyNames } from '@/i18n/currencyNames';
