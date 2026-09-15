/**
 * The committed panel of 屏幕稿 11 (04 §4.10): the white card a batch lands on once it is
 * on the books.
 *
 * `review.test.tsx` covers the panel straight after a commit, where the commit response's
 * five counters are in hand. These cases are the *other* way in — a link, a refresh, a
 * screenshot run — where the screen has only the batch, which carries no commit counters
 * (03 §5.38). It must still be the card of the mockup rather than a bare sentence.
 */
import React from 'react';

import { screen } from '@testing-library/react-native';

import { formatMoney } from '@/i18n/format';
import {
  makeImportBatch,
  makeImportCommitResult,
  mockApi,
  renderWithProviders,
  type MockApi,
} from '@/test';

import { CommittedPanel } from '../CommittedPanel';

let api: MockApi;

const COMMITTED = makeImportBatch({
  status: 'committed',
  row_count: 128,
  net_amount: '-4210.5500',
  base_currency: 'CNY',
  row_status_summary: { pending: 121, edited: 5, skipped: 2 },
  committed_at: '2026-09-09T07:20:31.000000Z',
});

beforeEach(() => {
  api = mockApi();
});

afterEach(() => {
  api.restore();
});

async function renderPanel(result: ReturnType<typeof makeImportCommitResult> | null) {
  return renderWithProviders(
    <CommittedPanel
      batch={COMMITTED}
      result={result}
      onViewTransactions={() => {}}
      onImportAnother={() => {}}
      onUndo={() => {}}
    />,
    { auth: 'authenticated', lang: 'zh', wide: true },
  );
}

test('a batch opened fresh still gets stat tiles — the ones the batch itself answers for', async () => {
  await renderPanel(null);

  expect(screen.getByTestId('import-committed-stats')).toBeTruthy();
  // 128 rows, 2 of them marked 跳过 in review, so 126 became transactions.
  expect(screen.getByText('126 笔')).toBeTruthy();
  expect(screen.getByText('2 笔')).toBeTruthy();
  expect(
    screen.getByText(formatMoney('-4210.5500', 'CNY', 'zh', { signDisplay: 'always' })),
  ).toBeTruthy();
  // The pairing and refund counters are NOT invented: the batch cannot answer for them.
  expect(screen.queryByText('两腿转账')).toBeNull();
  expect(screen.queryByText('配到已有转账')).toBeNull();
  // The sentence stays the short one, because the long one needs the commit response.
  expect(screen.getByTestId('import-committed-summary')).toHaveTextContent(
    '这批导入已经提交，共 128 行',
  );
});

test('straight after a commit the five counters of the response win', async () => {
  await renderPanel(makeImportCommitResult());

  expect(screen.getByText('两腿转账')).toBeTruthy();
  expect(screen.getByText('配到已有转账')).toBeTruthy();
  expect(screen.getByTestId('import-committed-summary')).toHaveTextContent(/^已导入 121 条交易（其中/);
});

test('the three ways on are always there', async () => {
  await renderPanel(null);

  expect(screen.getByTestId('import-committed-view')).toBeTruthy();
  expect(screen.getByTestId('import-committed-again')).toBeTruthy();
  expect(screen.getByTestId('import-committed-undo')).toBeTruthy();
});
