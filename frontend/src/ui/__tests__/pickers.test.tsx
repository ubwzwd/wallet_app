/**
 * Category / account / currency pickers (04 §4.6.1, §6.4): the two-line level-1 options,
 * searching by the classification criterion, "level 1 alone is a complete choice", and the
 * archived-account rule.
 *
 * The jest runtime reports a 750pt-wide window, so every case here exercises the narrow
 * (sheet + drill-down) layout.
 */
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import type { CategoryTree, FinanceSource } from '@/api/types';
import { buildCategoryIndex } from '@/domain/categories';
import { namespaces, resources } from '@/i18n/resources';
import { ThemeProvider } from '@/theme/ThemeProvider';
import { CategoryPicker, orderByRecent } from '@/ui/CategoryPicker';
import { CurrencyPicker } from '@/ui/CurrencyPicker';
import { SourcePicker, selectableSources } from '@/ui/SourcePicker';
import { makeCategoryTree, makeSource } from '@/test/fixtures';

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

function treeWithCriterion(): CategoryTree {
  const tree = makeCategoryTree();
  // The decision §14.21 example: 生活购物 is "用完就没了", 消费购物 "买一次用几年".
  const groceries = tree.expense.find((c) => c.code === 'groceries');
  if (groceries) groceries.desc_zh = '用完就没了';
  return tree;
}

describe('CategoryPicker', () => {
  test('level-1 options are two lines: name plus the classification criterion', () => {
    const index = buildCategoryIndex(treeWithCriterion());
    renderThemed(
      <CategoryPicker
        index={index}
        kind="expense"
        value={{ l1: null, l2: null }}
        onChange={() => undefined}
        lang="zh"
        testID="cat"
      />,
    );
    fireEvent.press(screen.getByTestId('cat-trigger'));
    expect(screen.getByTestId('cat-l1-food')).toHaveTextContent(/餐饮/);
    expect(screen.getByTestId('cat-desc-groceries')).toHaveTextContent(/用完就没了/);
  });

  test('picking a level 1 alone already reports a complete value', () => {
    const index = buildCategoryIndex(makeCategoryTree());
    const onChange = jest.fn();
    renderThemed(
      <CategoryPicker
        index={index}
        kind="expense"
        value={{ l1: null, l2: null }}
        onChange={onChange}
        lang="zh"
        testID="cat"
      />,
    );
    fireEvent.press(screen.getByTestId('cat-trigger'));
    fireEvent.press(screen.getByTestId('cat-l1-food'));
    expect(onChange).toHaveBeenCalledWith({ l1: 'food', l2: null });

    // …and the level-2 panel that slides in starts on "不细分".
    expect(screen.getByTestId('cat-l2-none')).toHaveTextContent(/不细分/);
    fireEvent.press(screen.getByTestId('cat-l2-lunch'));
    expect(onChange).toHaveBeenLastCalledWith({ l1: 'food', l2: 'lunch' });
  });

  test('the filter matches the criterion text, not just the names', () => {
    const index = buildCategoryIndex(treeWithCriterion());
    renderThemed(
      <CategoryPicker
        index={index}
        kind="expense"
        value={{ l1: null, l2: null }}
        onChange={() => undefined}
        lang="zh"
        testID="cat"
      />,
    );
    fireEvent.press(screen.getByTestId('cat-trigger'));
    fireEvent.changeText(screen.getByTestId('cat-search'), '用完就没了');
    expect(screen.getByTestId('cat-l1-groceries')).toBeTruthy();
    expect(screen.queryByTestId('cat-l1-food')).toBeNull();
  });

  test('changing kind moves the panel too, instead of stranding the other tree', () => {
    const index = buildCategoryIndex(makeCategoryTree());
    const view = renderThemed(
      <CategoryPicker
        index={index}
        kind="expense"
        value={{ l1: 'food', l2: null }}
        onChange={() => undefined}
        lang="zh"
        testID="cat"
      />,
    );
    fireEvent.press(screen.getByTestId('cat-trigger'));
    fireEvent.press(screen.getByTestId('cat-l1-food'));
    expect(screen.getByTestId('cat-l2-lunch')).toBeTruthy();

    view.rerender(
      <ThemeProvider initialPref="light">
        <CategoryPicker
          index={index}
          kind="income"
          value={{ l1: null, l2: null }}
          onChange={() => undefined}
          lang="zh"
          testID="cat"
        />
      </ThemeProvider>,
    );
    // Back on the level-1 column, and it is the income tree — 午餐 belongs to expense.
    expect(screen.queryByTestId('cat-l2-lunch')).toBeNull();
    expect(screen.getByTestId('cat-l1-salary')).toBeTruthy();
  });

  test('a transfer has no categories at all, so the control is disabled', () => {
    const index = buildCategoryIndex(makeCategoryTree());
    renderThemed(
      <CategoryPicker
        index={index}
        kind="transfer"
        value={{ l1: null, l2: null }}
        onChange={() => undefined}
        lang="zh"
        testID="cat"
      />,
    );
    const trigger = screen.getByTestId('cat-trigger');
    expect(trigger.props.accessibilityState).toMatchObject({ disabled: true });
    fireEvent.press(trigger);
    expect(screen.queryByTestId('cat-l1-food')).toBeNull();
  });

  test('recently used level-1 codes are pinned to the top, at most six', () => {
    const tree = makeCategoryTree();
    const ordered = orderByRecent(tree.expense, [
      'travel',
      'social',
      'pet',
      'bills',
      'culture',
      'health',
      'other', // the seventh is ignored
    ]);
    expect(ordered.slice(0, 6).map((c) => c.code)).toEqual([
      'travel',
      'social',
      'pet',
      'bills',
      'culture',
      'health',
    ]);
    expect(ordered).toHaveLength(tree.expense.length);
    expect(ordered[6].code).toBe('clothing');
  });
});

describe('SourcePicker', () => {
  const active = makeSource({ id: 'aaaa', name: '招行储蓄卡', type: 'checking', archived: false });
  const archived = makeSource({
    id: 'bbbb',
    name: '旧现金包',
    type: 'cash',
    archived: true,
    archived_at: '2026-05-01T00:00:00.000000Z',
  });
  const sources: FinanceSource[] = [active, archived];

  test('archived accounts are out by default and kept by allowArchivedId', () => {
    expect(selectableSources(sources).map((s) => s.id)).toEqual(['aaaa']);
    expect(selectableSources(sources, undefined, 'bbbb').map((s) => s.id)).toEqual([
      'aaaa',
      'bbbb',
    ]);

    const { unmount } = renderThemed(
      <SourcePicker
        sources={sources}
        value={null}
        onChange={() => undefined}
        lang="zh"
        testID="src"
      />,
    );
    fireEvent.press(screen.getByTestId('src-trigger'));
    expect(screen.getByTestId('src-option-aaaa')).toBeTruthy();
    expect(screen.queryByTestId('src-option-bbbb')).toBeNull();
    unmount();

    renderThemed(
      <SourcePicker
        sources={sources}
        value="bbbb"
        onChange={() => undefined}
        allowArchivedId="bbbb"
        lang="zh"
        testID="src"
      />,
    );
    fireEvent.press(screen.getByTestId('src-trigger'));
    expect(screen.getByTestId('src-option-bbbb')).toBeTruthy();
  });

  test('a row shows the account type, its currency and its balance', () => {
    renderThemed(
      <SourcePicker
        sources={[makeSource({ id: 'aaaa', name: '招行储蓄卡', type: 'checking', balance: '12480.3500', default_currency: 'CNY', archived: false })]}
        value={null}
        onChange={() => undefined}
        lang="zh"
        testID="src"
      />,
    );
    fireEvent.press(screen.getByTestId('src-trigger'));
    const option = screen.getByTestId('src-option-aaaa');
    expect(option).toHaveTextContent(/储蓄卡/);
    expect(option).toHaveTextContent(/CNY/);
    expect(option).toHaveTextContent(/12,480\.35/);
  });

  test('an extra filter narrows the list further (card repayment target)', () => {
    const credit = makeSource({ id: 'cccc', name: '招行信用卡', type: 'credit', archived: false });
    renderThemed(
      <SourcePicker
        sources={[active, credit]}
        value={null}
        onChange={() => undefined}
        filter={(s) => s.type === 'credit'}
        lang="zh"
        testID="src"
      />,
    );
    fireEvent.press(screen.getByTestId('src-trigger'));
    expect(screen.getByTestId('src-option-cccc')).toBeTruthy();
    expect(screen.queryByTestId('src-option-aaaa')).toBeNull();
  });
});

describe('CurrencyPicker', () => {
  test('the inline variant searches and reports the picked code', () => {
    const onChange = jest.fn();
    renderThemed(
      <CurrencyPicker
        codes={['CNY', 'USD', 'JPY']}
        names={{ USD: 'United States Dollar' }}
        value="CNY"
        onChange={onChange}
        variant="inline"
        testID="cur"
      />,
    );
    fireEvent.press(screen.getByTestId('cur-trigger'));
    fireEvent.changeText(screen.getByTestId('cur-search'), 'dollar');
    expect(screen.getByTestId('cur-option-USD')).toBeTruthy();
    expect(screen.queryByTestId('cur-option-JPY')).toBeNull();
    fireEvent.press(screen.getByTestId('cur-option-USD'));
    expect(onChange).toHaveBeenCalledWith('USD');
  });

  test('read-only mode shows the code alone', () => {
    renderThemed(<CurrencyPicker codes={['CNY']} value="CNY" onChange={() => undefined} readOnly testID="cur" />);
    expect(screen.getByTestId('cur')).toHaveTextContent(/CNY/);
    expect(screen.queryByTestId('cur-trigger')).toBeNull();
  });
});
