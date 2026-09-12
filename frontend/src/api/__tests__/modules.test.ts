/**
 * Table-driven coverage of the whole 04 §3.4 function list: method, URL, query
 * serialisation and request body for every resource module. The tables themselves live
 * in `@/test/apiCasesCore` and `@/test/apiCasesData` (jest treats every file under
 * `__tests__/` as a suite, so helpers cannot live next to this file).
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
import { BATCH_ID } from '@/test/apiCaseTypes';
import { coreCases } from '@/test/apiCasesCore';
import { ledgerDataCases } from '@/test/apiCasesData';
import { LEDGER_ID, SOURCE_ID } from '@/test/fixtures';
import { apiUrl, mockApi, type MockApi } from '@/test/mockApi';

const cases = [...coreCases, ...ledgerDataCases];

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

  describe('public endpoints stay anonymous (03 §5.3, §5.5)', () => {
    function authHeader(config: { headers?: unknown }): unknown {
      const h = config.headers as
        | (Record<string, unknown> & { get?: (n: string) => unknown })
        | undefined;
      return typeof h?.get === 'function' ? h.get('Authorization') : h?.['Authorization'];
    }

    it('GET /config and GET /import-format send no Authorization when anonymous', async () => {
      api.mockGet('/config', { registration_open: true });
      api.mockGet('/import-format', { version: '2026-09-10', columns: [] });

      await configApi.get();
      await importFormatApi.get();

      expect(api.mock.history.get).toHaveLength(2);
      for (const sent of api.mock.history.get) {
        expect(authHeader(sent) ?? undefined).toBeUndefined();
      }
    });
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

    it('importsApi.uploadText goes through apiClient, not uploadClient', async () => {
      api.mockPost(`/ledgers/${LEDGER_ID}/imports`, { batch: { id: BATCH_ID }, rows: [] }, 201);
      await importsApi.uploadText(LEDGER_ID, { source_id: SOURCE_ID, text: 'a,b\n1,2\n' });
      const sent = api.mock.history.post[0];
      // apiClient's own timeout: pasted text is plain JSON, not a multipart upload.
      expect(sent.timeout).toBe(15_000);
      expect(typeof sent.data).toBe('string');
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
