/** The import cache layer: request paths and the invalidation matrix of 04 §3.6. */
import React from 'react';
import { QueryClient, QueryClientProvider, focusManager } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react-native';

import type { ImportRow, Paged } from '@/api/types';
import {
  BATCH_ID,
  IMPORT_ROW_ID,
  LEDGER_ID,
  SOURCE_ID,
  makeImportBatch,
  makeImportCommitResult,
  makeImportDeleteResult,
  makeImportRow,
  makeImportUploadResult,
} from '@/test/fixtures';
import { mockApi, mockDelete, mockGet, mockPatch, mockPost, type MockApi } from '@/test/mockApi';

import { qk } from '../keys';
import {
  useCommitImport,
  useDeleteImport,
  useImportBatch,
  useImportRows,
  useImports,
  usePatchImportRow,
  usePatchImportRows,
  useUploadImport,
  useUploadImportText,
} from '../useImports';

const L = LEDGER_ID;
const B = BATCH_ID;
const BASE = `/ledgers/${L}/imports`;

function makeClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: 0, gcTime: Infinity },
    },
  });
}

function wrapper(qc: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

let api: MockApi;
let qc: QueryClient;

beforeEach(() => {
  api = mockApi();
  qc = makeClient();
});

afterEach(() => {
  qc.clear();
  api.restore();
});

/** Path of every request the harness recorded, in order. */
function paths(): string[] {
  return api.mock.history.map((r) => String(r.url));
}

const rowsKey = (params: object = {}) => [...qk.ledger(L).importRows(B), params] as const;

describe('queries', () => {
  it('useImports reads the batch history and keys its filters', async () => {
    mockGet(BASE, { items: [makeImportBatch()], total: 1 });
    const { result } = renderHook(() => useImports(L, { status: ['ready'] }), {
      wrapper: wrapper(qc),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.total).toBe(1);
    expect(api.mock.history[0]?.params).toEqual({ status: ['ready'] });
    expect(qc.getQueryData([...qk.ledger(L).imports(), { status: ['ready'] }])).toBeDefined();
  });

  it('useImports stays disabled without a ledger id', () => {
    renderHook(() => useImports(undefined), { wrapper: wrapper(qc) });
    expect(paths()).toEqual([]);
  });

  it('useImportBatch reads one batch', async () => {
    mockGet(`${BASE}/${B}`, makeImportBatch());
    const { result } = renderHook(() => useImportBatch(L, B), { wrapper: wrapper(qc) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(paths()).toEqual([`${BASE}/${B}`]);
    expect(result.current.data?.id).toBe(B);
  });

  it('useImportRows turns refetchOnWindowFocus off (04 §2.4 exception)', async () => {
    mockGet(`${BASE}/${B}/rows`, { items: [makeImportRow()], total: 1 });
    const { result } = renderHook(() => useImportRows(L, B), { wrapper: wrapper(qc) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const observer = qc.getQueryCache().find({ queryKey: rowsKey() })?.observers[0];
    expect(observer?.options.refetchOnWindowFocus).toBe(false);

    // And the behaviour that option buys: regaining focus does not re-read the table.
    focusManager.setFocused(false);
    focusManager.setFocused(true);
    await waitFor(() => expect(result.current.isFetching).toBe(false));
    expect(paths()).toEqual([`${BASE}/${B}/rows`]);
  });

  it('the batch history does refetch on focus, unlike the rows table', async () => {
    mockGet(BASE, { items: [makeImportBatch()], total: 1 });
    const { result } = renderHook(() => useImports(L), { wrapper: wrapper(qc) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    focusManager.setFocused(false);
    focusManager.setFocused(true);
    await waitFor(() => expect(paths().length).toBe(2));
  });
});

describe('upload', () => {
  it('seeds batch and rows from the 201, so review needs no second request', async () => {
    const uploaded = makeImportUploadResult();
    mockPost(BASE, uploaded, 201);
    const { result } = renderHook(() => useUploadImport(L), { wrapper: wrapper(qc) });

    result.current.mutate({ source_id: SOURCE_ID, file: new Blob(['# version: x']) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(qc.getQueryData(qk.ledger(L).importB(uploaded.batch.id))).toEqual(uploaded.batch);
    expect(qc.getQueryData(rowsKey())).toEqual({
      items: uploaded.rows,
      total: uploaded.rows.length,
    });

    // Mounting the rows hook now paints from cache: still exactly the one POST.
    const rows = renderHook(() => useImportRows(L, B), { wrapper: wrapper(qc) });
    expect(rows.result.current.data?.items).toHaveLength(uploaded.rows.length);
    expect(paths()).toEqual([BASE]);
  });

  it('upload invalidates the batch history', async () => {
    mockPost(BASE, makeImportUploadResult(), 201);
    const spy = jest.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useUploadImport(L), { wrapper: wrapper(qc) });
    result.current.mutate({ source_id: SOURCE_ID, file: new Blob(['x']) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(spy).toHaveBeenCalledWith({ queryKey: qk.ledger(L).imports() });
  });

  it('uploadText posts JSON and seeds the same keys', async () => {
    const uploaded = makeImportUploadResult();
    mockPost(BASE, uploaded, 201);
    const { result } = renderHook(() => useUploadImportText(L), { wrapper: wrapper(qc) });
    result.current.mutate({ source_id: SOURCE_ID, text: '# version: 2026-09-10\n' });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(JSON.parse(String(api.mock.history[0]?.data))).toEqual({
      source_id: SOURCE_ID,
      text: '# version: 2026-09-10\n',
    });
    expect(qc.getQueryData(rowsKey())).toBeDefined();
  });

  it('a silent upload marks the mutation so the global toast stays quiet', async () => {
    mockPost(BASE, { detail: 'bad', code: 'import_format_invalid' }, 400);
    const { result } = renderHook(() => useUploadImport(L, { silent: true }), {
      wrapper: wrapper(qc),
    });
    result.current.mutate({ source_id: SOURCE_ID, file: new Blob(['x']) });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(qc.getMutationCache().getAll()[0]?.meta?.silent).toBe(true);
  });
});

describe('row edits', () => {
  beforeEach(() => {
    const page: Paged<ImportRow> = {
      items: [makeImportRow(), makeImportRow({ id: 'other-row-id', row_no: 2 })],
      total: 2,
    };
    qc.setQueryData(rowsKey(), page);
    qc.setQueryData(rowsKey({ uncategorized: true }), page);
  });

  it('patchRow only writes the cache — it never invalidates', async () => {
    const edited = makeImportRow({ status: 'edited', category_l2: 'lunch', merchant: '全家' });
    mockPatch(`${BASE}/${B}/rows/${IMPORT_ROW_ID}`, edited);
    const spy = jest.spyOn(qc, 'invalidateQueries');

    const { result } = renderHook(() => usePatchImportRow(L, B), { wrapper: wrapper(qc) });
    result.current.mutate({ row_id: IMPORT_ROW_ID, patch: { category_l2: 'lunch' } });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(spy).not.toHaveBeenCalled();
    // Every cached page that held the row now holds the edited one; the others are intact.
    for (const key of [rowsKey(), rowsKey({ uncategorized: true })]) {
      const page = qc.getQueryData<Paged<ImportRow>>(key);
      expect(page?.items[0]).toEqual(edited);
      expect(page?.items[1]?.id).toBe('other-row-id');
      expect(page?.total).toBe(2);
    }
  });

  it('patchRows invalidates the rows table and the batch summary', async () => {
    mockPatch(`${BASE}/${B}/rows`, { updated: 2, rows: [makeImportRow()] });
    const spy = jest.spyOn(qc, 'invalidateQueries');

    const { result } = renderHook(() => usePatchImportRows(L, B), { wrapper: wrapper(qc) });
    result.current.mutate({ row_ids: [IMPORT_ROW_ID, 'other-row-id'], patch: { status: 'skipped' } });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(spy).toHaveBeenCalledWith({ queryKey: qk.ledger(L).importRows(B) });
    expect(spy).toHaveBeenCalledWith({ queryKey: qk.ledger(L).importB(B) });
  });
});

describe('commit and delete', () => {
  it('commit sweeps imports, transactions, sources, stats and my accounts', async () => {
    mockPost(`${BASE}/${B}/commit`, makeImportCommitResult());
    const spy = jest.spyOn(qc, 'invalidateQueries');

    const { result } = renderHook(() => useCommitImport(L, B), { wrapper: wrapper(qc) });
    result.current.mutate();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const k = qk.ledger(L);
    const swept = spy.mock.calls.map(([arg]) => JSON.stringify(arg?.queryKey));
    expect(swept).toContain(JSON.stringify([...k.root(), 'imports']));
    expect(swept).toContain(JSON.stringify(k.txRoot()));
    expect(swept).toContain(JSON.stringify(k.sourcesRoot()));
    expect(swept).toContain(JSON.stringify(k.statsRoot()));
    // Balances sum every ledger an account is used in (decision §14.62).
    expect(swept).toContain(JSON.stringify(qk.global.sourcesRoot()));
  });

  it('a dry run changes nothing in the cache', async () => {
    qc.setQueryData(qk.ledger(L).importB(B), makeImportBatch());
    mockDelete(`${BASE}/${B}`, makeImportDeleteResult({ deleted: false }));
    const spy = jest.spyOn(qc, 'invalidateQueries');

    const { result } = renderHook(() => useDeleteImport(L, B), { wrapper: wrapper(qc) });
    result.current.mutate({ dry_run: true });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(api.mock.history[0]?.params).toEqual({ dry_run: true });
    expect(spy).not.toHaveBeenCalled();
    expect(qc.getQueryData(qk.ledger(L).importB(B))).toBeDefined();
  });

  it('a real revert sweeps like commit and drops the batch entry', async () => {
    qc.setQueryData(qk.ledger(L).importB(B), makeImportBatch());
    qc.setQueryData(rowsKey(), { items: [makeImportRow()], total: 1 });
    mockDelete(`${BASE}/${B}`, makeImportDeleteResult({ deleted: true, deleted_transactions: 123 }));
    const spy = jest.spyOn(qc, 'invalidateQueries');

    const { result } = renderHook(() => useDeleteImport(L, B), { wrapper: wrapper(qc) });
    result.current.mutate({});
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(spy).toHaveBeenCalledWith({ queryKey: qk.ledger(L).txRoot() });
    expect(spy).toHaveBeenCalledWith({ queryKey: qk.global.sourcesRoot() });
    expect(qc.getQueryData(qk.ledger(L).importB(B))).toBeUndefined();
    expect(qc.getQueryData(rowsKey())).toBeUndefined();
  });
});
