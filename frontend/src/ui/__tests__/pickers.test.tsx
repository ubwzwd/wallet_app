/**
 * Category / account / currency pickers (04 §4.6.1, §6.4): the two-line level-1 options,
 * "level 1 alone is a complete choice", the archived / unusable-account rule, and the
 * 「我的」 / 「成员共享的」 grouping of a ledger's accounts (decision §14.62).
 *
 * The jest runtime reports a 750pt-wide window, so every case here exercises the narrow
 * (sheet + drill-down) layout.
 */
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import type { CategoryTree, LedgerSource } from '@/api/types';
import { buildCategoryIndex } from '@/domain/categories';
import { namespaces, resources } from '@/i18n/resources';
import { ThemeProvider } from '@/theme/ThemeProvider';
import { CategoryPicker, orderByRecent } from '@/ui/CategoryPicker';
import { CurrencyPicker } from '@/ui/CurrencyPicker';
import { SourcePicker, groupSources, selectableSources } from '@/ui/SourcePicker';
import { makeCategoryTree, makeLedgerSource } from '@/test/fixtures';

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
  const active = makeLedgerSource({
    id: 'aaaa',
    name: '招行储蓄卡',
    type: 'checking',
    archived: false,
  });
  const archived = makeLedgerSource({
    id: 'bbbb',
    name: '旧现金包',
    type: 'cash',
    archived: true,
    archived_at: '2026-05-01T00:00:00.000000Z',
    usable: false,
  });
  const sources: LedgerSource[] = [active, archived];

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
        sources={[
          makeLedgerSource({
            id: 'aaaa',
            name: '招行储蓄卡',
            type: 'checking',
            balance: '12480.3500',
            default_currency: 'CNY',
            archived: false,
          }),
        ]}
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
    const credit = makeLedgerSource({
      id: 'cccc',
      name: '招行信用卡',
      type: 'credit',
      archived: false,
    });
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

  describe('a ledger with accounts shared in (decision §14.62)', () => {
    const mine = makeLedgerSource({
      id: 'mine-1',
      name: '我的储蓄卡',
      type: 'checking',
      balance: '500.0000',
      default_currency: 'CNY',
    });
    const shared = makeLedgerSource({
      id: 'theirs-1',
      name: '老婆的信用卡',
      type: 'credit',
      default_currency: 'SGD',
      owner_id: 'user-bob',
      mine: false,
    });
    // Still named by old entries, but no longer shared here: not offered.
    const unshared = makeLedgerSource({
      id: 'theirs-2',
      name: '取消共享的卡',
      type: 'checking',
      owner_id: 'user-bob',
      mine: false,
      usable: false,
    });

    test('only usable accounts are offered, and they split into mine and shared', () => {
      expect(selectableSources([shared, unshared, mine]).map((s) => s.id)).toEqual([
        'theirs-1',
        'mine-1',
      ]);
      // An entry that already sits on the unshared account keeps it (edit mode).
      expect(
        selectableSources([shared, unshared, mine], undefined, 'theirs-2').map((s) => s.id),
      ).toEqual(['theirs-1', 'theirs-2', 'mine-1']);
      expect(
        groupSources([shared, mine]).map((g) => [g.key, g.sources.map((s) => s.id)]),
      ).toEqual([
        ['mine', ['mine-1']],
        ['shared', ['theirs-1']],
      ]);
    });

    test('the list carries a 「我的」 and a 「成员共享的」 title, mine first', () => {
      renderThemed(
        <SourcePicker
          sources={[shared, unshared, mine]}
          value={null}
          onChange={() => undefined}
          lang="zh"
          testID="src"
        />,
      );
      fireEvent.press(screen.getByTestId('src-trigger'));

      const titleMine = screen.getByTestId('src-option-__group-mine');
      const titleShared = screen.getByTestId('src-option-__group-shared');
      expect(titleMine).toHaveTextContent('我的');
      expect(titleShared).toHaveTextContent('成员共享的');
      // A title is not a choice.
      expect(titleMine.props.accessibilityState?.disabled).toBe(true);

      const order = screen
        .getAllByTestId(/^src-option-/)
        .map((node) => String(node.props.testID).replace('src-option-', ''));
      expect(order).toEqual(['__group-mine', 'mine-1', '__group-shared', 'theirs-1']);
      expect(screen.queryByTestId('src-option-theirs-2')).toBeNull();
    });

    test('someone else’s account shows no balance, mine keeps its own', () => {
      renderThemed(
        <SourcePicker
          sources={[mine, shared]}
          value={null}
          onChange={() => undefined}
          lang="zh"
          testID="src"
        />,
      );
      fireEvent.press(screen.getByTestId('src-trigger'));

      expect(screen.getByTestId('src-option-mine-1')).toHaveTextContent(/500\.00/);
      const theirs = screen.getByTestId('src-option-theirs-1');
      expect(theirs).toHaveTextContent(/信用卡 · SGD/);
      // Not a made-up zero: no amount at all.
      expect(theirs).not.toHaveTextContent(/0\.00/);
    });

    test('a list of only my own accounts draws no titles', () => {
      renderThemed(
        <SourcePicker
          sources={[mine]}
          value={null}
          onChange={() => undefined}
          lang="zh"
          testID="src"
        />,
      );
      fireEvent.press(screen.getByTestId('src-trigger'));
      expect(screen.getByTestId('src-option-mine-1')).toBeTruthy();
      expect(screen.queryByTestId('src-option-__group-mine')).toBeNull();
    });

    test('a searchable list (more than 8 accounts) drops the titles, so no stray one is left', () => {
      const many = Array.from({ length: 8 }, (_, i) =>
        makeLedgerSource({ id: `mine-${i + 2}`, name: `我的卡 ${i + 2}` }),
      );
      renderThemed(
        <SourcePicker
          sources={[mine, ...many, shared]}
          value={null}
          onChange={() => undefined}
          lang="zh"
          testID="src"
        />,
      );
      fireEvent.press(screen.getByTestId('src-trigger'));
      expect(screen.getByTestId('src-search')).toBeTruthy();
      expect(screen.queryByTestId('src-option-__group-mine')).toBeNull();
      expect(screen.queryByTestId('src-option-__group-shared')).toBeNull();

      fireEvent.changeText(screen.getByTestId('src-search'), '我');
      expect(screen.queryByTestId('src-option-__group-mine')).toBeNull();
      expect(screen.getByTestId('src-option-mine-2')).toBeTruthy();
    });
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
