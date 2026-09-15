/**
 * Case table part 2 for `src/api/__tests__/modules.test.ts` — transactions / transfers / stats / imports / rates
 * (04 §3.4, paths per 03 §5).
 */
import { importsApi, ratesApi, statsApi, txApi } from '@/api';
import {
  LEDGER_ID,
  SOURCE_ID,
  TX_ID,
  makeCurrencyList,
  makeStatsSummary,
  makeStatsTrend,
  makeTransaction,
  makeTransferPair,
} from '@/test/fixtures';

import { BATCH_ID, type Case, NOW, PAIR_ID, ROW_ID, paged } from './apiCaseTypes';

export const ledgerDataCases: Case[] = [
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
        expense: '128.5000',
        income: '0.0000',
        net: '-128.5000',
        count: 1,
        rate_missing_count: 0,
      },
    },
    call: () =>
      txApi.list(LEDGER_ID, {
        q: '咖啡',
        kind: ['refund', 'expense'],
        from: '2026-08-01',
        to: undefined,
        currency: [],
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
    name: 'txApi.getTransfer',
    method: 'get',
    path: `/ledgers/${LEDGER_ID}/transactions/transfer/${PAIR_ID}`,
    reply: makeTransferPair(),
    call: () => txApi.getTransfer(LEDGER_ID, PAIR_ID),
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
    body: { other_transaction_id: 'bbbb2222-7777-4888-8999-000011112222' },
    reply: makeTransferPair(),
    call: () =>
      txApi.pair(LEDGER_ID, TX_ID, {
        other_transaction_id: 'bbbb2222-7777-4888-8999-000011112222',
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
