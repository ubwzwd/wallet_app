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
  ImportBatch,
  ImportCommitResult,
  ImportDeleteResult,
  ImportFormat,
  ImportRow,
  ImportUploadResult,
  Ledger,
  Money,
  StatsSummary,
  StatsTrend,
  Transaction,
  TransferPair,
  User,
  Uuid,
} from '@/api/types';

export * from './ids';
export * from './fixtures-sources';
import {
  BATCH_ID,
  CATEGORY_VERSION,
  IMPORT_ROW_ID,
  LEDGER_ID,
  SOURCE_ID,
  TX_ID,
  USER_ID,
} from './ids';

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

// ---------------------------------------------------------------- imports (03 §5.37–§5.44)

/** The 11 fixed columns, in file order (05 §1). */
export const IMPORT_HEADERS: string[] = [
  'date', 'amount', 'currency', 'kind', 'transfer_role', 'transfer_subtype',
  'merchant', 'note', 'category_l1', 'category_l2', 'source_ref',
];

const SAMPLE_CSV =
  `# version: ${CATEGORY_VERSION}\n${IMPORT_HEADERS.join(',')}\n` +
  '2026-08-03,-128.50,CNY,expense,,,全家便利店,,food,snacks_drinks,\n';

export function makeImportBatch(over: Partial<ImportBatch> = {}): ImportBatch {
  return {
    id: BATCH_ID,
    ledger_id: LEDGER_ID,
    source_id: SOURCE_ID,
    source_name: '招商 信用卡',
    source: 'csv',
    filename: '2026-08-cmb-credit.csv',
    size_bytes: 18432,
    skill_version: CATEGORY_VERSION,
    status: 'ready',
    row_count: 128,
    net_amount: '-4210.5500',
    base_currency: 'CNY',
    flags_summary: { duplicate: 3, refund_candidate: 1, transfer_candidate: 2, needs_review: 7 },
    row_status_summary: { pending: 121, edited: 5, skipped: 2 },
    uncategorized_count: 5,
    created_by: USER_ID,
    created_at: '2026-09-09T07:00:00.000000Z',
    updated_at: '2026-09-09T07:12:00.000000Z',
    committed_at: null,
    ...over,
  };
}

export function makeImportRow(over: Partial<ImportRow> = {}): ImportRow {
  return {
    id: IMPORT_ROW_ID,
    batch_id: BATCH_ID,
    row_no: 1,
    status: 'pending',
    date: '2026-08-03',
    amount: '-128.5000',
    currency: 'CNY',
    kind: 'expense',
    merchant: '全家便利店',
    note: 'FAMILYMART 3521',
    category_l1: 'food',
    category_l2: 'snacks_drinks',
    source_ref: 'p1:l14',
    flags: [],
    matched_transaction_id: null,
    counterpart_source_id: null,
    counterparty: null,
    transfer_role: null,
    transfer_subtype: null,
    hint: null,
    transaction_id: null,
    ...over,
  };
}

/** A 201 from POST /imports: the batch plus every draft row (decision §5). */
export function makeImportUploadResult(over: Partial<ImportUploadResult> = {}): ImportUploadResult {
  const batch = over.batch ?? makeImportBatch({ row_count: 2 });
  const second = makeImportRow({
    id: 'f6a7b8c9-7777-4888-8999-000011112222', row_no: 2, date: '2026-08-05',
    amount: '3000.0000', kind: 'income', merchant: '公司', note: null,
    category_l1: 'salary', category_l2: null, source_ref: 'p1:l15',
  });
  const rows = over.rows ?? [makeImportRow({ batch_id: batch.id }), { ...second, batch_id: batch.id }];
  return { batch, rows };
}

export function makeImportFormat(over: Partial<ImportFormat> = {}): ImportFormat {
  return {
    version: CATEGORY_VERSION,
    headers: [...IMPORT_HEADERS],
    columns: IMPORT_HEADERS.map((name) => ({
      name,
      required: name === 'date' || name === 'amount' || name === 'currency' || name === 'kind',
      desc_zh: `${name} 列说明`,
      desc_en: `The ${name} column`,
    })),
    sample_csv: SAMPLE_CSV,
    skill_text: 'Export the statement as the standard CSV described below.',
    skill_markdown: `# wallet-import\n\nversion: ${CATEGORY_VERSION}\n`,
    instructions_zh: '一、装 skill；二、让模型导出 CSV；三、回来上传。',
    instructions_en: '1. Install the skill. 2. Ask for the CSV. 3. Upload it here.',
    ...over,
  };
}

export function makeImportCommitResult(over: Partial<ImportCommitResult> = {}): ImportCommitResult {
  return {
    batch_id: BATCH_ID, status: 'committed', created_transactions: 121,
    created_transfer_pairs: 2, paired_existing_transfers: 1, linked_refunds: 3,
    skipped_rows: 7, committed_at: '2026-09-09T07:20:31.000000Z',
    ...over,
  };
}

/** Defaults to the `dry_run` answer; pass `{deleted: true}` for the real deletion. */
export function makeImportDeleteResult(over: Partial<ImportDeleteResult> = {}): ImportDeleteResult {
  return {
    batch_id: BATCH_ID, mode: 'revert', deleted: false, would_delete_transactions: 123,
    orphaned_refunds: 2, refunds_in_batch: 4,
    ...over,
  };
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
