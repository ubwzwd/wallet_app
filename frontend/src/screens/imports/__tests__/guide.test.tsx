/**
 * `/imports/guide` — 「标准格式说明」, the reference page step 3 of the import
 * page links to (04 §4.10, §8.5 case 1; decisions §6, §14.52 A18, §14.56).
 *
 * The page is a pure projection of `GET /import-format`, so the tests below change the
 * mocked response and assert the screen follows: nothing about the format may be baked
 * into the component. The skill text and its copy / download live on the import page now
 * and are covered in `upload.test.tsx`.
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
import * as breakpoint from '@/theme/useBreakpoint';
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
let wideSpy: jest.SpyInstance;

const LEDGER = makeLedger({ base_currency: 'CNY' });

function setWide(wide: boolean): void {
  wideSpy?.mockRestore();
  wideSpy = jest.spyOn(breakpoint, 'useIsWide').mockReturnValue(wide);
}

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
  'imports/guide': ImportGuideScreen,
  'imports/new': () => <RNText>upload page</RNText>,
};

function renderGuide(): ReturnType<typeof renderRouter> {
  return renderRouter(ROUTES, {
    initialUrl: '/imports/guide',
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
  setWide(true);
  mockGet('/me', makeUser({ base_currency: 'CNY' }));
});

afterEach(() => {
  api.restore();
  queryClient.clear();
  toast.clear();
  wideSpy?.mockRestore();
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

test('downloading the sample writes exactly what the response carried', async () => {
  const capture = installDownloadCapture();
  const format = makeImportFormat({ sample_csv: '# version: 2026-09-10\na,b\n1,2\n' });
  mockGet('/import-format', format);
  renderGuide();

  fireEvent.press(await screen.findByTestId('guide-sample-download'));

  expect(capture.names).toEqual(['sample.csv']);
  await expect(capture.blobs[0].text()).resolves.toBe(format.sample_csv);
});

test('the breadcrumb leads back to the import page, and no skill version of the user is claimed', async () => {
  mockGet('/import-format', makeImportFormat());
  const router = renderGuide();

  expect(await screen.findByTestId('guide-format')).toBeTruthy();
  // The app never claims to know which skill version the user installed (§14.52 A18).
  expect(screen.queryByTestId('upload-skill-meta')).toBeNull();

  fireEvent.press(screen.getByTestId('guide-header-back'));
  await waitFor(() => expect(router.getPathname()).toBe('/imports/new'));
});
