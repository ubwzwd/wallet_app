/**
 * `useEnterLedger` (new / join): the ledger entered is reachable again even when this tab
 * had flagged it unavailable — removed from it mid-session, then re-invited. Without the
 * clear, `/home` (which ignores flagged ledgers) and `/ledgers` (which used to read the raw
 * list) redirected to each other forever.
 */
import React from 'react';
import { renderHook, act } from '@testing-library/react-native';

import { makeLedger } from '@/test/fixtures';
import { markLedgerUnavailable, resetLedgerUnavailable, useUnavailableLedgers } from '@/store';

const mockReplace = jest.fn();
const mockRefetch = jest.fn(() => Promise.resolve());
const mockSwitchTo = jest.fn();
let mockContext: { switchTo: typeof mockSwitchTo } | null = null;

jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  useRouter: () => ({ replace: mockReplace }),
}));
jest.mock('@/queries', () => ({
  ...jest.requireActual('@/queries'),
  useLedgers: () => ({ refetch: mockRefetch }),
}));
jest.mock('@/store', () => ({
  ...jest.requireActual('@/store'),
  useOptionalLedgerContext: () => mockContext,
}));

import { useEnterLedger } from '../useEnterLedger';

beforeEach(() => {
  jest.clearAllMocks();
  resetLedgerUnavailable();
  mockContext = null;
});

test('with no ledger context (the user had none), the flag is cleared before landing', async () => {
  const ledger = makeLedger({ id: 'ledger-x' });
  markLedgerUnavailable('ledger-x');
  const { result } = renderHook(() => ({ enter: useEnterLedger(), flagged: useUnavailableLedgers() }));
  expect(result.current.flagged.has('ledger-x')).toBe(true);

  await act(async () => {
    result.current.enter(ledger);
    await Promise.resolve();
  });

  expect(result.current.flagged.has('ledger-x')).toBe(false);
  expect(mockRefetch).toHaveBeenCalledTimes(1);
  expect(mockReplace).toHaveBeenCalledWith('/home');
  expect(mockSwitchTo).not.toHaveBeenCalled();
});

test('with a ledger context, the new ledger becomes current as well', async () => {
  mockContext = { switchTo: mockSwitchTo };
  const ledger = makeLedger({ id: 'ledger-y' });
  const { result } = renderHook(() => useEnterLedger());

  await act(async () => {
    result.current(ledger);
    await Promise.resolve();
  });

  expect(mockSwitchTo).toHaveBeenCalledWith('ledger-y');
  expect(mockReplace).toHaveBeenCalledWith('/home');
});
