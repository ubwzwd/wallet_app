/**
 * CURR-01/02/03: Live currency picker tests.
 *
 * Verifies that both form screens replaced their hardcoded CURRENCIES arrays
 * with live useQuery fetches, and implement the correct Platform-branched UI
 * (FlatList modal on native, horizontal scroll on web).
 */
import * as fs from 'fs';
import * as path from 'path';

const TRANSACTION_FORM = fs.readFileSync(
  path.join(__dirname, '../src/screens/TransactionFormScreen.tsx'),
  'utf8'
);

const FINANCE_FORM = fs.readFileSync(
  path.join(__dirname, '../src/screens/FinanceSourceFormScreen.tsx'),
  'utf8'
);

const RATES_API = fs.readFileSync(
  path.join(__dirname, '../src/api/rates.ts'),
  'utf8'
);

// ─── rates.ts module ─────────────────────────────────────────────────────────

describe('rates.ts API module', () => {
  it('exports getCurrencies function', () => {
    expect(RATES_API).toContain('export const getCurrencies');
  });

  it('calls GET /rates/currencies endpoint', () => {
    expect(RATES_API).toContain('/rates/currencies');
  });

  it('is typed as Promise<CurrencyList>', () => {
    expect(RATES_API).toContain('CurrencyList');
  });

  it('uses apiClient for the HTTP call', () => {
    expect(RATES_API).toContain('apiClient');
  });
});

// ─── CURR-01: TransactionFormScreen ──────────────────────────────────────────

describe('CURR-01: TransactionFormScreen live currency fetch', () => {
  it('uses QUERY_KEYS.CURRENCIES as the query key', () => {
    expect(TRANSACTION_FORM).toContain('QUERY_KEYS.CURRENCIES');
  });

  it('fetches currencies via ratesApi.getCurrencies', () => {
    expect(TRANSACTION_FORM).toContain('ratesApi.getCurrencies');
  });

  it('has no hardcoded CURRENCIES constant array', () => {
    expect(TRANSACTION_FORM).not.toContain("const CURRENCIES = [");
  });

  it('sets staleTime: Infinity on the currencies query', () => {
    expect(TRANSACTION_FORM).toContain('staleTime: Infinity');
  });

  it('imports ratesApi from the rates API module', () => {
    expect(TRANSACTION_FORM).toContain("from '@/api/rates'");
  });
});

// ─── CURR-02: FinanceSourceFormScreen ────────────────────────────────────────

describe('CURR-02: FinanceSourceFormScreen live currency fetch', () => {
  it('uses QUERY_KEYS.CURRENCIES as the query key', () => {
    expect(FINANCE_FORM).toContain('QUERY_KEYS.CURRENCIES');
  });

  it('fetches currencies via ratesApi.getCurrencies', () => {
    expect(FINANCE_FORM).toContain('ratesApi.getCurrencies');
  });

  it('has no hardcoded CURRENCIES constant array', () => {
    expect(FINANCE_FORM).not.toContain("const CURRENCIES = [");
  });

  it('sets staleTime: Infinity on the currencies query', () => {
    expect(FINANCE_FORM).toContain('staleTime: Infinity');
  });
});

// ─── CURR-03: Platform-branched picker UI ────────────────────────────────────

describe('CURR-03: Platform-branched currency picker (TransactionFormScreen)', () => {
  it('has a Platform.OS web branch for horizontal scroll', () => {
    expect(TRANSACTION_FORM).toContain("Platform.OS === 'web'");
  });

  it('renders a Modal for native picker', () => {
    expect(TRANSACTION_FORM).toContain('<Modal');
  });

  it('renders a FlatList inside the native modal', () => {
    expect(TRANSACTION_FORM).toContain('<FlatList');
  });

  it('modal title is "Select Currency"', () => {
    expect(TRANSACTION_FORM).toContain('Select Currency');
  });

  it('modal has a Close button', () => {
    expect(TRANSACTION_FORM).toContain('Close');
  });

  it('selected item uses highlight background color #eff6ff', () => {
    expect(TRANSACTION_FORM).toContain('#eff6ff');
  });
});

describe('CURR-03: Platform-branched currency picker (FinanceSourceFormScreen)', () => {
  it('renders a Modal for native picker', () => {
    expect(FINANCE_FORM).toContain('<Modal');
  });

  it('modal title is "Select Currency"', () => {
    expect(FINANCE_FORM).toContain('Select Currency');
  });

  it('has a Platform.OS web branch', () => {
    expect(FINANCE_FORM).toContain("Platform.OS === 'web'");
  });
});
