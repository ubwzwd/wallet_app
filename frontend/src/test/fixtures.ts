/**
 * Response fixtures shaped exactly like the examples in 03 §5.
 *
 * Every factory takes a `Partial<T>` of overrides. Money is a 4-decimal string and
 * timestamps carry microseconds plus the trailing `Z`, so tests exercise the same
 * shapes the real backend sends.
 */
import type {
  Category,
  CategoryTree,
  CurrencyList,
  FinanceSource,
  Ledger,
  Money,
  StatsSummary,
  StatsTrend,
  Transaction,
  TransferPair,
  User,
  Uuid,
} from '@/api/types';

export const LEDGER_ID: Uuid = '8f0f7b2e-1111-4222-8333-444455556666';
export const USER_ID: Uuid = '4ee1c8fa-2222-4333-8444-555566667777';
export const SOURCE_ID: Uuid = '5b6c7d8e-3333-4444-8555-666677778888';
export const TX_ID: Uuid = '9a8b7c6d-4444-4555-8666-777788889999';
export const CATEGORY_VERSION = '2026-09-10';

export function makeUser(over: Partial<User> = {}): User {
  return {
    id: USER_ID,
    email: 'alice@example.com',
    display_name: 'Alice',
    base_currency: 'CNY',
    language: 'zh',
    created_at: '2026-01-05T03:20:11.123456Z',
    ledger_count: 2,
    ...over,
  };
}

export function makeLedger(over: Partial<Ledger> = {}): Ledger {
  return {
    id: LEDGER_ID,
    name: '家庭账本',
    base_currency: 'CNY',
    created_by: USER_ID,
    created_at: '2026-02-01T09:00:00.000000Z',
    updated_at: '2026-09-01T12:00:00.000000Z',
    role: 'owner',
    member_count: 2,
    ...over,
  };
}

export function makeSource(over: Partial<FinanceSource> = {}): FinanceSource {
  return {
    id: SOURCE_ID,
    ledger_id: LEDGER_ID,
    name: '招商 信用卡',
    type: 'credit',
    default_currency: 'CNY',
    opening_balance: '-3204.0000',
    archived: false,
    archived_at: null,
    created_by: USER_ID,
    updated_by: null,
    created_at: '2026-02-01T09:05:00.000000Z',
    updated_at: '2026-09-01T12:00:00.000000Z',
    balance: '-4120.5500',
    balance_base: '-4120.5500',
    balance_rate: '1.00000000',
    balance_rate_date: '2026-09-11',
    ...over,
  };
}

export function makeTransaction(over: Partial<Transaction> = {}): Transaction {
  return {
    id: TX_ID,
    ledger_id: LEDGER_ID,
    source_id: SOURCE_ID,
    kind: 'expense',
    amount: '-128.5000',
    currency: 'CNY',
    occurred_at: '2026-08-03',
    note: 'FAMILYMART 3521',
    merchant: '全家便利店',
    category_l1: 'food',
    category_l2: 'snacks_drinks',
    transfer_role: null,
    transfer_subtype: null,
    transfer_pair_id: null,
    counterparty: null,
    refund_of: null,
    import_batch_id: null,
    created_by: USER_ID,
    updated_by: null,
    created_at: '2026-08-03T11:00:00.000000Z',
    updated_at: '2026-08-03T11:00:00.000000Z',
    amount_base: '-128.5000',
    rate_used: '1.00000000',
    rate_date: '2026-08-03',
    ...over,
  };
}

export function makeTransferPair(over: Partial<TransferPair> = {}): TransferPair {
  const pairId: Uuid = over.pair_id ?? 'c0ffee00-5555-4666-8777-888899990000';
  const out = makeTransaction({
    id: 'aaaa1111-6666-4777-8888-999900001111',
    kind: 'transfer',
    amount: '-1000.0000',
    category_l1: null,
    category_l2: null,
    merchant: null,
    transfer_role: 'out',
    transfer_subtype: 'plain',
    transfer_pair_id: pairId,
    amount_base: '-1000.0000',
  });
  const income = makeTransaction({
    id: 'bbbb2222-7777-4888-8999-000011112222',
    source_id: 'dddd4444-8888-4999-8aaa-111122223333',
    kind: 'transfer',
    amount: '1000.0000',
    category_l1: null,
    category_l2: null,
    merchant: null,
    transfer_role: 'in',
    transfer_subtype: 'plain',
    transfer_pair_id: pairId,
    amount_base: '1000.0000',
  });
  return {
    pair_id: pairId,
    occurred_at: '2026-08-03',
    subtype: 'plain',
    note: '还信用卡',
    out,
    in: income,
    updated_at: '2026-08-03T11:00:00.000000Z',
    ...over,
  };
}

// ------------------------------------------------------------------ categories

function l2(code: string, nameZh: string, nameEn: string): Category {
  return { code, name_zh: nameZh, name_en: nameEn, desc_zh: null, desc_en: null, children: [] };
}

function l1(code: string, nameZh: string, nameEn: string, children: Category[] = []): Category {
  return {
    code,
    name_zh: nameZh,
    name_en: nameEn,
    desc_zh: `${nameZh}的归类判据`,
    desc_en: `What belongs under ${nameEn}`,
    children,
  };
}

/** 16 top-level expense categories and 6 income ones, matching `core/categories.py`. */
export function makeCategoryTree(over: Partial<CategoryTree> = {}): CategoryTree {
  const expense: Category[] = [
    l1('clothing', '服饰', 'Clothing'),
    l1('food', '餐饮', 'Food & Dining', [
      l2('breakfast', '早餐', 'Breakfast'),
      l2('lunch', '午餐', 'Lunch'),
      l2('dinner', '晚餐', 'Dinner'),
      l2('late_snack', '夜宵', 'Late-night Snack'),
      l2('snacks_drinks', '零食饮料', 'Snacks & Drinks'),
    ]),
    l1('housing', '居住', 'Housing'),
    l1('transport', '交通', 'Transport', [
      l2('public_transit', '公交地铁', 'Public Transit'),
      l2('taxi', '打车', 'Taxi & Ride-hailing'),
      l2('fuel', '加油', 'Fuel'),
      l2('parking', '停车', 'Parking'),
      l2('train', '火车', 'Train'),
      l2('flight', '飞机', 'Flight'),
    ]),
    l1('health', '医疗健康', 'Health'),
    l1('entertainment', '娱乐', 'Entertainment'),
    l1('groceries', '生活购物', 'Groceries & Household', [
      l2('fresh_food', '买菜', 'Fresh Food'),
      l2('toiletries', '洗护清洁', 'Toiletries & Cleaning'),
      l2('kitchenware', '厨房用品', 'Kitchenware'),
      l2('household', '日用杂货', 'Household Supplies'),
    ]),
    l1('shopping', '消费购物', 'Shopping', [
      l2('electronics', '数码', 'Electronics'),
      l2('appliances', '家电', 'Appliances'),
      l2('furniture', '家具', 'Furniture'),
      l2('other_goods', '其他物件', 'Other Goods'),
    ]),
    l1('pet', '宠物', 'Pet'),
    l1('childcare', '育儿', 'Childcare'),
    l1('parents', '孝敬父母', 'Parents'),
    l1('bills', '账单缴费', 'Bills & Utilities'),
    l1('culture', '文化教育', 'Culture & Education'),
    l1('travel', '旅游', 'Travel'),
    l1('social', '人情往来', 'Social'),
    l1('other', '其他', 'Other'),
  ];
  const income: Category[] = [
    l1('salary', '工资', 'Salary', [
      l2('base_salary', '基本工资', 'Base Salary'),
      l2('bonus', '奖金', 'Bonus'),
      l2('rsu', 'RSU', 'RSU'),
    ]),
    l1('side_income', '兼职', 'Side Income'),
    l1('investment', '投资收益', 'Investment'),
    l1('reimbursement', '报销', 'Reimbursement'),
    l1('social_income', '人情收入', 'Social Income'),
    l1('other_income', '其他收入', 'Other Income'),
  ];
  return { version: CATEGORY_VERSION, expense, income, ...over };
}

// ----------------------------------------------------------------------- stats

export function makeStatsSummary(over: Partial<StatsSummary> = {}): StatsSummary {
  return {
    month: '2026-09',
    base_currency: 'CNY',
    expense_total: '8421.6600',
    income_total: '23500.0000',
    net: '15078.3400',
    expense: [
      {
        code: 'food',
        name_zh: '餐饮',
        name_en: 'Food & Dining',
        amount: '2310.5000',
        share: 0.2743,
        count: 41,
        children: [
          { code: 'lunch', name_zh: '午餐', name_en: 'Lunch', amount: '980.0000', count: 22 },
          { code: 'dinner', name_zh: '晚餐', name_en: 'Dinner', amount: '1130.5000', count: 17 },
          { code: null, name_zh: '未细分', name_en: 'Unspecified', amount: '200.0000', count: 2 },
        ],
      },
    ],
    income: [],
    refund_total: '82.9800',
    rate_missing_count: 0,
    ...over,
  };
}

export function makeStatsTrend(over: Partial<StatsTrend> = {}): StatsTrend {
  const months: Array<{ month: string; expense: Money }> = [
    { month: '2026-04', expense: '9120.4000' },
    { month: '2026-05', expense: '8890.0000' },
    { month: '2026-06', expense: '10420.0000' },
    { month: '2026-07', expense: '12500.9000' },
    { month: '2026-08', expense: '9980.1000' },
    { month: '2026-09', expense: '8421.6600' },
  ];
  return { base_currency: 'CNY', months, rate_missing_count: 0, ...over };
}

export function makeCurrencyList(over: Partial<CurrencyList> = {}): CurrencyList {
  return {
    currencies: {
      USD: 'United States Dollar',
      EUR: 'Euro',
      GBP: 'British Pound',
      CNY: 'Chinese Renminbi Yuan',
      SGD: 'Singapore Dollar',
      JPY: 'Japanese Yen',
    },
    ...over,
  };
}
