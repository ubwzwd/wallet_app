/**
 * Static imports of every language pack (04 §5.2). Static (not lazy) import keeps
 * this simple for a two-language app and lets the bundler tree-shake/type-check the
 * JSON like any other module.
 */
import zhCommon from './locales/zh/common.json';
import zhAuth from './locales/zh/auth.json';
import zhLedger from './locales/zh/ledger.json';
import zhTransaction from './locales/zh/transaction.json';
import zhSource from './locales/zh/source.json';
import zhStats from './locales/zh/stats.json';
import zhImport from './locales/zh/import.json';
import zhSettings from './locales/zh/settings.json';
import zhErrors from './locales/zh/errors.json';
import zhValidation from './locales/zh/validation.json';

import enCommon from './locales/en/common.json';
import enAuth from './locales/en/auth.json';
import enLedger from './locales/en/ledger.json';
import enTransaction from './locales/en/transaction.json';
import enSource from './locales/en/source.json';
import enStats from './locales/en/stats.json';
import enImport from './locales/en/import.json';
import enSettings from './locales/en/settings.json';
import enErrors from './locales/en/errors.json';
import enValidation from './locales/en/validation.json';

/** `common` is `defaultNS` (04 §5.2) — keep it first. */
export const namespaces = [
  'common',
  'auth',
  'ledger',
  'transaction',
  'source',
  'stats',
  'import',
  'settings',
  'errors',
  'validation',
] as const;

export const resources = {
  zh: {
    common: zhCommon,
    auth: zhAuth,
    ledger: zhLedger,
    transaction: zhTransaction,
    source: zhSource,
    stats: zhStats,
    import: zhImport,
    settings: zhSettings,
    errors: zhErrors,
    validation: zhValidation,
  },
  en: {
    common: enCommon,
    auth: enAuth,
    ledger: enLedger,
    transaction: enTransaction,
    source: enSource,
    stats: enStats,
    import: enImport,
    settings: enSettings,
    errors: enErrors,
    validation: enValidation,
  },
} as const;
