/**
 * Table-driven coverage of the whole 04 §3.4 function list: method, URL, query
 * serialisation and request body for every resource module.
 */
import {
  apiClient,
  authApi,
  categoriesApi,
  configApi,
  importFormatApi,
  importsApi,
  ledgersApi,
  meApi,
  ratesApi,
  sourcesApi,
  statsApi,
  txApi,
} from '@/api';
import { apiUrl, mockApi, type MockApi } from '@/test/mockApi';
import {
  LEDGER_ID,
  SOURCE_ID,
  TX_ID,
  USER_ID,
  makeCategoryTree,
  makeCurrencyList,
  makeLedger,
  makeSource,
  makeStatsSummary,
  makeStatsTrend,
  makeTransaction,
  makeTransferPair,
  makeUser,
} from '@/test/fixtures';

const PAIR_ID = 'c0ffee00-5555-4666-8777-888899990000';
const BATCH_ID = 'd1e2f3a4-5566-4778-899a-bbccddeeff00';
const ROW_ID = 'e5f6a7b8-9999-4aaa-8bbb-ccccddddeeee';
const NOW = '2026-09-01T12:00:00.000000Z';

type Method = 'get' | 'post' | 'patch' | 'delete';

interface Case {
  name: string;
  method: Method;
  path: string;
  /** Expected serialised query string, without the leading `?`. */
  query?: string;
  /** Expected JSON request body; omit when the request must carry none. */
  body?: unknown;
  status?: number;
  reply?: unknown;
  call: () => Promise<unknown>;
  expected?: unknown;
}

const paged = <T,>(item: T) => ({ items: [item], total: 1 });

const cases: Case[] = [
  // ---------------------------------------------------------------- auth / me
  {
    name: 'authApi.register',
    method: 'post',
    path: '/auth/register',
    body: { email: 'a@b.com', password: 'pw123456', base_currency: 'CNY', language: 'zh' },
    status: 201,
    reply: { access_token: 'jwt', token_type: 'bearer' },
    call: () =>
      authApi.register({
        email: 'a@b.com',
        password: 'pw123456',
        base_currency: 'CNY',
        language: 'zh',
      }),
    expected: { access_token: 'jwt', token_type: 'bearer' },
  },
  {
    name: 'authApi.login',
    method: 'post',
    path: '/auth/login',
    body: { email: 'a@b.com', password: 'pw123456' },
    reply: { access_token: 'jwt', token_type: 'bearer' },
    call: () => authApi.login({ email: 'a@b.com', password: 'pw123456' }),
  },
  {
    name: 'configApi.get',
    method: 'get',
    path: '/config',
    reply: { registration_open: true },
    call: () => configApi.get(),
    expected: { registration_open: true },
  },
  {
    name: 'meApi.get',
    method: 'get',
    path: '/me',
    reply: makeUser(),
    call: () => meApi.get(),
    expected: makeUser(),
  },
  {
    name: 'meApi.update',
    method: 'patch',
    path: '/me',
    body: { display_name: 'Alice', language: null },
    reply: makeUser({ display_name: 'Alice', language: null }),
    call: () => meApi.update({ display_name: 'Alice', language: null }),
  },
  {
    name: 'categoriesApi.get',
    method: 'get',
    path: '/categories',
    reply: makeCategoryTree(),
    call: () => categoriesApi.get(),
    expected: makeCategoryTree(),
  },
  {
    name: 'importFormatApi.get',
    method: 'get',
    path: '/import-format',
    reply: { version: '2026-09-10', headers: [], columns: [] },
    call: () => importFormatApi.get(),
  },

  // ------------------------------------------------------------------ ledgers
  {
    name: 'ledgersApi.list',
    method: 'get',
    path: '/ledgers',
    reply: paged(makeLedger()),
    call: () => ledgersApi.list(),
    expected: paged(makeLedger()),
  },
  {
    name: 'ledgersApi.create',
    method: 'post',
    path: '/ledgers',
    body: { name: '旅行账本', base_currency: 'SGD' },
    status: 201,
    reply: makeLedger({ name: '旅行账本' }),
    call: () => ledgersApi.create({ name: '旅行账本', base_currency: 'SGD' }),
  },
  {
    name: 'ledgersApi.get',
    method: 'get',
    path: `/ledgers/${LEDGER_ID}`,
    reply: { ...makeLedger(), counts: { transactions: 3, sources: 2, import_batches: 1 } },
    call: () => ledgersApi.get(LEDGER_ID),
  },
  {
    name: 'ledgersApi.update',
    method: 'patch',
    path: `/ledgers/${LEDGER_ID}`,
    body: { name: '新名字', updated_at: NOW },
    reply: makeLedger({ name: '新名字' }),
    call: () => ledgersApi.update(LEDGER_ID, { name: '新名字', updated_at: NOW }),
  },
  {
    name: 'ledgersApi.remove',
    method: 'delete',
    path: `/ledgers/${LEDGER_ID}`,
    status: 204,
    call: () => ledgersApi.remove(LEDGER_ID),
    expected: undefined,
  },
  {
    name: 'ledgersApi.members',
    method: 'get',
    path: `/ledgers/${LEDGER_ID}/members`,
    reply: paged({
      user_id: USER_ID,
      email: 'a@b.com',
      display_name: null,
      role: 'owner',
      joined_at: NOW,
      is_me: true,
    }),
    call: () => ledgersApi.members(LEDGER_ID),
  },
  {
    name: 'ledgersApi.removeMember',
    method: 'delete',
    path: `/ledgers/${LEDGER_ID}/members/${USER_ID}`,
    status: 204,
    call: () => ledgersApi.removeMember(LEDGER_ID, USER_ID),
    expected: undefined,
  },
  {
    name: 'ledgersApi.leave',
    method: 'post',
    path: `/ledgers/${LEDGER_ID}/leave`,
    status: 204,
    call: () => ledgersApi.leave(LEDGER_ID),
    expected: undefined,
  },
  {
    name: 'ledgersApi.transferOwnership',
    method: 'post',
    path: `/ledgers/${LEDGER_ID}/transfer-ownership`,
    body: { to_user_id: USER_ID },
    reply: paged({
      user_id: USER_ID,
      email: 'a@b.com',
      display_name: null,
      role: 'owner',
      joined_at: NOW,
      is_me: false,
    }),
    call: () => ledgersApi.transferOwnership(LEDGER_ID, { to_user_id: USER_ID }),
  },
  {
    name: 'ledgersApi.createInvite',
    method: 'post',
    path: `/ledgers/${LEDGER_ID}/invites`,
    status: 201,
    reply: {
      id: 'inv-1',
      code: '482913',
      ledger_id: LEDGER_ID,
      ledger_name: '家庭账本',
      expires_at: NOW,
      created_at: NOW,
    },
    call: () => ledgersApi.createInvite(LEDGER_ID),
  },
  {
    name: 'ledgersApi.revokeInvite',
    method: 'delete',
    path: `/ledgers/${LEDGER_ID}/invites/482913`,
    status: 204,
    call: () => ledgersApi.revokeInvite(LEDGER_ID, '482913'),
    expected: undefined,
  },
  {
    name: 'ledgersApi.join',
    method: 'post',
    path: '/ledgers/join',
    body: { code: '482913' },
    reply: makeLedger({ role: 'member' }),
    call: () => ledgersApi.join({ code: '482913' }),
  },

  // ------------------------------------------------------------------ sources
  {
    name: 'sourcesApi.list with include_archived',
    method: 'get',
    path: `/ledgers/${LEDGER_ID}/sources`,
    query: 'include_archived=true',
    reply: paged(makeSource()),
    call: () => sourcesApi.list(LEDGER_ID, { include_archived: true }),
    expected: paged(makeSource()),
  },
  {
    name: 'sourcesApi.list without params',
    method: 'get',
    path: `/ledgers/${LEDGER_ID}/sources`,
    reply: paged(makeSource()),
    call: () => sourcesApi.list(LEDGER_ID),
  },
  {
    name: 'sourcesApi.create',
    method: 'post',
    path: `/ledgers/${LEDGER_ID}/sources`,
    body: { name: '现金', type: 'cash', default_currency: 'CNY', opening_balance: '100.0000' },
    status: 201,
    reply: makeSource({ name: '现金', type: 'cash' }),
    call: () =>
      sourcesApi.create(LEDGER_ID, {
        name: '现金',
        type: 'cash',
        default_currency: 'CNY',
        opening_balance: '100.0000',
      }),
  },
  {
    name: 'sourcesApi.get',
    method: 'get',
    path: `/ledgers/${LEDGER_ID}/sources/${SOURCE_ID}`,
    reply: makeSource(),
    call: () => sourcesApi.get(LEDGER_ID, SOURCE_ID),
  },
  {
    name: 'sourcesApi.update',
    method: 'patch',
    path: `/ledgers/${LEDGER_ID}/sources/${SOURCE_ID}`,
    body: { archived: true, updated_at: NOW },
    reply: makeSource({ archived: true }),
    call: () => sourcesApi.update(LEDGER_ID, SOURCE_ID, { archived: true, updated_at: NOW }),
  },
  {
    name: 'sourcesApi.remove',
    method: 'delete',
    path: `/ledgers/${LEDGER_ID}/sources/${SOURCE_ID}`,
    status: 204,
    call: () => sourcesApi.remove(LEDGER_ID, SOURCE_ID),
    expected: undefined,
  },

  // ------------------------------------------------------------- transactions
  {
    name: 'txApi.list serialises repeated keys and drops empties',
    method: 'get',
    path: `/ledgers/${LEDGER_ID}/transactions`,
    query: 'from=2026-08-01&kind=expense&kind=refund&offset=100&q=%E5%92%96%E5%95%A1',
    reply: {
      items: [makeTransaction()],
      total: 1,
      summary: {
        base_currency: 'CNY',
        expense_total: '128.5000',
        income_total: '0.0000',
        net: '-128.5000',
        rate_missing_count: 0,
      },
    },
    call: () =>
      txApi.list(LEDGER_ID, {
        q: '咖啡',
        kind: ['refund', 'expense'],
        from: '2026-08-01',
        to: undefined,
        currency: '',
        source_id: [],
        offset: 100,
      }),
  },
  {
    name: 'txApi.create',
    method: 'post',
    path: `/ledgers/${LEDGER_ID}/transactions`,
    body: {
      source_id: SOURCE_ID,
      kind: 'expense',
      amount: '-128.5000',
      currency: 'CNY',
      occurred_at: '2026-08-03',
      category_l1: 'food',
    },
    status: 201,
    reply: makeTransaction(),
    call: () =>
      txApi.create(LEDGER_ID, {
        source_id: SOURCE_ID,
        kind: 'expense',
        amount: '-128.5000',
        currency: 'CNY',
        occurred_at: '2026-08-03',
        category_l1: 'food',
      }),
  },
  {
    name: 'txApi.get',
    method: 'get',
    path: `/ledgers/${LEDGER_ID}/transactions/${TX_ID}`,
    reply: makeTransaction(),
    call: () => txApi.get(LEDGER_ID, TX_ID),
    expected: makeTransaction(),
  },
  {
    name: 'txApi.update carries updated_at',
    method: 'patch',
    path: `/ledgers/${LEDGER_ID}/transactions/${TX_ID}`,
    body: { note: '改一下', updated_at: NOW },
    reply: makeTransaction({ note: '改一下' }),
    call: () => txApi.update(LEDGER_ID, TX_ID, { note: '改一下', updated_at: NOW }),
  },
  {
    name: 'txApi.remove',
    method: 'delete',
    path: `/ledgers/${LEDGER_ID}/transactions/${TX_ID}`,
    status: 204,
    call: () => txApi.remove(LEDGER_ID, TX_ID),
    expected: undefined,
  },
  {
    name: 'txApi.createTransfer posts a flat body',
    method: 'post',
    path: `/ledgers/${LEDGER_ID}/transactions/transfer`,
    body: {
      from_source_id: SOURCE_ID,
      to_source_id: 'dddd4444-8888-4999-8aaa-111122223333',
      amount_out: '1000.0000',
      currency_out: 'CNY',
      amount_in: '1000.0000',
      currency_in: 'CNY',
      occurred_at: '2026-08-03',
      subtype: 'plain',
    },
    status: 201,
    reply: makeTransferPair(),
    call: () =>
      txApi.createTransfer(LEDGER_ID, {
        from_source_id: SOURCE_ID,
        to_source_id: 'dddd4444-8888-4999-8aaa-111122223333',
        amount_out: '1000.0000',
        currency_out: 'CNY',
        amount_in: '1000.0000',
        currency_in: 'CNY',
        occurred_at: '2026-08-03',
        subtype: 'plain',
      }),
  },
  {
    name: 'txApi.updateTransfer',
    method: 'patch',
    path: `/ledgers/${LEDGER_ID}/transactions/transfer/${PAIR_ID}`,
    body: { note: '备注', updated_at: NOW },
    reply: makeTransferPair(),
    call: () => txApi.updateTransfer(LEDGER_ID, PAIR_ID, { note: '备注', updated_at: NOW }),
  },
  {
    name: 'txApi.removeTransfer',
    method: 'delete',
    path: `/ledgers/${LEDGER_ID}/transactions/transfer/${PAIR_ID}`,
    status: 204,
    call: () => txApi.removeTransfer(LEDGER_ID, PAIR_ID),
    expected: undefined,
  },
  {
    name: 'txApi.pair',
    method: 'post',
    path: `/ledgers/${LEDGER_ID}/transactions/${TX_ID}/pair`,
    body: { counterpart_transaction_id: 'bbbb2222-7777-4888-8999-000011112222' },
    reply: makeTransferPair(),
    call: () =>
      txApi.pair(LEDGER_ID, TX_ID, {
        counterpart_transaction_id: 'bbbb2222-7777-4888-8999-000011112222',
      }),
  },
  {
    name: 'txApi.unpair sends no body',
    method: 'post',
    path: `/ledgers/${LEDGER_ID}/transactions/transfer/${PAIR_ID}/unpair`,
    reply: { out: makeTransaction(), in: makeTransaction() },
    call: () => txApi.unpair(LEDGER_ID, PAIR_ID),
  },

  // -------------------------------------------------------------------- stats
  {
    name: 'statsApi.summary',
    method: 'get',
    path: `/ledgers/${LEDGER_ID}/stats/summary`,
    query: 'month=2026-09',
    reply: makeStatsSummary(),
    call: () => statsApi.summary(LEDGER_ID, { month: '2026-09' }),
    expected: makeStatsSummary(),
  },
  {
    name: 'statsApi.trend',
    method: 'get',
    path: `/ledgers/${LEDGER_ID}/stats/trend`,
    query: 'end=2026-09&months=12',
    reply: makeStatsTrend(),
    call: () => statsApi.trend(LEDGER_ID, { months: 12, end: '2026-09' }),
  },

  // ------------------------------------------------------------------ imports
  {
    name: 'importsApi.uploadText posts JSON',
    method: 'post',
    path: `/ledgers/${LEDGER_ID}/imports`,
    body: { source_id: SOURCE_ID, text: '# version: 2026-09-10\n' },
    status: 201,
    reply: { batch: { id: BATCH_ID }, rows: [] },
    call: () =>
      importsApi.uploadText(LEDGER_ID, {
        source_id: SOURCE_ID,
        text: '# version: 2026-09-10\n',
      }),
  },
  {
    name: 'importsApi.list with a repeated status filter',
    method: 'get',
    path: `/ledgers/${LEDGER_ID}/imports`,
    query: 'limit=20&status=committed&status=ready',
    reply: paged({ id: BATCH_ID }),
    call: () => importsApi.list(LEDGER_ID, { status: ['ready', 'committed'], limit: 20 }),
  },
  {
    name: 'importsApi.get',
    method: 'get',
    path: `/ledgers/${LEDGER_ID}/imports/${BATCH_ID}`,
    reply: { id: BATCH_ID },
    call: () => importsApi.get(LEDGER_ID, BATCH_ID),
  },
  {
    name: 'importsApi.rows',
    method: 'get',
    path: `/ledgers/${LEDGER_ID}/imports/${BATCH_ID}/rows`,
    query: 'limit=500&uncategorized=true',
    reply: paged({ id: ROW_ID }),
    call: () => importsApi.rows(LEDGER_ID, BATCH_ID, { uncategorized: true, limit: 500 }),
  },
  {
    name: 'importsApi.patchRow',
    method: 'patch',
    path: `/ledgers/${LEDGER_ID}/imports/${BATCH_ID}/rows/${ROW_ID}`,
    body: { category_l1: 'food', category_l2: 'lunch' },
    reply: { id: ROW_ID, category_l1: 'food' },
    call: () =>
      importsApi.patchRow(LEDGER_ID, BATCH_ID, ROW_ID, {
        category_l1: 'food',
        category_l2: 'lunch',
      }),
  },
  {
    name: 'importsApi.patchRows',
    method: 'patch',
    path: `/ledgers/${LEDGER_ID}/imports/${BATCH_ID}/rows`,
    body: { row_ids: [ROW_ID], patch: { status: 'skipped' } },
    reply: { updated: 1, rows: [{ id: ROW_ID }] },
    call: () =>
      importsApi.patchRows(LEDGER_ID, BATCH_ID, {
        row_ids: [ROW_ID],
        patch: { status: 'skipped' },
      }),
  },
  {
    name: 'importsApi.commit sends no body',
    method: 'post',
    path: `/ledgers/${LEDGER_ID}/imports/${BATCH_ID}/commit`,
    reply: { batch_id: BATCH_ID, status: 'committed' },
    call: () => importsApi.commit(LEDGER_ID, BATCH_ID),
  },
  {
    name: 'importsApi.remove with dry_run',
    method: 'delete',
    path: `/ledgers/${LEDGER_ID}/imports/${BATCH_ID}`,
    query: 'dry_run=true',
    reply: { batch_id: BATCH_ID, mode: 'revert', deleted: false },
    call: () => importsApi.remove(LEDGER_ID, BATCH_ID, { dry_run: true }),
  },

  // -------------------------------------------------------------------- rates
  {
    name: 'ratesApi.currencies',
    method: 'get',
    path: '/rates/currencies',
    reply: makeCurrencyList(),
    call: () => ratesApi.currencies(),
    expected: makeCurrencyList(),
  },
];

describe('API modules (04 §3.4)', () => {
  let api: MockApi;

  beforeEach(() => {
    api = mockApi();
  });

  afterEach(() => {
    api.restore();
  });

  it.each(cases.map((c) => [c.name, c] as const))('%s', async (_name, c) => {
    const replier =
      c.method === 'get'
        ? api.mockGet
        : c.method === 'post'
          ? api.mockPost
          : c.method === 'patch'
            ? api.mockPatch
            : api.mockDelete;
    replier(c.path, c.reply, c.status ?? 200);

    const result = await c.call();

    const history = api.mock.history[c.method];
    expect(history).toHaveLength(1);
    const sent = history[0];
    expect(sent.url).toBe(c.path);

    const uri = apiClient.getUri({ url: sent.url, params: sent.params });
    expect(uri).toBe(c.query ? `${apiUrl(c.path)}?${c.query}` : apiUrl(c.path));

    if (c.body === undefined) {
      expect(sent.data === undefined || sent.data === null || sent.data === '').toBe(true);
    } else {
      expect(JSON.parse(String(sent.data))).toEqual(c.body);
    }

    if ('expected' in c) expect(result).toEqual(c.expected);
    else if (c.reply !== undefined) expect(result).toEqual(c.reply);
  });

  it('covers every function exported by the resource modules', () => {
    const declared = [
      ...Object.keys(authApi).map((k) => `authApi.${k}`),
      ...Object.keys(meApi).map((k) => `meApi.${k}`),
      ...Object.keys(configApi).map((k) => `configApi.${k}`),
      ...Object.keys(categoriesApi).map((k) => `categoriesApi.${k}`),
      ...Object.keys(importFormatApi).map((k) => `importFormatApi.${k}`),
      ...Object.keys(ledgersApi).map((k) => `ledgersApi.${k}`),
      ...Object.keys(sourcesApi).map((k) => `sourcesApi.${k}`),
      ...Object.keys(txApi).map((k) => `txApi.${k}`),
      ...Object.keys(statsApi).map((k) => `statsApi.${k}`),
      ...Object.keys(importsApi).map((k) => `importsApi.${k}`),
      ...Object.keys(ratesApi).map((k) => `ratesApi.${k}`),
    ];
    const exercised = new Set([...cases.map((c) => c.name.split(' ')[0]), 'importsApi.upload']);
    expect(declared.filter((fn) => !exercised.has(fn))).toEqual([]);
  });

  describe('importsApi.upload (multipart)', () => {
    it('goes through uploadClient with a FormData body and reports progress', async () => {
      api.mockPost(`/ledgers/${LEDGER_ID}/imports`, { batch: { id: BATCH_ID }, rows: [] }, 201);
      const onProgress = jest.fn();
      const file = new Blob(['# version: 2026-09-10\n'], { type: 'text/csv' });

      await importsApi.upload(LEDGER_ID, { source_id: SOURCE_ID, file }, onProgress);

      const sent = api.mock.history.post[0];
      expect(sent.url).toBe(`/ledgers/${LEDGER_ID}/imports`);
      expect(sent.data).toBeInstanceOf(FormData);
      // uploadClient's own settings prove the request did not go through apiClient.
      expect(sent.timeout).toBe(60_000);
      expect(typeof sent.onUploadProgress).toBe('function');

      sent.onUploadProgress?.({ loaded: 5, total: 10 } as never);
      expect(onProgress).toHaveBeenCalledWith(0.5);
    });

    it('sends no JSON Content-Type default, leaving the boundary to FormData', async () => {
      api.mockPost(`/ledgers/${LEDGER_ID}/imports`, { batch: { id: BATCH_ID }, rows: [] }, 201);
      const file = new Blob(['x'], { type: 'text/csv' });
      await importsApi.upload(LEDGER_ID, { source_id: SOURCE_ID, file });
      const headers = api.mock.history.post[0].headers as
        | (Record<string, unknown> & { get?: (n: string) => unknown })
        | undefined;
      const contentType =
        typeof headers?.get === 'function' ? headers.get('Content-Type') : headers?.['Content-Type'];
      expect(contentType).not.toBe('application/json');
    });
  });
});
