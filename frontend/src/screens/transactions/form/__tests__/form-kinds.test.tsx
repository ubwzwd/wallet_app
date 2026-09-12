/**
 * 记一笔 — the expense / income / refund tabs (04 §4.6.1–§4.6.3, §8.3).
 */
import React from 'react';
import { Text as RNText } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react-native';
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import { router as appRouter } from 'expo-router';
import i18next from 'i18next';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { setAuthToken } from '@/api';
import type { Transaction } from '@/api/types';
import { initI18n } from '@/i18n';
import { todayLocalIso } from '@/i18n/format';
import { qk } from '@/queries';
import { AuthProvider, LedgerProvider } from '@/store';
import { PREF_NAMES, setJsonPref } from '@/utils/prefs';
import { ThemeProvider } from '@/theme/ThemeProvider';
import { ConfirmHost, ToastHost, toast } from '@/ui';
import {
  LEDGER_ID,
  makeCategoryTree,
  makeLedger,
  makeSource,
  makeStatsSummary,
  makeTransaction,
  makeUser,
  mockApi,
  mockGet,
  mockPost,
  type MockApi,
} from '@/test';

import TransactionFormScreen from '../TransactionFormScreen';
import { useFormShortcuts } from '../useFormShortcuts';

let queryClient: QueryClient;
let api: MockApi;

const CHECKING = makeSource({
  id: 'src-checking',
  name: '招行储蓄卡',
  type: 'checking',
  default_currency: 'CNY',
});
const CREDIT = makeSource({
  id: 'src-credit',
  name: '招行信用卡',
  type: 'credit',
  default_currency: 'CNY',
});

function Wrapper({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider initialPref="light">
        <AuthProvider queryClient={queryClient}>
          <LedgerProvider ledgerId={LEDGER_ID} ledgers={[makeLedger()]}>
            {children}
          </LedgerProvider>
          <ToastHost />
          <ConfirmHost
            labels={{ confirm: '确认', cancel: '取消', confirmAgain: '再点一次确认' }}
          />
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

const ROUTES = {
  index: () => <RNText>landing</RNText>,
  'l/[ledgerId]/index': () => <RNText>ledger home</RNText>,
  'l/[ledgerId]/transactions/index': () => <RNText>transactions</RNText>,
  'l/[ledgerId]/transactions/new': TransactionFormScreen,
};

const NEW_URL = `/l/${LEDGER_ID}/transactions/new`;

/** The bodies of every `POST .../transactions` the test made. */
function postedTransactions(): Array<Record<string, unknown>> {
  return api.mock.history.post
    .filter((r) => (r.url ?? '').endsWith('/transactions'))
    .map((r) => JSON.parse(String(r.data)) as Record<string, unknown>);
}

beforeEach(async () => {
  api = mockApi();
  // The per-device preferences (last account, recent merchants) live in AsyncStorage and
  // would otherwise leak from one test into the next.
  await AsyncStorage.clear();
  await setAuthToken('test-token');
  toast.clear();
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  await initI18n();
  await i18next.changeLanguage('zh');
  mockGet('/me', makeUser());
  mockGet('/categories', makeCategoryTree());
  mockGet('/rates/currencies', { currencies: { CNY: 'Chinese Yuan', USD: 'US Dollar' } });
  mockGet(`/ledgers/${LEDGER_ID}/sources`, { items: [CHECKING, CREDIT], total: 2 });
  mockPost(`/ledgers/${LEDGER_ID}/transactions`, makeTransaction());
});

afterEach(() => {
  api.restore();
  queryClient.clear();
  toast.clear();
});

/** Pick `food` (level 1 only) in the category picker. */
async function pickFood(): Promise<void> {
  fireEvent.press(await screen.findByTestId('tx-category-trigger'));
  fireEvent.press(await screen.findByTestId('tx-category-l1-food'));
  fireEvent.press(await screen.findByTestId('tx-category-l1-only'));
}

test('an expense is submitted with a negative amount and the §4.6.1 body shape', async () => {
  renderRouter(ROUTES, { initialUrl: `${NEW_URL}?kind=expense`, wrapper: Wrapper });

  fireEvent.changeText(await screen.findByTestId('tx-amount'), '38');
  await pickFood();
  fireEvent.changeText(screen.getByTestId('tx-merchant'), '星巴克');
  fireEvent.changeText(screen.getByTestId('tx-note'), '和同事');
  fireEvent.press(screen.getByTestId('tx-submit'));

  await waitFor(() => expect(postedTransactions()).toHaveLength(1));
  expect(postedTransactions()[0]).toEqual({
    source_id: 'src-checking',
    kind: 'expense',
    amount: '-38.0000',
    currency: 'CNY',
    occurred_at: todayLocalIso(),
    note: '和同事',
    merchant: '星巴克',
    category_l1: 'food',
    category_l2: null,
  });
});

test('income is submitted with a positive amount', async () => {
  renderRouter(ROUTES, { initialUrl: `${NEW_URL}?kind=income`, wrapper: Wrapper });

  fireEvent.changeText(await screen.findByTestId('tx-amount'), '1200');
  fireEvent.press(await screen.findByTestId('tx-category-trigger'));
  fireEvent.press(await screen.findByTestId('tx-category-l1-salary'));
  fireEvent.press(await screen.findByTestId('tx-category-l1-only'));
  fireEvent.press(screen.getByTestId('tx-submit'));

  await waitFor(() => expect(postedTransactions()).toHaveLength(1));
  const body = postedTransactions()[0];
  expect(body.kind).toBe('income');
  expect(body.amount).toBe('1200.0000');
});

test('switching tab rewrites ?kind=, keeps the amount and drops the other tree’s category', async () => {
  const router = renderRouter(ROUTES, {
    initialUrl: `${NEW_URL}?kind=expense`,
    wrapper: Wrapper,
  });

  fireEvent.changeText(await screen.findByTestId('tx-amount'), '38');
  await pickFood();
  fireEvent.press(screen.getByTestId('tx-kind-income'));

  await waitFor(() => expect(router.getSearchParams().kind).toBe('income'));
  // Amount, date and account survive; the expense-tree category does not (decision §1.3).
  expect(screen.getByTestId('tx-amount').props.value).toBe('38.00');
  expect(screen.getByTestId('tx-source-trigger')).toHaveTextContent(CHECKING.name);
  expect(screen.getByTestId('tx-category-trigger')).toHaveTextContent('一级分类');
});

test('the transfer tab renders neither a category control nor a merchant box', async () => {
  renderRouter(ROUTES, { initialUrl: `${NEW_URL}?kind=transfer`, wrapper: Wrapper });

  expect(await screen.findByTestId('transfer-amount')).toBeTruthy();
  expect(screen.queryByTestId('tx-category-trigger')).toBeNull();
  expect(screen.queryByTestId('tx-merchant')).toBeNull();
});

// --------------------------------------------------------------------- refund

const ORIGIN: Transaction = makeTransaction({
  id: 'origin-1',
  source_id: CREDIT.id,
  kind: 'expense',
  amount: '-1299.0000',
  merchant: '京东',
  category_l1: 'shopping',
  category_l2: 'electronics',
  refunded_total: '259.0000',
  refundable: '1040.0000',
});

const USED_UP: Transaction = makeTransaction({
  id: 'origin-2',
  source_id: CREDIT.id,
  kind: 'expense',
  amount: '-799.0000',
  merchant: '苹果',
  category_l1: 'shopping',
  category_l2: 'electronics',
  refunded_total: '799.0000',
  refundable: '0.0000',
});

function mockCandidates(items: Transaction[]): void {
  mockGet(`/ledgers/${LEDGER_ID}/transactions`, {
    items,
    total: items.length,
    limit: 20,
    offset: 0,
    summary: {
      base_currency: 'CNY',
      expense: '0',
      income: '0',
      net: '0',
      count: items.length,
      rate_missing_count: 0,
    },
  });
}

async function linkOrigin(id: string): Promise<void> {
  fireEvent.press(await screen.findByTestId('refund-link'));
  fireEvent.press(await screen.findByTestId(`refund-picker-row-${id}`));
}

test('linking an original expense prefills the category and the account, and both stay editable', async () => {
  mockCandidates([ORIGIN]);
  renderRouter(ROUTES, { initialUrl: `${NEW_URL}?kind=refund`, wrapper: Wrapper });

  await linkOrigin(ORIGIN.id);

  // Category and account now come from the original (decision §1.1).
  expect(await screen.findByTestId('refund-origin-card')).toBeTruthy();
  expect(screen.getByTestId('tx-category-trigger')).toHaveTextContent('消费购物 · 数码');
  expect(screen.getByTestId('tx-source-trigger')).toHaveTextContent(CREDIT.name);

  // …and can still be changed: switching account earns the neutral note, not a block.
  fireEvent.press(screen.getByTestId('tx-source-trigger'));
  fireEvent.press(await screen.findByTestId(`tx-source-option-${CHECKING.id}`));
  expect(await screen.findByTestId('refund-other-source-hint')).toBeTruthy();
});

test('the quick chips fill the amount box and an over-refund only warns', async () => {
  mockCandidates([ORIGIN]);
  renderRouter(ROUTES, { initialUrl: `${NEW_URL}?kind=refund`, wrapper: Wrapper });

  await linkOrigin(ORIGIN.id);

  fireEvent.press(await screen.findByTestId('refund-chip-remaining'));
  expect(screen.getByTestId('tx-amount').props.value).toBe('1,040.00');
  expect(screen.queryByTestId('refund-over-warning')).toBeNull();

  // Past the refundable balance: a warning, and saving still goes through (decision §1.1).
  fireEvent.press(screen.getByTestId('refund-chip-full'));
  expect(screen.getByTestId('tx-amount').props.value).toBe('1,299.00');
  expect(await screen.findByTestId('refund-over-warning')).toBeTruthy();

  fireEvent.press(screen.getByTestId('tx-submit'));
  await waitFor(() => expect(postedTransactions()).toHaveLength(1));
  const body = postedTransactions()[0];
  expect(body.kind).toBe('refund');
  expect(body.amount).toBe('1299.0000');
  expect(body.refund_of).toBe(ORIGIN.id);
});

test('a fully refunded original is greyed out but still selectable (decision §14.52 B10)', async () => {
  mockCandidates([ORIGIN, USED_UP]);
  renderRouter(ROUTES, { initialUrl: `${NEW_URL}?kind=refund`, wrapper: Wrapper });

  fireEvent.press(await screen.findByTestId('refund-link'));
  const marker = await screen.findByTestId(`refund-candidate-remaining-${USED_UP.id}`);
  expect(marker).toHaveTextContent('已退完');

  fireEvent.press(screen.getByTestId(`refund-picker-row-${USED_UP.id}`));
  expect(await screen.findByTestId('refund-origin-card')).toBeTruthy();
  fireEvent.changeText(screen.getByTestId('tx-amount'), '20');
  fireEvent.press(screen.getByTestId('tx-submit'));

  await waitFor(() => expect(postedTransactions()).toHaveLength(1));
  expect(postedTransactions()[0].refund_of).toBe(USED_UP.id);
});

test('?refund_of= alone prefills the original’s category and account, both still editable', async () => {
  // 「登记退款」 on the detail page links straight here: the URL can carry the id, never the
  // category — so the form has to fetch the original and inherit it (04 §4.6.3 / §4.7).
  mockGet(`/ledgers/${LEDGER_ID}/transactions/${ORIGIN.id}`, ORIGIN);
  renderRouter(ROUTES, { initialUrl: `${NEW_URL}?refund_of=${ORIGIN.id}`, wrapper: Wrapper });

  expect(await screen.findByTestId('refund-origin-card')).toBeTruthy();
  await waitFor(() =>
    expect(screen.getByTestId('tx-category-trigger')).toHaveTextContent('消费购物 · 数码'),
  );
  // The original sits on the credit card, not on the default (first) account.
  expect(screen.getByTestId('tx-source-trigger')).toHaveTextContent(CREDIT.name);

  // Both are prefills, not decisions: the user can still change either one.
  await pickFood();
  expect(screen.getByTestId('tx-category-trigger')).toHaveTextContent('餐饮');
  fireEvent.press(screen.getByTestId('tx-source-trigger'));
  fireEvent.press(await screen.findByTestId(`tx-source-option-${CHECKING.id}`));
  expect(await screen.findByTestId('refund-other-source-hint')).toBeTruthy();
});

// ------------------------------------------------------- 离开确认 (04 §4.6.5)

test('the cancel button asks exactly once and then really leaves', async () => {
  const router = renderRouter(ROUTES, { initialUrl: `${NEW_URL}?kind=expense`, wrapper: Wrapper });

  fireEvent.changeText(await screen.findByTestId('tx-amount'), '38');
  fireEvent.press(screen.getByTestId('tx-cancel'));

  expect(await screen.findByTestId('confirm-dialog')).toBeTruthy();
  await act(async () => {
    fireEvent.press(screen.getByTestId('confirm-accept'));
  });

  // The navigation the guard itself makes is the answer, not a second exit to challenge.
  await waitFor(() =>
    expect(router.getPathname()).toBe(`/l/${LEDGER_ID}/transactions`),
  );
  expect(screen.queryByTestId('confirm-dialog')).toBeNull();
});

test('a route change away from a dirty form is intercepted, and staying works', async () => {
  const router = renderRouter(ROUTES, {
    initialUrl: `/l/${LEDGER_ID}/transactions`,
    wrapper: Wrapper,
  });
  act(() => {
    appRouter.push(`${NEW_URL}?kind=expense` as never);
  });

  fireEvent.changeText(await screen.findByTestId('tx-amount'), '38');

  // Nobody pressed 取消 — this is the browser's back button / a nav control.
  await act(async () => {
    appRouter.back();
  });
  expect(await screen.findByTestId('confirm-dialog')).toBeTruthy();

  await act(async () => {
    fireEvent.press(screen.getByTestId('confirm-cancel'));
  });
  expect(screen.getByTestId('tx-amount').props.value).toBe('38.00');
  expect(router.getPathname()).toBe(`${NEW_URL}`);

  // Answering "leave" lets the very same navigation through.
  await act(async () => {
    appRouter.back();
  });
  await act(async () => {
    fireEvent.press(await screen.findByTestId('confirm-accept'));
  });
  await waitFor(() => expect(router.getPathname()).toBe(`/l/${LEDGER_ID}/transactions`));
});

test('the stats preview reads the cached monthly summary and adds the new amount locally', async () => {
  const month = todayLocalIso().slice(0, 7);
  queryClient.setQueryData(
    qk.ledger(LEDGER_ID).statsSum(month),
    makeStatsSummary({
      month,
      base_currency: 'CNY',
      expense: [
        {
          code: 'food',
          name_zh: '餐饮',
          name_en: 'Food',
          amount: '1240.0000',
          share: 1,
          count: 9,
          children: [],
        },
      ],
    }),
  );

  renderRouter(ROUTES, { initialUrl: `${NEW_URL}?kind=expense`, wrapper: Wrapper });

  fireEvent.changeText(await screen.findByTestId('tx-amount'), '38');
  await pickFood();

  const preview = await screen.findByTestId('stats-preview');
  expect(preview).toHaveTextContent('本月餐饮 ¥1,240.00 → ¥1,278.00');
  // Nothing was fetched for it (decision §14.52 A9).
  expect(api.mock.history.get.filter((r) => (r.url ?? '').includes('/stats/'))).toHaveLength(0);
});

test('the merchant box suggests recent merchants, preferring the chosen category', async () => {
  await setJsonPref(PREF_NAMES.recentMerchants(LEDGER_ID), [
    { name: '山姆', l1: 'groceries' },
    { name: '星巴克', l1: 'food' },
  ]);

  renderRouter(ROUTES, { initialUrl: `${NEW_URL}?kind=expense`, wrapper: Wrapper });

  await screen.findByTestId('tx-amount');
  await pickFood();
  fireEvent(screen.getByTestId('tx-merchant'), 'focus');

  const panel = await screen.findByTestId('tx-merchant-suggestions');
  // Both are offered, the one last used with 餐饮 first.
  expect(panel).toHaveTextContent('最近商户星巴克山姆');
  fireEvent.press(screen.getByTestId('tx-merchant-suggestion-星巴克'));
  expect(screen.getByTestId('tx-merchant').props.value).toBe('星巴克');
});

test('"保存并再记一笔" clears the amount, keeps account and category, and counts', async () => {
  renderRouter(ROUTES, { initialUrl: `${NEW_URL}?kind=expense`, wrapper: Wrapper });

  fireEvent.changeText(await screen.findByTestId('tx-amount'), '38');
  await pickFood();
  fireEvent.changeText(screen.getByTestId('tx-merchant'), '星巴克');
  fireEvent.press(screen.getByTestId('tx-submit-again'));

  await waitFor(() => expect(postedTransactions()).toHaveLength(1));
  await waitFor(() => expect(screen.getByTestId('tx-amount').props.value).toBe(''));
  expect(screen.getByTestId('tx-merchant').props.value).toBe('');
  expect(screen.getByTestId('tx-source-trigger')).toHaveTextContent(CHECKING.name);
  expect(screen.getByTestId('tx-category-trigger')).toHaveTextContent('餐饮');
  expect(toast.peek().some((item) => item.message.includes('第 1 笔'))).toBe(true);

  // Still on the form — a second entry can go straight in.
  expect(screen.getByTestId('tx-submit-again')).toBeTruthy();
});

test('「复制一笔」 copies account / merchant / category / amount and moves the date to today', async () => {
  const ORIGINAL = makeTransaction({
    id: 'tx-to-copy',
    source_id: CREDIT.id,
    kind: 'expense',
    amount: '-88.0000',
    currency: 'CNY',
    occurred_at: '2026-07-01',
    merchant: '山姆',
    note: '囤货',
    category_l1: 'groceries',
    category_l2: null,
  });
  mockGet(`/ledgers/${LEDGER_ID}/transactions/tx-to-copy`, ORIGINAL);

  renderRouter(ROUTES, { initialUrl: `${NEW_URL}?copy_of=tx-to-copy`, wrapper: Wrapper });

  await waitFor(() => expect(screen.getByTestId('tx-amount').props.value).toBe('88.00'));
  expect(screen.getByTestId('tx-merchant').props.value).toBe('山姆');
  expect(screen.getByTestId('tx-note').props.value).toBe('囤货');
  expect(screen.getByTestId('tx-source-trigger')).toHaveTextContent(CREDIT.name);
  expect(screen.getByTestId('tx-category-trigger')).toHaveTextContent('生活购物');
  // A copy is a new entry made today, not a second copy of an old day (04 §4.7).
  expect(screen.getByTestId('tx-date').props.value).toBe(todayLocalIso());
  expect(screen.getByTestId('tx-date').props.value).not.toBe(ORIGINAL.occurred_at);
});

test('⌘S saves the *value* of an expression still sitting in the amount box', async () => {
  renderRouter(ROUTES, { initialUrl: `${NEW_URL}?kind=expense`, wrapper: Wrapper });

  // No blur: `AmountField` has not evaluated anything yet, the raw text is what the form
  // holds — pressing 保存 must still save 30.10, not fail on 「金额只能是数字」.
  fireEvent.changeText(await screen.findByTestId('tx-amount'), '12.5+8.8*2');
  await pickFood();
  fireEvent.press(screen.getByTestId('tx-submit'));

  await waitFor(() => expect(postedTransactions()).toHaveLength(1));
  expect(postedTransactions()[0].amount).toBe('-30.1000');
});

// ------------------------------------------------ keyboard shortcuts (decision §14.52 A19)

interface FakeKeyEvent {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  target?: unknown;
  preventDefault(): void;
}

function keyEvent(over: Partial<FakeKeyEvent> & { key: string }): FakeKeyEvent {
  return {
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    target: null,
    preventDefault: jest.fn(),
    ...over,
  };
}

/** A stand-in for `document` — the hook only ever touches add/removeEventListener. */
function stubDocument(): {
  press(event: FakeKeyEvent): void;
  listeners(): number;
  restore(): void;
} {
  const registered = new Set<(event: FakeKeyEvent) => void>();
  const host = globalThis as unknown as { document?: unknown };
  const previous = host.document;
  const had = 'document' in host;
  host.document = {
    addEventListener: (_type: string, fn: (event: FakeKeyEvent) => void) => {
      registered.add(fn);
    },
    removeEventListener: (_type: string, fn: (event: FakeKeyEvent) => void) => {
      registered.delete(fn);
    },
  };
  return {
    press: (event) => registered.forEach((fn) => fn(event)),
    listeners: () => registered.size,
    restore: () => {
      if (had) host.document = previous;
      else delete host.document;
    },
  };
}

test('useFormShortcuts maps every key, ignores text boxes and unhooks when disabled', () => {
  const doc = stubDocument();
  const handlers = {
    onSave: jest.fn(),
    onSaveAndNext: jest.fn(),
    onDiscard: jest.fn(),
    onKind: jest.fn(),
    onHelp: jest.fn(),
  };
  try {
    const { rerender, unmount } = renderHook(
      ({ enabled }: { enabled: boolean }) => useFormShortcuts({ ...handlers, enabled }),
      { initialProps: { enabled: true } },
    );

    doc.press(keyEvent({ key: 's', metaKey: true }));
    expect(handlers.onSave).toHaveBeenCalledTimes(1);
    doc.press(keyEvent({ key: 'Enter', ctrlKey: true }));
    expect(handlers.onSaveAndNext).toHaveBeenCalledTimes(1);
    doc.press(keyEvent({ key: 'Escape' }));
    expect(handlers.onDiscard).toHaveBeenCalledTimes(1);
    doc.press(keyEvent({ key: '3' }));
    expect(handlers.onKind).toHaveBeenCalledWith('refund');
    doc.press(keyEvent({ key: '?' }));
    expect(handlers.onHelp).toHaveBeenCalledTimes(1);

    // A digit typed into a field is a digit — the tab row keeps its hands off.
    doc.press(keyEvent({ key: '2', target: { tagName: 'INPUT' } }));
    expect(handlers.onKind).toHaveBeenCalledTimes(1);

    // Disabled means nothing is listening at all (an overlay owns the keyboard).
    rerender({ enabled: false });
    expect(doc.listeners()).toBe(0);
    doc.press(keyEvent({ key: 'Escape' }));
    expect(handlers.onDiscard).toHaveBeenCalledTimes(1);

    unmount();
    expect(doc.listeners()).toBe(0);
  } finally {
    doc.restore();
  }
});
