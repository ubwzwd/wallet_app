/**
 * Decision §14.66 e: browsing state lives in memory, one bucket per ledger, outside the URL.
 */
import React from 'react';
import { Pressable, Text } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import type { Ledger } from '@/api/types';
import { makeLedger } from '@/test/fixtures';

import { LedgerProvider } from '../LedgerContext';
import { ViewStateProvider, useLedgerViewState, useSetLedgerViewState } from '../ViewState';

const A = makeLedger({ id: 'ledger-a', name: '家庭账本' });
const B = makeLedger({ id: 'ledger-b', name: '旅行账本' });
const LEDGERS: readonly Ledger[] = [A, B];

/** Shows `home.month` and moves it with two buttons: one by value, one by updater. */
function MonthProbe(): React.JSX.Element {
  const [month, setMonth] = useLedgerViewState<string | null>('home.month', null);
  return (
    <>
      <Text testID="month">{month ?? 'this-month'}</Text>
      <Pressable testID="set-aug" onPress={() => setMonth('2026-08')} />
      <Pressable
        testID="step-back"
        onPress={() => setMonth((prev) => (prev === '2026-08' ? '2026-07' : '2026-08'))}
      />
    </>
  );
}

/** A second reader of the same key, to show every subscriber sees a write. */
function MonthMirror(): React.JSX.Element {
  const [month] = useLedgerViewState<string | null>('home.month', null);
  return <Text testID="mirror">{month ?? 'this-month'}</Text>;
}

/** Writes a key without reading it — the "open the list with a filter" caller. */
function FilterWriter(): React.JSX.Element {
  const set = useSetLedgerViewState();
  return (
    <Pressable
      testID="write-filter"
      onPress={() => set('transactions.filters', { source_id: ['src-1'] })}
    />
  );
}

function FilterReader(): React.JSX.Element {
  const [filters] = useLedgerViewState<{ source_id?: string[] }>('transactions.filters', {});
  return <Text testID="filters">{filters.source_id?.join(',') ?? 'none'}</Text>;
}

function Tree({
  ledgerId,
  showProbe = true,
}: {
  ledgerId: string;
  showProbe?: boolean;
}): React.JSX.Element {
  return (
    <ViewStateProvider>
      <LedgerProvider ledgerId={ledgerId} ledgers={LEDGERS}>
        {showProbe ? <MonthProbe /> : null}
        <MonthMirror />
        <FilterWriter />
        <FilterReader />
      </LedgerProvider>
    </ViewStateProvider>
  );
}

test('starts at the default and every reader of the key sees a write', () => {
  render(<Tree ledgerId={A.id} />);
  expect(screen.getByTestId('month')).toHaveTextContent('this-month');

  fireEvent.press(screen.getByTestId('set-aug'));
  expect(screen.getByTestId('month')).toHaveTextContent('2026-08');
  expect(screen.getByTestId('mirror')).toHaveTextContent('2026-08');

  fireEvent.press(screen.getByTestId('step-back'));
  expect(screen.getByTestId('month')).toHaveTextContent('2026-07');
});

test('an updater starts from the default when nothing is stored yet', () => {
  render(<Tree ledgerId={A.id} />);
  fireEvent.press(screen.getByTestId('step-back'));
  expect(screen.getByTestId('month')).toHaveTextContent('2026-08');
});

test('each ledger keeps its own values, and switching back brings the first ones back', () => {
  const view = render(<Tree ledgerId={A.id} />);
  fireEvent.press(screen.getByTestId('set-aug'));
  fireEvent.press(screen.getByTestId('write-filter'));
  expect(screen.getByTestId('filters')).toHaveTextContent('src-1');

  // Another ledger: its own defaults, untouched by what was set in the first.
  view.rerender(<Tree ledgerId={B.id} />);
  expect(screen.getByTestId('month')).toHaveTextContent('this-month');
  expect(screen.getByTestId('filters')).toHaveTextContent('none');
  fireEvent.press(screen.getByTestId('step-back'));
  fireEvent.press(screen.getByTestId('step-back'));
  expect(screen.getByTestId('month')).toHaveTextContent('2026-07');

  view.rerender(<Tree ledgerId={A.id} />);
  expect(screen.getByTestId('month')).toHaveTextContent('2026-08');
  expect(screen.getByTestId('filters')).toHaveTextContent('src-1');

  view.rerender(<Tree ledgerId={B.id} />);
  expect(screen.getByTestId('month')).toHaveTextContent('2026-07');
});

test('a page that unmounts and comes back finds its value (the provider keeps it)', () => {
  const view = render(<Tree ledgerId={A.id} />);
  fireEvent.press(screen.getByTestId('set-aug'));

  view.rerender(<Tree ledgerId={A.id} showProbe={false} />);
  expect(screen.queryByTestId('month')).toBeNull();

  view.rerender(<Tree ledgerId={A.id} />);
  expect(screen.getByTestId('month')).toHaveTextContent('2026-08');
});

test('a new provider — a reload, another sign-in — starts over at the defaults', () => {
  const first = render(<Tree ledgerId={A.id} />);
  fireEvent.press(screen.getByTestId('set-aug'));
  first.unmount();

  render(<Tree ledgerId={A.id} />);
  expect(screen.getByTestId('month')).toHaveTextContent('this-month');
});

test('with no ledger at all the values live in their own bucket', () => {
  function NoLedger({ children }: { children: React.ReactNode }): React.JSX.Element {
    return <ViewStateProvider>{children}</ViewStateProvider>;
  }
  render(
    <NoLedger>
      <MonthProbe />
    </NoLedger>,
  );
  fireEvent.press(screen.getByTestId('set-aug'));
  expect(screen.getByTestId('month')).toHaveTextContent('2026-08');
});

test('outside a provider it is plain component state, and the writer does nothing', () => {
  render(
    <LedgerProvider ledgerId={A.id} ledgers={LEDGERS}>
      <MonthProbe />
      <FilterWriter />
      <FilterReader />
    </LedgerProvider>,
  );
  fireEvent.press(screen.getByTestId('set-aug'));
  expect(screen.getByTestId('month')).toHaveTextContent('2026-08');
  act(() => {
    fireEvent.press(screen.getByTestId('write-filter'));
  });
  expect(screen.getByTestId('filters')).toHaveTextContent('none');
});
