/**
 * Operations timeline, filter chips and the shortcut sheet (04 §4.5, §4.7; decision §14.51):
 * newest first, people resolved from the member list, changed fields rendered as
 * "字段名 旧 → 新" with category codes turned into names, and a fold above three fields.
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import type { TransactionEvent, Uuid } from '@/api/types';
import { buildCategoryIndex } from '@/domain/categories';
import { namespaces, resources } from '@/i18n/resources';
import { ThemeProvider } from '@/theme/ThemeProvider';
import { lightColors } from '@/theme/tokens';
import { EventTimeline } from '@/ui/EventTimeline';
import { FilterChips } from '@/ui/FilterChips';
import { KeyboardHint } from '@/ui/KeyboardHint';
import { makeCategoryTree } from '@/test/fixtures';

beforeAll(async () => {
  if (!i18next.isInitialized) {
    await i18next.use(initReactI18next).init({
      lng: 'zh',
      fallbackLng: 'zh',
      ns: [...namespaces],
      defaultNS: 'common',
      resources: resources as never,
      interpolation: { escapeValue: false },
    });
  }
});

function renderThemed(node: React.ReactElement) {
  return render(<ThemeProvider initialPref="light">{node}</ThemeProvider>);
}

const ME: Uuid = '11111111-1111-4111-8111-111111111111';
const WIFE: Uuid = '22222222-2222-4222-8222-222222222222';
const GHOST: Uuid = '33333333-3333-4333-8333-333333333333';

function makeEvent(over: Partial<TransactionEvent> & { id: string }): TransactionEvent {
  return {
    transaction_id: 'tx',
    actor_id: ME,
    at: '2026-08-14T09:12:00.000000Z',
    event: 'created',
    changes: null,
    import_batch_id: null,
    client: 'web',
    ...over,
  };
}

describe('EventTimeline', () => {
  test('rows come out newest first whatever order they arrive in', () => {
    renderThemed(
      <EventTimeline
        events={[
          makeEvent({ id: 'created', at: '2026-08-14T09:12:00.000000Z', event: 'created' }),
          makeEvent({ id: 'updated', at: '2026-08-20T14:02:00.000000Z', event: 'updated' }),
          makeEvent({ id: 'paired', at: '2026-08-16T10:00:00.000000Z', event: 'paired' }),
        ]}
        names={{ [ME]: 'Alice' }}
        meId={ME}
        lang="zh"
        testID="ev"
      />,
    );
    const order = screen
      .getAllByTestId(/^ev-row-/)
      .map((row) => String(row.props.testID).replace('ev-row-', ''));
    expect(order).toEqual(['updated', 'paired', 'created']);
  });

  test('each entry is a dot, 「动作 · 人」 and the time below — the newest dot solid', () => {
    renderThemed(
      <EventTimeline
        events={[
          makeEvent({ id: 'new', at: '2026-08-20T14:02:00.000000Z', event: 'updated' }),
          makeEvent({ id: 'old', at: '2026-08-14T09:12:00.000000Z', event: 'created' }),
        ]}
        names={{}}
        meId={ME}
        lang="zh"
        testID="ev"
      />,
    );
    // Mockups 07 / 08 write the action and the person on one line, the time underneath.
    expect(screen.getByTestId('ev-action-new')).toHaveTextContent('改动 · 我');
    expect(screen.getByTestId('ev-at-new')).toHaveTextContent('2026-08-20 22:02');
    const dotStyle = (id: string): Record<string, unknown> =>
      StyleSheet.flatten(screen.getByTestId(id).props.style as never) as never;
    expect(dotStyle('ev-dot-new').backgroundColor).toBe(lightColors['accent.solid']);
    expect(dotStyle('ev-dot-old').backgroundColor).toBe(lightColors['border.strong']);
  });

  test('I am "我"; a known member gets their name; an unknown actor falls back', () => {
    renderThemed(
      <EventTimeline
        events={[
          makeEvent({ id: 'a', actor_id: ME, at: '2026-08-20T14:02:00.000000Z' }),
          makeEvent({ id: 'b', actor_id: WIFE, at: '2026-08-19T14:02:00.000000Z' }),
          makeEvent({ id: 'c', actor_id: GHOST, at: '2026-08-18T14:02:00.000000Z' }),
        ]}
        names={{ [WIFE]: '老婆' }}
        meId={ME}
        lang="zh"
        testID="ev"
      />,
    );
    expect(screen.getByTestId('ev-row-a')).toHaveTextContent(/我/);
    expect(screen.getByTestId('ev-row-b')).toHaveTextContent(/老婆/);
    expect(screen.getByTestId('ev-row-c')).toHaveTextContent(/33333333/);
  });

  test('changed fields read "字段名 旧 → 新", with category codes turned into names', () => {
    const index = buildCategoryIndex(makeCategoryTree());
    renderThemed(
      <EventTimeline
        events={[
          makeEvent({
            id: 'a',
            event: 'updated',
            changes: {
              amount: { before: '-38.0000', after: '-42.0000' },
              category_l1: { before: 'food', after: 'transport' },
              category_l2: { before: 'lunch', after: null },
            },
          }),
        ]}
        names={{}}
        meId={ME}
        lang="zh"
        index={index}
        currency="CNY"
        testID="ev"
      />,
    );
    const row = screen.getByTestId('ev-row-a');
    expect(screen.getByTestId('ev-action-a')).toHaveTextContent(/^改动 · /);
    expect(row).toHaveTextContent(/金额 −¥38\.00 → −¥42\.00/);
    expect(row).toHaveTextContent(/一级分类 餐饮 → 交通/);
    // A cleared field reads as "无", not as the raw null.
    expect(row).toHaveTextContent(/二级分类 午餐 → 无/);
  });

  test('fields outside the event_field block still read as words, never as i18n keys', () => {
    renderThemed(
      <EventTimeline
        events={[
          makeEvent({
            id: 'a',
            event: 'updated',
            changes: {
              kind: { before: 'expense', after: 'refund' },
              currency: { before: 'CNY', after: 'USD' },
              counterparty: { before: null, after: '老王' },
            },
          }),
        ]}
        names={{}}
        meId={ME}
        lang="zh"
        currency="CNY"
        testID="ev"
      />,
    );
    const row = screen.getByTestId('ev-row-a');
    // The kind values are named too, not left as `expense` / `refund`.
    expect(row).toHaveTextContent(/类型 支出 → 退款/);
    expect(row).toHaveTextContent(/币种 CNY → USD/);
    expect(row).toHaveTextContent(/对方 无 → 老王/);
    expect(row).not.toHaveTextContent(/transaction:/);
  });

  test('a field the language pack has never heard of degrades to its own name', () => {
    renderThemed(
      <EventTimeline
        events={[
          makeEvent({
            id: 'a',
            event: 'updated',
            changes: { something_new: { before: 'a', after: 'b' } },
          }),
        ]}
        names={{}}
        meId={ME}
        lang="zh"
        testID="ev"
      />,
    );
    expect(screen.getByTestId('ev-row-a')).toHaveTextContent(/something_new a → b/);
    expect(screen.getByTestId('ev-row-a')).not.toHaveTextContent(/detail\.event_field/);
  });

  test('more than three changed fields fold up until asked', () => {
    renderThemed(
      <EventTimeline
        events={[
          makeEvent({
            id: 'a',
            event: 'updated',
            changes: {
              amount: { before: '-38.0000', after: '-42.0000' },
              note: { before: '和同事', after: '和同事 AA' },
              merchant: { before: '星巴克', after: '瑞幸' },
              occurred_at: { before: '2026-08-14', after: '2026-08-15' },
              source_id: { before: 'aaaa', after: 'bbbb' },
            },
          }),
        ]}
        names={{}}
        meId={ME}
        lang="zh"
        currency="CNY"
        sourceNames={{ aaaa: '招行储蓄卡', bbbb: '招行信用卡' }}
        testID="ev"
      />,
    );
    expect(screen.queryByText(/招行储蓄卡 → 招行信用卡/)).toBeNull();
    fireEvent.press(screen.getByTestId('ev-expand-a'));
    expect(screen.getByText(/账户 招行储蓄卡 → 招行信用卡/)).toBeTruthy();
    expect(screen.queryByTestId('ev-expand-a')).toBeNull();
  });

  test('an imported event links to its batch and never shows the client', () => {
    const onPressBatch = jest.fn();
    const batch: Uuid = '44444444-4444-4444-8444-444444444444';
    renderThemed(
      <EventTimeline
        events={[makeEvent({ id: 'a', event: 'imported', import_batch_id: batch })]}
        names={{}}
        meId={ME}
        lang="zh"
        onPressBatch={onPressBatch}
        testID="ev"
      />,
    );
    expect(screen.queryByText(/web/)).toBeNull();
    fireEvent.press(screen.getByTestId('ev-batch-a'));
    expect(onPressBatch).toHaveBeenCalledWith(batch);
  });
});

describe('FilterChips', () => {
  test('each chip removes its own (key, value) and the clear chip drops them all', () => {
    const onRemove = jest.fn();
    const onClear = jest.fn();
    renderThemed(
      <FilterChips
        chips={[
          { key: 'kind', value: 'expense', label: '支出' },
          { key: 'from', value: '2026-08-01', label: '8 月' },
        ]}
        onRemove={onRemove}
        onClear={onClear}
        testID="fc"
      />,
    );
    fireEvent.press(screen.getByTestId('fc-kind-expense-remove'));
    expect(onRemove).toHaveBeenCalledWith('kind', 'expense');

    fireEvent.press(screen.getByTestId('fc-clear'));
    expect(onClear).toHaveBeenCalled();
  });

  test('nothing renders when no filter is active', () => {
    renderThemed(
      <FilterChips chips={[]} onRemove={() => undefined} onClear={() => undefined} testID="fc" />,
    );
    expect(screen.queryByTestId('fc')).toBeNull();
  });
});

describe('KeyboardHint', () => {
  test('it lists the chords it was given and closes on demand', () => {
    const onClose = jest.fn();
    renderThemed(
      <KeyboardHint
        open
        onClose={onClose}
        shortcuts={[
          { keys: ['⌘', 'S'], label: '保存' },
          { keys: ['Esc'], label: '放弃' },
        ]}
        testID="kh"
      />,
    );
    expect(screen.getAllByTestId('kh-row')).toHaveLength(2);
    expect(screen.getByText('保存')).toBeTruthy();
    expect(screen.getByText('⌘')).toBeTruthy();

    fireEvent.press(screen.getByTestId('kh-close'));
    expect(onClose).toHaveBeenCalled();
  });

  test('a closed sheet renders nothing', () => {
    renderThemed(
      <KeyboardHint open={false} onClose={() => undefined} shortcuts={[]} testID="kh" />,
    );
    expect(screen.queryByText('快捷键')).toBeNull();
  });
});
