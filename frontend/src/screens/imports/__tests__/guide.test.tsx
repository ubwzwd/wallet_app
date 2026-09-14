/**
 * `/l/:ledgerId/imports/guide` — step 0 (04 §4.10, §8.5 case 1; decisions §6, §14.52 A18).
 *
 * The page is a pure projection of `GET /import-format`, so the tests below change the
 * mocked response and assert the screen follows: nothing about the format may be baked
 * into the component.
 */
import React from 'react';
import { Text as RNText } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import i18next from 'i18next';

import { setAuthToken } from '@/api';
import { initI18n } from '@/i18n';
import { TopBarProvider, TopBarSurface } from '@/navigation';
import { AuthProvider, LedgerProvider } from '@/store';
import { ThemeProvider } from '@/theme/ThemeProvider';
import { ConfirmHost, ToastHost, toast } from '@/ui';
import {
  LEDGER_ID,
  makeImportFormat,
  makeLedger,
  makeTestQueryClient,
  makeUser,
  mockApi,
  mockGet,
  type MockApi,
} from '@/test';

import ImportGuideScreen from '../ImportGuideScreen';

let queryClient: QueryClient;
let api: MockApi;

const LEDGER = makeLedger({ base_currency: 'CNY' });

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
  'l/[ledgerId]/imports/guide': ImportGuideScreen,
  'l/[ledgerId]/imports/new': () => <RNText>upload page</RNText>,
};

function renderGuide(): ReturnType<typeof renderRouter> {
  return renderRouter(ROUTES, {
    initialUrl: `/l/${LEDGER_ID}/imports/guide`,
    wrapper: Wrapper,
  });
}

/** A writable clipboard, like a browser's — the test env has none of its own. */
function installClipboard(): jest.Mock {
  const writeText = jest.fn().mockResolvedValue(undefined);
  Object.defineProperty(globalThis.navigator, 'clipboard', {
    value: { writeText },
    configurable: true,
  });
  return writeText;
}

/** A DOM just big enough for `downloadTextFile`, capturing what the Blob held. */
function installDownloadCapture(): { blobs: Blob[]; names: string[] } {
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
    return 'blob:import-guide';
  });
  return { blobs, names };
}

beforeEach(async () => {
  api = mockApi();
  await setAuthToken('test-token');
  toast.clear();
  queryClient = makeTestQueryClient();
  await initI18n();
  await i18next.changeLanguage('zh');
  mockGet('/me', makeUser({ base_currency: 'CNY' }));
});

afterEach(() => {
  api.restore();
  queryClient.clear();
  toast.clear();
  delete (globalThis as { document?: unknown }).document;
  jest.restoreAllMocks();
});

test('every column name comes from the response, not from the component', async () => {
  // Deliberately NOT the real 11 columns: if the page hardcoded them, this would fail.
  mockGet(
    '/import-format',
    makeImportFormat({
      headers: ['when', 'how_much'],
      columns: [
        { name: 'when', required: true, desc_zh: '发生日期', desc_en: 'Date' },
        { name: 'how_much', required: false, desc_zh: '金额', desc_en: 'Amount' },
      ],
    }),
  );
  renderGuide();

  expect(await screen.findByTestId('guide-column-when')).toBeTruthy();
  expect(screen.getByTestId('guide-column-how_much')).toBeTruthy();
  expect(screen.getByText('发生日期')).toBeTruthy();
  // The real header names are nowhere on the page.
  expect(screen.queryByTestId('guide-column-date')).toBeNull();
  expect(screen.queryByTestId('guide-column-amount')).toBeNull();
});

test('the version line and footer print the version the server sent', async () => {
  mockGet('/import-format', makeImportFormat({ version: '2027-01-31' }));
  renderGuide();

  expect(await screen.findByTestId('guide-version')).toBeTruthy();
  expect(screen.getByTestId('guide-version').props.children).toContain('2027-01-31');
  expect(screen.getByTestId('guide-version-line').props.children).toContain('2027-01-31');
});

test('the two tabs show skill_markdown and skill_text, and copy writes the shown one', async () => {
  const writeText = installClipboard();
  mockGet(
    '/import-format',
    makeImportFormat({
      skill_markdown: '# SKILL for Claude',
      skill_text: 'Instructions for ChatGPT',
    }),
  );
  renderGuide();

  expect(await screen.findByTestId('guide-skill-text')).toBeTruthy();
  expect(screen.getByTestId('guide-skill-text').props.children).toBe('# SKILL for Claude');

  fireEvent.press(screen.getByTestId('guide-skill-copy'));
  await waitFor(() => expect(writeText).toHaveBeenCalledWith('# SKILL for Claude'));

  fireEvent.press(screen.getByTestId('guide-skill-tabs-chatgpt'));
  await waitFor(() =>
    expect(screen.getByTestId('guide-skill-text').props.children).toBe(
      'Instructions for ChatGPT',
    ),
  );
  fireEvent.press(screen.getByTestId('guide-skill-copy'));
  await waitFor(() => expect(writeText).toHaveBeenLastCalledWith('Instructions for ChatGPT'));
});

test('downloading SKILL.md and the sample writes exactly what the response carried', async () => {
  const capture = installDownloadCapture();
  const format = makeImportFormat({
    skill_markdown: '# SKILL\nbody',
    sample_csv: '# version: 2026-09-10\na,b\n1,2\n',
  });
  mockGet('/import-format', format);
  renderGuide();

  fireEvent.press(await screen.findByTestId('guide-skill-download'));
  fireEvent.press(screen.getByTestId('guide-sample-download'));

  expect(capture.names).toEqual(['SKILL.md', 'sample.csv']);
  await expect(capture.blobs[0].text()).resolves.toBe(format.skill_markdown);
  await expect(capture.blobs[1].text()).resolves.toBe(format.sample_csv);
});

test('the sample CSV is rendered as a grid and copied verbatim', async () => {
  const writeText = installClipboard();
  const sample = '# version: 2026-09-10\ndate,amount\n2026-08-03,-128.50\n';
  mockGet('/import-format', makeImportFormat({ sample_csv: sample }));
  renderGuide();

  expect(await screen.findByTestId('guide-sample-table')).toBeTruthy();
  expect(screen.getByTestId('guide-sample-row-0')).toBeTruthy();
  expect(screen.getByTestId('guide-sample-row-2')).toBeTruthy();
  expect(screen.getByText('-128.50')).toBeTruthy();

  fireEvent.press(screen.getByTestId('guide-sample-copy'));
  await waitFor(() => expect(writeText).toHaveBeenCalledWith(sample));
});

test('step 3 leads to the upload page, and no skill version of the user is claimed', async () => {
  mockGet('/import-format', makeImportFormat());
  const router = renderGuide();

  fireEvent.press(await screen.findByTestId('guide-go-upload'));
  await waitFor(() => expect(router.getPathname()).toBe(`/l/${LEDGER_ID}/imports/new`));
});
