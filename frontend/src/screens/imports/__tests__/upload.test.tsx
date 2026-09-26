/**
 * `/l/:ledgerId/imports/new` — the merged import page (04 §4.10, §8.5 cases 1–6; decisions
 * §5, §14.30, §14.47, §14.52 A18, §14.53d/f, §14.56).
 *
 * Since the guide and the upload form became one page, the skill text lives here: the two
 * tabs, the copy and the download are the first half of §8.5 case 1 (the column table and
 * the sample stayed on `/imports/guide`, see `guide.test.tsx`).
 */
import React from 'react';
import { Text as RNText } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import i18next from 'i18next';

import { setAuthToken } from '@/api';
import { initI18n } from '@/i18n';
import { TopBarProvider, TopBarSurface } from '@/navigation';
import { qk } from '@/queries';
import { AuthProvider, LedgerProvider } from '@/store';
import * as breakpoint from '@/theme/useBreakpoint';
import { ThemeProvider } from '@/theme/ThemeProvider';
import { ConfirmHost, ToastHost, toast } from '@/ui';
import {
  BATCH_ID,
  LEDGER_ID,
  SOURCE_ID,
  makeImportBatch,
  makeImportFormat,
  makeImportUploadResult,
  makeLedger,
  makeSource,
  makeTestHandlers,
  makeTestQueryClient,
  makeUser,
  mockApi,
  mockGet,
  mockPost,
  type MockApi,
  type TestQueryHandlers,
} from '@/test';

import NewImportScreen from '../NewImportScreen';
import { pickFile } from '../useCopyText';

// The file picker is the one thing that genuinely needs a browser; everything else in
// `useCopyText` (clipboard, download) stays real.
jest.mock('../useCopyText', () => {
  const actual = jest.requireActual('../useCopyText');
  return { ...actual, pickFile: jest.fn().mockResolvedValue(null) };
});

const pickFileMock = pickFile as jest.MockedFunction<typeof pickFile>;

let queryClient: QueryClient;
let handlers: TestQueryHandlers;
let api: MockApi;
let wideSpy: jest.SpyInstance;

function setWide(wide: boolean): void {
  wideSpy?.mockRestore();
  wideSpy = jest.spyOn(breakpoint, 'useIsWide').mockReturnValue(wide);
}

const LEDGER = makeLedger({ base_currency: 'CNY' });
const SOURCE = makeSource({ id: SOURCE_ID, name: '招行信用卡', default_currency: 'CNY' });
const ARCHIVED = makeSource({ id: 'src-archived', name: '旧卡', archived: true });
const IMPORTS_PATH = `/ledgers/${LEDGER_ID}/imports`;

function Wrapper({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider initialPref="light">
        <AuthProvider queryClient={queryClient}>
          <LedgerProvider ledgerId={LEDGER_ID} ledgers={[LEDGER]}>
            <TopBarProvider>
              <TopBarSurface onPressLedger={() => {}} />
              {children}
            </TopBarProvider>
          </LedgerProvider>
          <ToastHost />
          <ConfirmHost
            labels={{
              confirm: i18next.t('common:button.confirm'),
              cancel: i18next.t('common:button.cancel'),
              confirmAgain: i18next.t('common:button.confirm_again'),
            }}
          />
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

const ROUTES = {
  index: () => <RNText>landing</RNText>,
  'l/[ledgerId]/imports/index': () => <RNText>import history</RNText>,
  'l/[ledgerId]/imports/new': NewImportScreen,
  'l/[ledgerId]/imports/guide': () => <RNText>guide page</RNText>,
  'l/[ledgerId]/imports/[batchId]': () => <RNText>review table</RNText>,
};

function renderUpload(): ReturnType<typeof renderRouter> {
  return renderRouter(ROUTES, {
    initialUrl: `/l/${LEDGER_ID}/imports/new`,
    wrapper: Wrapper,
  });
}

function csvFile(name = 'statement.csv', size = 1024): File {
  const file = new File(['# version: 2026-09-10\n'], name, { type: 'text/csv' });
  Object.defineProperty(file, 'size', { value: size });
  return file;
}

async function chooseSource(): Promise<void> {
  fireEvent.press(await screen.findByTestId('upload-source-picker-trigger'));
  fireEvent.press(await screen.findByTestId(`upload-source-picker-option-${SOURCE_ID}`));
}

/** Pick a file through the (mocked) picker and wait for the screen to accept it. */
async function chooseFile(file: File): Promise<void> {
  pickFileMock.mockResolvedValueOnce(file);
  // The picker resolves a promise, so the state update lands a tick after the press.
  await act(async () => {
    fireEvent.press(screen.getByTestId('upload-choose-file'));
  });
}

beforeEach(async () => {
  api = mockApi();
  await setAuthToken('test-token');
  toast.clear();
  handlers = makeTestHandlers();
  queryClient = makeTestQueryClient(handlers);
  await initI18n();
  await i18next.changeLanguage('zh');
  setWide(true);
  mockGet('/me', makeUser({ base_currency: 'CNY' }));
  mockGet(`/ledgers/${LEDGER_ID}/sources`, { items: [SOURCE, ARCHIVED], total: 2 });
  mockGet('/import-format', makeImportFormat());
  mockGet(IMPORTS_PATH, { items: [], total: 0 });
  pickFileMock.mockReset();
  pickFileMock.mockResolvedValue(null);
});

afterEach(() => {
  api.restore();
  queryClient.clear();
  toast.clear();
  wideSpy?.mockRestore();
  delete (globalThis as { document?: unknown }).document;
  jest.restoreAllMocks();
});

test('the target account offers only unarchived accounts and names its currency', async () => {
  renderUpload();

  fireEvent.press(await screen.findByTestId('upload-source-picker-trigger'));
  expect(await screen.findByTestId(`upload-source-picker-option-${SOURCE_ID}`)).toBeTruthy();
  expect(screen.queryByTestId('upload-source-picker-option-src-archived')).toBeNull();

  fireEvent.press(screen.getByTestId(`upload-source-picker-option-${SOURCE_ID}`));
  expect(await screen.findByTestId('upload-source-hint')).toBeTruthy();
  expect(screen.getByTestId('upload-source-hint').props.children).toContain('CNY');
});

test('a successful upload goes straight to review without a second request', async () => {
  const result = makeImportUploadResult();
  mockPost(IMPORTS_PATH, result, 201);
  const router = renderUpload();

  await chooseSource();
  await chooseFile(csvFile());
  expect(await screen.findByTestId('upload-selected-file')).toBeTruthy();

  fireEvent.press(screen.getByTestId('upload-submit'));
  await waitFor(() =>
    expect(router.getPathname()).toBe(`/l/${LEDGER_ID}/imports/${result.batch.id}`),
  );

  // Batch and rows were seeded from the 201 (decision §5) …
  expect(queryClient.getQueryData(qk.ledger(LEDGER_ID).importB(result.batch.id))).toEqual(
    result.batch,
  );
  expect(
    queryClient.getQueryData([...qk.ledger(LEDGER_ID).importRows(result.batch.id), {}]),
  ).toEqual({ items: result.rows, total: result.rows.length });
  // … so nothing about THIS batch was fetched back: the only import GET the page makes is
  // the short 「最近导入」 list of the upload card, which never touches the new batch.
  const imported = api.mock.history.get
    .map((r) => r.url ?? '')
    .filter((url) => url.includes('/imports'))
    .filter((url) => !url.endsWith('/imports'));
  expect(imported).toEqual([]);
  expect(api.mock.history.post).toHaveLength(1);
});

test('pasted CSV posts a JSON body and lands on the same review screen', async () => {
  const result = makeImportUploadResult();
  mockPost(IMPORTS_PATH, result, 201);
  const router = renderUpload();

  await chooseSource();
  fireEvent.changeText(
    await screen.findByTestId('upload-paste-input'),
    '# version: 2026-09-10\ndate,amount\n2026-08-03,-1\n',
  );
  fireEvent.press(screen.getByTestId('upload-submit'));

  await waitFor(() =>
    expect(router.getPathname()).toBe(`/l/${LEDGER_ID}/imports/${result.batch.id}`),
  );
  const sent = api.mock.history.post[0];
  expect(JSON.parse(String(sent.data))).toEqual({
    source_id: SOURCE_ID,
    text: '# version: 2026-09-10\ndate,amount\n2026-08-03,-1\n',
  });
});

test('a structural failure lists file line numbers, copies the same list, and makes no batch', async () => {
  const writeText = jest.fn().mockResolvedValue(undefined);
  Object.defineProperty(globalThis.navigator, 'clipboard', {
    value: { writeText },
    configurable: true,
  });
  mockPost(
    IMPORTS_PATH,
    {
      detail: 'bad file',
      code: 'import_format_invalid',
      // A file with no `# version:` line lands here too (decision §14.53d).
      errors: [
        { line: 1, message: '缺少 # version: 首行' },
        { line: 14, message: '这一行有 10 个字段，应该是 11 个' },
      ],
    },
    400,
  );
  const router = renderUpload();

  await chooseSource();
  await chooseFile(csvFile());
  fireEvent.press(screen.getByTestId('upload-submit'));

  expect(await screen.findByTestId('upload-error-lines')).toBeTruthy();
  // 屏幕稿 10's refused branch also turns the drop zone red and swaps its grey how-to line
  // for the server's headline, so the zone and the card below never disagree.
  expect(screen.getByTestId('upload-server-error-hint')).toBeTruthy();
  expect(screen.queryByTestId('upload-dropzone-hint')).toBeNull();
  expect(screen.getByTestId('upload-error-line-0').props.children).toBe(
    '文件第 1 行：缺少 # version: 首行',
  );
  expect(screen.getByTestId('upload-error-line-1').props.children).toBe(
    '文件第 14 行：这一行有 10 个字段，应该是 11 个',
  );
  // A missing version line is a structural error, never the outdated-skill card.
  expect(screen.queryByTestId('upload-error-versions')).toBeNull();

  fireEvent.press(screen.getByTestId('upload-error-copy'));
  await waitFor(() =>
    expect(writeText).toHaveBeenCalledWith(
      '文件第 1 行：缺少 # version: 首行\n文件第 14 行：这一行有 10 个字段，应该是 11 个',
    ),
  );

  // No batch: the page stayed put and nothing was written into the cache.
  expect(router.getPathname()).toBe(`/l/${LEDGER_ID}/imports/new`);
  expect(queryClient.getQueryData(qk.ledger(LEDGER_ID).importB(BATCH_ID))).toBeUndefined();
  expect(queryClient.getQueryState(qk.ledger(LEDGER_ID).imports())).toBeUndefined();
  // The card renders the failure itself, so the global error toast stayed silent.
  expect(handlers.notify).not.toHaveBeenCalled();
});

test('only the first 20 line errors are listed until the rest are expanded', async () => {
  const errors = Array.from({ length: 23 }, (_, i) => ({
    line: i + 3,
    message: `第 ${i + 1} 个问题`,
  }));
  mockPost(IMPORTS_PATH, { detail: 'bad', code: 'import_format_invalid', errors }, 400);
  renderUpload();

  await chooseSource();
  await chooseFile(csvFile());
  fireEvent.press(screen.getByTestId('upload-submit'));

  expect(await screen.findByTestId('upload-error-line-19')).toBeTruthy();
  expect(screen.queryByTestId('upload-error-line-20')).toBeNull();
  fireEvent.press(screen.getByTestId('upload-error-more'));
  expect(await screen.findByTestId('upload-error-line-22')).toBeTruthy();
});

test('an outdated skill shows both versions and navigates to the guide_url from the response', async () => {
  mockPost(
    IMPORTS_PATH,
    {
      detail: 'stale',
      code: 'skill_outdated',
      current_version: '2026-09-10',
      file_version: '2026-08-20',
      guide_url: `/l/${LEDGER_ID}/imports/guide?from=upload`,
    },
    400,
  );
  const router = renderUpload();

  await chooseSource();
  await chooseFile(csvFile());
  fireEvent.press(screen.getByTestId('upload-submit'));

  const versions = await screen.findByTestId('upload-error-versions');
  expect(screen.getByTestId('upload-server-error-hint')).toBeTruthy();
  expect(screen.queryByTestId('upload-dropzone-hint')).toBeNull();
  expect(versions.props.children).toContain('2026-08-20');
  expect(versions.props.children).toContain('2026-09-10');
  // Hard refusal: there is no "ignore and continue" (decision §14.30).
  expect(screen.queryByText('忽略并继续')).toBeNull();

  fireEvent.press(screen.getByTestId('upload-error-guide'));
  await waitFor(() => expect(router.getPathname()).toBe(`/l/${LEDGER_ID}/imports/guide`));
  // The target came out of the response, not out of the component.
  expect(router.getSearchParams().from).toBe('upload');
});

test('a non-CSV file is refused before any request, pointing back at the guide', async () => {
  renderUpload();

  await chooseSource();
  await chooseFile(csvFile('statement.pdf'));

  expect(await screen.findByTestId('upload-local-error')).toBeTruthy();
  expect(screen.getByTestId('upload-local-error').props.children).toContain('CSV');
  expect(screen.queryByTestId('upload-selected-file')).toBeNull();
  expect(api.mock.history.post).toEqual([]);
});

test('a file over 2 MB is refused before any request', async () => {
  renderUpload();

  await chooseSource();
  await chooseFile(csvFile('huge.csv', 3 * 1024 * 1024));

  expect(await screen.findByTestId('upload-local-error')).toBeTruthy();
  expect(api.mock.history.post).toEqual([]);
});

test('typing into the paste box clears a refused file\u2019s rejection', async () => {
  renderUpload();

  await chooseSource();
  await chooseFile(csvFile('statement.pdf'));
  expect(await screen.findByTestId('upload-local-error')).toBeTruthy();

  fireEvent.changeText(screen.getByTestId('upload-paste-input'), 'date,amount\n2026-08-03,-1\n');

  await waitFor(() => expect(screen.queryByTestId('upload-local-error')).toBeNull());
  expect(screen.getByTestId('upload-dropzone-hint')).toBeTruthy();
});

test('a file and pasted text together say the file is what gets sent, and send it', async () => {
  const result = makeImportUploadResult();
  mockPost(IMPORTS_PATH, result, 201);
  renderUpload();

  await chooseSource();
  await chooseFile(csvFile());
  fireEvent.changeText(screen.getByTestId('upload-paste-input'), 'date,amount\n2026-08-03,-1\n');

  expect(await screen.findByTestId('upload-file-wins-hint')).toBeTruthy();
  expect(String(screen.getByTestId('upload-file-wins-hint').props.children)).toContain(
    'statement.csv',
  );

  fireEvent.press(screen.getByTestId('upload-submit'));

  // The multipart body carries the file; nothing was posted as JSON text.
  await waitFor(() => expect(api.mock.history.post).toHaveLength(1));
  expect(typeof api.mock.history.post[0].data).not.toBe('string');
});

test.each([
  ['file_too_large', 413, '2 MB'],
  ['import_rate_limited', 429, '10 批'],
])('%s gets its own copy on the card', async (code, status, needle) => {
  mockPost(IMPORTS_PATH, { detail: code, code }, status);
  renderUpload();

  await chooseSource();
  await chooseFile(csvFile());
  fireEvent.press(screen.getByTestId('upload-submit'));

  const message = await screen.findByTestId('upload-error-message');
  expect(String(message.props.children)).toContain(needle);
});

test('rows_exceed_limit names the row count the server reported', async () => {
  mockPost(
    IMPORTS_PATH,
    { detail: '文件有 2431 行，超过单批 2000 行上限，请拆成多份', code: 'rows_exceed_limit' },
    400,
  );
  renderUpload();

  await chooseSource();
  await chooseFile(csvFile());
  fireEvent.press(screen.getByTestId('upload-submit'));

  const message = await screen.findByTestId('upload-error-message');
  expect(String(message.props.children)).toContain('2431');
});

test('"choose a different file" clears the failure and the chosen file', async () => {
  mockPost(IMPORTS_PATH, { detail: 'bad', code: 'import_format_invalid', errors: [] }, 400);
  renderUpload();

  await chooseSource();
  await chooseFile(csvFile());
  fireEvent.press(screen.getByTestId('upload-submit'));

  expect(await screen.findByTestId('upload-error')).toBeTruthy();
  fireEvent.press(screen.getByTestId('upload-error-reselect'));
  await waitFor(() => expect(screen.queryByTestId('upload-error')).toBeNull());
  expect(screen.queryByTestId('upload-selected-file')).toBeNull();
});

test('the batch fixture id is what review is opened with', async () => {
  const result = makeImportUploadResult({ batch: makeImportBatch({ id: BATCH_ID }) });
  mockPost(IMPORTS_PATH, result, 201);
  const router = renderUpload();

  await chooseSource();
  await chooseFile(csvFile());
  fireEvent.press(screen.getByTestId('upload-submit'));

  await waitFor(() => expect(router.getPathname()).toBe(`/l/${LEDGER_ID}/imports/${BATCH_ID}`));
});

test('the two tabs show skill_markdown and skill_text, and copy writes the shown one', async () => {
  const writeText = jest.fn().mockResolvedValue(undefined);
  Object.defineProperty(globalThis.navigator, 'clipboard', {
    value: { writeText },
    configurable: true,
  });
  mockGet(
    '/import-format',
    makeImportFormat({
      skill_markdown: '# SKILL for Claude',
      skill_text: 'Instructions for ChatGPT',
    }),
  );
  renderUpload();

  expect(await screen.findByTestId('guide-skill-text')).toBeTruthy();
  expect(screen.getByTestId('guide-skill-text').props.children).toBe('# SKILL for Claude');

  fireEvent.press(screen.getByTestId('guide-skill-copy'));
  await waitFor(() => expect(writeText).toHaveBeenCalledWith('# SKILL for Claude'));

  fireEvent.press(screen.getByTestId('guide-skill-tabs-chatgpt'));
  await waitFor(() =>
    expect(screen.getByTestId('guide-skill-text').props.children).toBe('Instructions for ChatGPT'),
  );
  fireEvent.press(screen.getByTestId('guide-skill-copy'));
  await waitFor(() => expect(writeText).toHaveBeenLastCalledWith('Instructions for ChatGPT'));
});

test('downloading SKILL.md writes exactly what the response carried', async () => {
  const blobs: Blob[] = [];
  const names: string[] = [];
  (globalThis as { document?: unknown }).document = {
    createElement: () => {
      const node: Record<string, unknown> & { click(): void } = {
        click: () => {
          names.push(String(node.download));
        },
      };
      return node;
    },
    body: { appendChild: () => {}, removeChild: () => {} },
  };
  jest.spyOn(URL, 'createObjectURL').mockImplementation((blob: Blob | MediaSource) => {
    blobs.push(blob as Blob);
    return 'blob:import-skill';
  });
  const format = makeImportFormat({ skill_markdown: '# SKILL\nbody' });
  mockGet('/import-format', format);
  renderUpload();

  fireEvent.press(await screen.findByTestId('guide-skill-download'));

  expect(names).toEqual(['SKILL.md']);
  await expect(blobs[0].text()).resolves.toBe(format.skill_markdown);
});

test('the three steps are on the page and step 3 links to the standard format', async () => {
  const router = renderUpload();

  expect(await screen.findByTestId('import-step-1')).toBeTruthy();
  expect(screen.getByTestId('import-step-2')).toBeTruthy();
  expect(screen.getByTestId('import-step-3')).toBeTruthy();

  fireEvent.press(screen.getByTestId('upload-format-link'));
  await waitFor(() => expect(router.getPathname()).toBe(`/l/${LEDGER_ID}/imports/guide`));
});

test('the recent imports list names the last batches and opens one', async () => {
  mockGet(IMPORTS_PATH, {
    items: [makeImportBatch({ id: BATCH_ID, filename: 'cmb-08.csv', row_count: 32 })],
    total: 1,
  });
  const router = renderUpload();

  expect(await screen.findByTestId(`upload-recent-${BATCH_ID}`)).toBeTruthy();
  expect(screen.getByText('cmb-08.csv')).toBeTruthy();

  fireEvent.press(screen.getByTestId(`upload-recent-${BATCH_ID}`));
  await waitFor(() => expect(router.getPathname()).toBe(`/l/${LEDGER_ID}/imports/${BATCH_ID}`));
});

// ------------------------------------------------------------ the way back (§14.64)

test('wide: the header carries 「导入 · 上传账单」, and cold its back goes to the history', async () => {
  const router = renderUpload();

  expect(await screen.findByTestId('import-new-header-back')).toBeTruthy();
  expect(screen.getByText('导入 · 上传账单')).toBeTruthy();
  fireEvent.press(screen.getByTestId('import-new-header-back'));
  await waitFor(() => expect(router.getPathname()).toBe(`/l/${LEDGER_ID}/imports`));
});

test('narrow: the page leaves the ‹ to the shell’s top bar', async () => {
  setWide(false);
  renderUpload();

  expect(await screen.findByTestId('upload-source-picker-trigger')).toBeTruthy();
  expect(screen.queryByTestId('import-new-header-back')).toBeNull();
});
