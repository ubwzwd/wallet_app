/** 04 §2.3, decision §1.3: kind -> allowed tree, judging-criterion search over desc_*. */
import type { CategoryTree } from '@/api/types';
import { buildCategoryIndex, searchCategories } from '../categories';

const tree: CategoryTree = {
  version: '2026-09-10',
  expense: [
    {
      code: 'food',
      name_zh: '餐饮',
      name_en: 'Food & Dining',
      desc_zh: '日常吃喝：堂食、外卖、咖啡奶茶、零食。旅途中的吃喝归旅游',
      desc_en: 'Everyday eating and drinking',
      children: [
        { code: 'lunch', name_zh: '午餐', name_en: 'Lunch', desc_zh: null, desc_en: null, children: [] },
        { code: 'dinner', name_zh: '晚餐', name_en: 'Dinner', desc_zh: null, desc_en: null, children: [] },
      ],
    },
    {
      code: 'groceries',
      name_zh: '生活购物',
      name_en: 'Groceries & Household',
      desc_zh: '消耗品和家里的日常运转：买菜、洗护清洁、厨房用品、纸巾垃圾袋等日用杂货。判据：用完就没了',
      desc_en: 'Consumables that keep the household running. Test: it gets used up',
      children: [
        {
          code: 'household',
          name_zh: '日用杂货',
          name_en: 'Household',
          desc_zh: null,
          desc_en: null,
          children: [],
        },
      ],
    },
  ],
  income: [
    {
      code: 'salary',
      name_zh: '工资',
      name_en: 'Salary',
      desc_zh: '雇主发的钱：基本工资、奖金、RSU',
      desc_en: 'From your employer',
      children: [
        { code: 'bonus', name_zh: '奖金', name_en: 'Bonus', desc_zh: null, desc_en: null, children: [] },
      ],
    },
  ],
};

describe('buildCategoryIndex', () => {
  const index = buildCategoryIndex(tree);

  test('byL1 / byCode / l2Of / parentOf', () => {
    expect(index.byL1.food.name_zh).toBe('餐饮');
    expect(index.byCode.lunch.name_zh).toBe('午餐');
    expect(index.l2Of('food').map((c) => c.code)).toEqual(['lunch', 'dinner']);
    expect(index.l2Of('nonexistent')).toEqual([]);
    expect(index.parentOf('lunch')).toBe('food');
    expect(index.parentOf('nonexistent')).toBeNull();
  });

  test("kindAllows('transfer') is empty; expense/refund use the expense tree, income the income tree", () => {
    expect(index.kindAllows('transfer')).toEqual([]);
    expect(index.kindAllows('expense')).toBe(tree.expense);
    expect(index.kindAllows('refund')).toBe(tree.expense);
    expect(index.kindAllows('income')).toBe(tree.income);
  });

  test('isValidPair', () => {
    expect(index.isValidPair('food', 'lunch', 'expense')).toBe(true);
    expect(index.isValidPair('food', null, 'expense')).toBe(true); // l2 optional
    expect(index.isValidPair('food', 'bonus', 'expense')).toBe(false); // wrong parent
    expect(index.isValidPair(null, null, 'expense')).toBe(false); // l1 required
    expect(index.isValidPair(null, null, 'transfer')).toBe(true); // transfer needs both null
    expect(index.isValidPair('food', null, 'transfer')).toBe(false);
    expect(index.isValidPair('salary', 'bonus', 'income')).toBe(true);
    expect(index.isValidPair('salary', null, 'expense')).toBe(false); // salary isn't an expense category
  });
});

describe('searchCategories', () => {
  const index = buildCategoryIndex(tree);

  test('matches the judging-criterion text ("用完就没了"), not just the name', () => {
    const hits = searchCategories(index, 'expense', '用完就没了', 'zh');
    expect(hits).toEqual([{ l1: 'groceries' }]);
  });

  test('matches level-2 category names', () => {
    const hits = searchCategories(index, 'expense', '午餐', 'zh');
    expect(hits).toEqual([{ l1: 'food', l2: 'lunch' }]);
  });

  test('refund uses the expense tree', () => {
    const hits = searchCategories(index, 'refund', '用完就没了', 'zh');
    expect(hits).toEqual([{ l1: 'groceries' }]);
  });

  test('is case-insensitive and searches English names too', () => {
    const hits = searchCategories(index, 'expense', 'lunch', 'en');
    expect(hits).toEqual([{ l1: 'food', l2: 'lunch' }]);
  });

  test('empty query returns no hits', () => {
    expect(searchCategories(index, 'expense', '', 'zh')).toEqual([]);
  });

  test('transfer has nothing to search', () => {
    expect(searchCategories(index, 'transfer', '餐饮', 'zh')).toEqual([]);
  });
});
