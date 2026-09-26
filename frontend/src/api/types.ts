/**
 * API types — transcribed verbatim from docs/target-design/04-frontend.md §3.3.
 * Field names match the backend responses in 03-backend-api.md §5 exactly.
 * Decimals travel as strings (`Money`); never accumulate them as floats.
 */

// ---------- 通用 ----------
export type Uuid = string;
export type IsoDate = string;      // 'YYYY-MM-DD'（无时区日历日，决策 §14.32）
export type IsoDateTime = string;  // '2026-09-01T12:00:00.000000Z'（UTC，带 Z，03 §4.5）
export type Money = string;        // Decimal 的 JSON 形态，如 '-42.5000'
export interface Paged<T> { items: T[]; total: number; }
export interface ApiError { detail: string; code: string; }   // 决策 §9

// ---------- 配置（决策 §14.46）----------
// GET /config：匿名可读，注册页启动时就要知道能不能注册
export interface AppConfig { registration_open: boolean; }

// ---------- 我 ----------
// GET /me
export interface User {
  id: Uuid; email: string;
  display_name: string | null;     // ≤40 字；为空时界面显示邮箱 @ 前的部分（决策 §14.6、§14.40）
  base_currency: string;           // 新建账本的默认币种（决策 §2）
  language: 'zh' | 'en' | null;    // null = 跟随系统（决策 §14.6）
  created_at: IsoDateTime;
  ledger_count: number;            // 引导用便利字段
}
// PATCH /me：三个字段都可选；display_name 与 language 允许显式 null（= 清空 / 跟随系统）
export interface UserUpdate {
  display_name?: string | null;
  base_currency?: string;
  language?: 'zh' | 'en' | null;
}
export interface LoginRequest { email: string; password: string; }
// POST /auth/register
export interface RegisterRequest {
  email: string; password: string; base_currency: string; language?: 'zh' | 'en';
}
export interface AuthResponse { access_token: string; token_type: 'bearer'; }

// ---------- 分类（决策 §1.3）----------
// GET /categories：children 永远是数组，没有二级时是空数组
// desc_zh / desc_en 只有一级非空，二级恒为 null（决策 §14.21）
export interface Category {
  code: string; name_zh: string; name_en: string;
  desc_zh: string | null; desc_en: string | null;
  children: Category[];
}
export interface CategoryTree { version: string; expense: Category[]; income: Category[]; }

// ---------- 账本（决策 §2）----------
export interface Ledger {
  id: Uuid; name: string; base_currency: string;
  created_by: Uuid; created_at: IsoDateTime; updated_at: IsoDateTime;
  role: 'owner' | 'member';    // 当前用户在这本账里的角色
  member_count: number;
}
// GET /ledgers/{id} 比列表多一组计数，删除账本的确认框要显示它（决策 §14.52 A22）
export interface LedgerDetail extends Ledger {
  counts: { transactions: number; sources: number; import_batches: number };
}
export interface LedgerCreate { name: string; base_currency?: string; }
export interface LedgerUpdate { name?: string; base_currency?: string; updated_at: IsoDateTime; }
export interface LedgerMember {
  user_id: Uuid; email: string;
  display_name: string | null;                 // 决策 §14.40 的 01-7：显示它，为空回退邮箱前缀
  role: 'owner' | 'member'; joined_at: IsoDateTime;
  is_me: boolean;
}
// POST /ledgers/{id}/invites：code 只在这一次响应里出现；10 分钟后过期，用掉即删（决策 §2、§14.29）
export interface LedgerInvite {
  id: Uuid; code: string; ledger_id: Uuid; ledger_name: string;
  expires_at: IsoDateTime; created_at: IsoDateTime;
}
export interface JoinLedgerRequest { code: string; }
export interface TransferOwnershipRequest { to_user_id: Uuid; }

// ---------- 资金账户（决策 §3、§14.48、§14.50）----------
// 四种类型，没有 savings（新加坡没有这个区分，「储蓄」就是 checking，决策 §14.48）
export type SourceType = 'checking' | 'credit' | 'cash' | 'other';
// 账户归用户、按账本共享（决策 §14.62）。本人视角（GET /sources）下 opening_balance、余额四件套、
// shared_to 都有值；账本内列表（GET /ledgers/{id}/sources）里别人的账户（mine=false）这些字段全为 null。
export interface FinanceSource {
  id: Uuid; owner_id: Uuid; name: string; type: SourceType;
  default_currency: string;          // 创建后不可改（决策 §14.50）
  opening_balance: Money | null;     // 信用卡填欠款，存为负数（决策 §14.52 A13）；非本人为 null
  archived: boolean;
  archived_at: IsoDateTime | null;   // 决策 §14.50；归档账户不计入净资产
  created_by: Uuid; updated_by: Uuid | null;
  created_at: IsoDateTime; updated_at: IsoDateTime;
  shared_to: Uuid[] | null;          // 共享到的账本（只列调用者仍是成员的）；非本人为 null
  // 余额四件套（口径见决策 §14.2、§14.62）——这张卡在所有账本里的交易之和；非本人全为 null：
  balance: Money | null;             // 以账户 default_currency 计价；异币种交易按发生日汇率折进来
  balance_base: Money | null;        // 按最新汇率折到主人的 base_currency
  balance_rate: Money | null;        // 这次用的汇率，8 位小数
  balance_rate_date: IsoDate | null; // 该汇率的行情日
  rate_missing_count: number;        // 折不出来被跳过的交易数；非本人为 0
}
// GET /ledgers/{id}/sources 的一行：本人的、成员共享进来的、以及本账本交易引用到的（usable=false）
export type LedgerSource = FinanceSource & { mine: boolean; usable: boolean };
// GET /sources：本人全部账户 + 个人净资产三个数（任一未归档账户折不出来则三个都为 null）
export interface SourceListResponse extends Paged<FinanceSource> {
  base_currency: string;
  assets: Money | null;
  liabilities: Money | null;
  net_worth: Money | null;
}
export interface FinanceSourceCreate {
  name: string; type: SourceType; default_currency: string; opening_balance?: Money;
  share_to?: Uuid[];                 // 建好即共享到这些账本（都必须是我所在的）
}
// default_currency 不在可改字段里（决策 §14.50）
export interface FinanceSourceUpdate {
  name?: string; type?: SourceType; opening_balance?: Money; archived?: boolean;
  updated_at: IsoDateTime;      // 乐观并发（决策 §2）
}

// ---------- 交易（决策 §1、§10）----------
export type TxKind = 'expense' | 'income' | 'refund' | 'transfer';
export type TransferRole = 'out' | 'in';
export type TransferSubtype = 'plain' | 'repayment';

export interface Transaction {
  id: Uuid; ledger_id: Uuid; source_id: Uuid;
  kind: TxKind;
  amount: Money;                 // expense/transfer-out 为负；income/refund/transfer-in 为正
  currency: string; occurred_at: IsoDate;
  note: string | null;           // 现状的 description 改名（决策 §1.4）
  merchant: string | null;       // 转账行恒为 null（决策 §14.52 B16）
  category_l1: string | null;    // transfer 必为 null；其余必填
  category_l2: string | null;
  transfer_role: TransferRole | null;
  transfer_subtype: TransferSubtype | null;
  transfer_pair_id: Uuid | null; // 两腿共用；单腿为 null
  counterparty: string | null;   // 单腿转账的对方文本
  refund_of: Uuid | null;        // kind==='refund' 时可指向原支出
  import_batch_id: Uuid | null;
  created_by: Uuid; updated_by: Uuid | null;
  created_at: IsoDateTime; updated_at: IsoDateTime;
  // 折算三件套：按 occurred_at 当天（或回退后的最近行情日）汇率折到账本基准币种；
  // 取不到汇率时三者同时为 null。详情页把 rate_used / rate_date 显示出来（决策 §14.52 A24）。
  amount_base: Money | null;
  rate_used: Money | null;
  rate_date: IsoDate | null;
  // 只在 kind === 'expense' 的行上出现：
  refunded_total?: Money;        // 指向该行的所有 refund 的 amount 之和（正数）
  refundable?: Money;            // |amount| - refunded_total，可以为负（允许超额退款，决策 §1.1）
  // 只在 GET /transactions/{tid} 上出现的三组扩展（决策 §14.46、§14.51）：
  pair?: TransactionPairRef | null;   // 两腿转账时的对腿引用；非转账 / 单腿为 null
  refunds?: RefundRef[];              // kind==='expense'：指向它的每一笔退款
  refund_of_detail?: RefundOrigin | null; // kind==='refund'：refund_of 展开的原单摘要
  events?: TransactionEvent[];        // 操作记录，按时间倒序（决策 §14.51）
}

// 详情里那个精简的对腿引用：out/in 各只有四个字段，键名是 transaction_id 而不是 id。
// 不要和 §5.33/§5.34 响应的 TransferPair 混用（那个带完整的两条 Transaction）。
export interface TransactionPairRef {
  pair_id: Uuid;
  out: { transaction_id: Uuid; source_id: Uuid; amount: Money; currency: string };
  in:  { transaction_id: Uuid; source_id: Uuid; amount: Money; currency: string };
}
// 一笔退款的摘要；字段逐条对齐 03 §5.27 里 refund_of_detail.other_refunds[] 的元素（决策 §14.53f）
export interface RefundBrief {
  id: Uuid; occurred_at: IsoDate; amount: Money; currency: string; note: string | null;
}
// 支出详情上的退款列表（决策 §14.46 的 04-D-6）；字段逐条对齐 03 §5.27 的 refunds[]（决策 §14.53f）
// 比 RefundBrief 多一个 source_id：03 只在 refunds[] 的元素上给了退回账户
export interface RefundRef extends RefundBrief {
  source_id: Uuid;                     // 退回账户——画这一行时要显示账户名（决策 §14.53f）
}
// 退款详情上的原单摘要（决策 §14.46 的 04-D-6、§14.52 A25），逐字段同 03 §5.27 的 refund_of_detail
export interface RefundOrigin {
  id: Uuid; occurred_at: IsoDate; merchant: string | null;
  amount: Money; currency: string;
  source_id: Uuid;                     // 原单记在哪个账户上（决策 §14.53f）
  category_l1: string | null;          // 原单的分类，登记退款时沿用（决策 §14.53f）
  category_l2: string | null;
  refunded_total: Money; refundable: Money;
  other_refunds: RefundBrief[];        // 指向**同一张原单**的其它退款，不含当前这条，按日期升序
                                       // （决策 §14.52 A25）；只被退过这一次时是空数组。03 §5.27 的这些
                                       // 元素**没有** source_id，所以这里用窄类型，界面上不显示退回账户
}
// 操作记录（决策 §14.51）：只追加不修改，交易删除时级联删除
export type TransactionEventType =
  | 'created' | 'updated' | 'imported' | 'paired' | 'unpaired'
  | 'refund_linked' | 'refund_unlinked';
export interface TransactionEvent {
  id: Uuid; transaction_id: Uuid;
  actor_id: Uuid; at: IsoDateTime;
  event: TransactionEventType;
  changes: Record<string, { before: unknown; after: unknown }> | null;
  import_batch_id: Uuid | null;
  client: string | null;       // 来自请求头 X-Client；本版本恒为 'web'
}

export interface TransactionCreate {
  source_id: Uuid; kind: TxKind;
  amount: Money; currency: string; occurred_at: IsoDate;   // amount 带符号，字符串形态
  note?: string | null; merchant?: string | null;
  category_l1?: string | null; category_l2?: string | null;
  refund_of?: Uuid | null;
  transfer_role?: TransferRole; transfer_subtype?: TransferSubtype; counterparty?: string | null;
}
export interface TransactionUpdate extends Partial<TransactionCreate> {
  updated_at: IsoDateTime;       // 必填：乐观并发
}

// 两腿转账（决策 §1.2）：一次请求建两条。请求体是**扁平**的，不是嵌套的 out/in。
export interface TransferCreate {
  from_source_id: Uuid; to_source_id: Uuid;   // 必须不同，否则 400 same_source
  amount_out: Money;  currency_out: string;   // amount_out 传正数，服务端存成负数
  amount_in: Money;   currency_in: string;    // 不要求等于 amount_out（跨币种）
  occurred_at: IsoDate;
  subtype: TransferSubtype;                   // 字段名是 subtype，不是 transfer_subtype
  note?: string | null;                       // 没有 merchant、没有 counterparty
}
export interface TransferUpdate extends Partial<TransferCreate> {
  updated_at: IsoDateTime;       // 两腿 updated_at 中较大的那个
}
export interface TransferPair {
  pair_id: Uuid;
  occurred_at: IsoDate; subtype: TransferSubtype; note: string | null;
  out: Transaction; in: Transaction;
  updated_at?: IsoDateTime;
}
// 配对 / 拆开（决策 §14.34）
// POST /ledgers/{id}/transactions/{tid}/pair：把两条单腿转账合成一笔
export interface TransactionPairRequest { other_transaction_id: Uuid; }   // 03 §5.33 的字段名
// 配对的响应是合成后的 TransferPair；unpair 无请求体，响应是 03 §5.34 的
// `{pair_id, unpaired}`——两条腿的**精简**形态，不是完整的 Transaction（同步 2026-09-15）
export interface UnpairedLeg {
  id: Uuid; source_id: Uuid; kind: 'transfer';
  transfer_role: TransferRole; transfer_subtype: TransferSubtype;
  amount: Money; currency: string;
  transfer_pair_id: Uuid | null;      // 拆开之后恒为 null
  counterparty: string | null;
  updated_at: IsoDateTime;
}
export interface UnpairResult { pair_id: Uuid; unpaired: UnpairedLeg[]; }

export interface TransactionListParams {
  q?: string; kind?: TxKind[]; category_l1?: string; category_l2?: string;
  source_id?: Uuid[]; from?: IsoDate; to?: IsoDate; currency?: string[]; // 可重复，IN（决策 §14.60）
  min_amount?: number; max_amount?: number;   // 按基准币种折算后的绝对值比较（决策 §14.49）
  import_batch_id?: Uuid;                     // 决策 §14.46 的 04-D-7
  limit?: number; offset?: number;            // limit 上限 200（决策 §14.44 的 03-14）
}
// 交易列表：信封外多一个 summary（决策 §14.52 A14），底部汇总条与「筛空提示」都用它
export interface TransactionSummary {
  base_currency: string;
  expense: Money;         // 正数
  income: Money;
  net: Money;             // income − expense，**不含转账**
  count: number;          // 给了金额区间时只计能折算的行；没给区间时含全部命中行（与 total 相同）
  rate_missing_count: number;
}
export interface TransactionListResponse extends Paged<Transaction> {
  summary: TransactionSummary;
}

// 退款关联选择器用（决策 §1.1、§14.11：不另设候选接口，复用交易列表）
export interface RefundCandidate extends Transaction {
  refunded_total: Money;
  refundable: Money;
}

// ---------- 统计（决策 §7）----------
export interface StatsCategoryChild {
  code: string | null;           // null = 「有一级没二级」的部分
  name_zh: string; name_en: string;
  amount: Money; count: number;
}
export interface StatsCategoryNode {
  code: string; name_zh: string; name_en: string;
  amount: Money;                 // 正数；退款已冲减，可能为负（决策 §14.44 的 03-10）
  share: number;                 // ∈ [0,1]，4 位小数；total 为 0 时全是 0
  count: number;
  children: StatsCategoryChild[];
}
export interface StatsSummary {
  month: string;                 // 'YYYY-MM'
  base_currency: string;
  expense_total: Money;          // 已按退款冲减
  income_total: Money;
  net: Money;
  expense: StatsCategoryNode[];  // 按 amount 降序，金额为 0 的分类不出现
  income: StatsCategoryNode[];
  refund_total: Money;           // 当月退款总额（正数），用于「其中已冲减退款 ¥82.98」
  rate_missing_count: number;    // 因取不到汇率被跳过的行数，> 0 时提示「部分交易未计入」
}
// 首页趋势**只画支出**（决策 §7、§14.52 B20）：即使响应里还有别的字段也不渲染
export interface StatsTrend {
  base_currency: string;
  months: Array<{ month: string; expense: Money }>;  // 升序，空月补 0
  rate_missing_count: number;
}

// ---------- 导入（决策 §5、§6、§14.47）----------
// GET /import-format（公开）：导入指南页的全部内容都来自它，前端不硬编码 skill 文本与列名
export interface ImportFormat {
  version: string;                 // 分类表版本，日期串如 '2026-09-10'（决策 §14.30）
  headers: string[];               // 固定 11 列，顺序即文件里的顺序
  columns: Array<{ name: string; required: boolean; desc_zh: string; desc_en: string }>;
  sample_csv: string;              // 示例文件的完整文本（含 '# version:' 首行）
  skill_text: string;              // ChatGPT 用的指令文本
  skill_markdown: string;          // Claude 用的 SKILL.md 全文
  instructions_zh: string; instructions_en: string;   // 三步说明
}

// 状态只有两个（决策 §5）：校验通过即 ready；提交后 committed。没有 parsing / failed / reverted。
export type ImportStatus = 'ready' | 'committed';
export type ImportRowStatus = 'pending' | 'edited' | 'skipped';
// 标记只有四种（决策 §5、§14.31、§14.34）：旧的 repayment 改名为 transfer_candidate，「已合并」整条取消
export type ImportFlag = 'duplicate' | 'refund_candidate' | 'transfer_candidate' | 'needs_review';

// 批次的字段名以 [`./02-database.md`](./02-database.md) §1.7 的 DDL 为准，
// 03 §5.38 的响应用的是同一套名字（决策 §14.53e）：source / filename / size_bytes /
// skill_version / row_count / committed_at。
export interface ImportBatch {
  id: Uuid; ledger_id: Uuid; source_id: Uuid; source_name: string;
  source: 'csv' | 'paste';         // 上传文件还是粘贴文本；只有这两个值（决策 §5、§14.47）
  filename: string | null;         // 只记名字与大小，**不保存文件**（决策 §14.28）；粘贴批次为 null
  size_bytes: number;              // 文件或粘贴文本的 UTF-8 字节数
  skill_version: string;           // 文件里那一行 '# version:'
  status: ImportStatus;
  row_count: number;
  net_amount: Money;               // 这批交易金额之和，按账本基准币种（决策 §14.52 A17）
  base_currency: string;           // net_amount 所用的币种 = 账本基准币种
  flags_summary: Record<ImportFlag, number>;
  row_status_summary: Record<ImportRowStatus, number>;
  uncategorized_count: number;     // 还差几行没补一级分类（提交阻断条件，§4.11.8）
  created_by: Uuid;                // 只回 UUID；上传人的名字由前端用成员列表映射（决策 §14.43 的 03-4）
  created_at: IsoDateTime; updated_at: IsoDateTime;
  committed_at: IsoDateTime | null;
}
// 列表项与详情**同形状**（03 §5.38：净额、标记数、目标账户名、上传人在列表里就有，
// 前端不用为列表再查一遍详情）
export type ImportBatchListItem = ImportBatch;
// POST /ledgers/{id}/imports 的成功响应：批次 + 全部草稿行，一次给完（同步校验，决策 §5）
export interface ImportUploadResult { batch: ImportBatch; rows: ImportRow[]; }
// 400 结构错误 / skill_outdated 的响应体：不建批次（决策 §5）。
// 四个扩展字段逐字段照抄 03 §5.37 的响应体（决策 §14.53f），不另起名字。
export interface ImportFileError extends ApiError {
  errors?: Array<{ line: number; message: string }>;   // import_format_invalid 时给；
                                                       // line 是**文件里的物理行号**（1 起：
                                                       // '# version:' 是第 1 行、表头是第 2 行）
  current_version?: string;                            // skill_outdated：应用当前的分类表版本
  file_version?: string | null;                        // skill_outdated：文件首行声明的版本
  guide_url?: string;                                  // skill_outdated：导入指南页链接，渲染成按钮
}

// 草稿行；行号列名是 row_no（决策 §14.5），日期字段在接口上仍叫 date（决策 §14.41 的 02-D-3）
export interface ImportRow {
  id: Uuid; batch_id: Uuid; row_no: number; status: ImportRowStatus;
  date: IsoDate | null; amount: Money | null; currency: string | null;
  kind: TxKind | null; merchant: string | null; note: string | null;
  category_l1: string | null; category_l2: string | null;
  source_ref: string | null;                // skill 写的「原文哪一行」，只读
  flags: ImportFlag[];
  matched_transaction_id: Uuid | null;      // refund_candidate 的原支出 / transfer_candidate 的对腿。
                                            // 转账配对的**唯一载体**（决策 §14.53b）：非空 = 勾上
                                            // 「关联为一笔转账」，取消勾选就 PATCH 成 null。
                                            // 配对状态**只有这一列**：多候选时它是 null，候选列表不落库
  counterpart_source_id: Uuid | null;       // 转账行的对手账户（不合并、按两腿建时用）；
                                            // 服务端不猜，找不到对腿时留空由用户选（决策 §14.53c）
  counterparty: string | null;              // 单腿转账的对手文本；校验阶段恒为 null，
                                            // 只有 review 里 PATCH 才有值（决策 §14.10、§14.16）
  transfer_role: TransferRole | null;
  transfer_subtype: TransferSubtype | null;
  hint: string | null;                      // 服务端给 review 的只读提示，不可改、不进 note
  transaction_id: Uuid | null;              // 提交后回填
}
export interface ImportRowListParams {
  status?: ImportRowStatus[]; flag?: ImportFlag[]; flagged?: boolean; uncategorized?: boolean;
  limit?: number;   // 上限 500（决策 §14.44 的 03-14）
  offset?: number;
}
export type ImportRowPatch = Partial<Pick<ImportRow,
  'status' | 'date' | 'amount' | 'currency' | 'kind' | 'merchant' | 'note' |
  'category_l1' | 'category_l2' | 'matched_transaction_id' |
  'counterpart_source_id' | 'counterparty' | 'transfer_role' | 'transfer_subtype'>>;
// 注意 hint / flags / source_ref / row_no 不在可改字段里
// PATCH .../imports/{bid}/rows（批量，决策 §14.52 A4）。
// **要么全成要么全不成**（03 §5.42）：整批在一个事务里跑，任何一行校验不过就 400 并全部回滚，
// 没有「部分成功」这种响应，因此响应里也没有「被跳过的行」这一项。
// 批量体不收 matched_transaction_id / counterpart_source_id / counterparty 三个逐行关联字段
// （05 §4.1；03 §5.42 那句「与 §5.41 的可改字段完全相同」与之冲突，取 05，见 00-decisions §14.55）。
// 服务端 ImportRowsBulkRowPatch 多带一个就 422。
export type ImportRowsBulkRowPatch = Omit<ImportRowPatch,
  'matched_transaction_id' | 'counterpart_source_id' | 'counterparty'>;
export interface ImportRowsBulkPatch { row_ids: Uuid[]; patch: ImportRowsBulkRowPatch; }
export interface ImportRowsBulkResult {
  updated: number;              // 改掉的行数
  rows: ImportRow[];            // 这些行改完之后的完整形态，字段同 ImportRow
}
// POST .../imports/{bid}/commit（无请求体，决策 §14.18）
export interface ImportCommitResult {
  batch_id: Uuid; status: 'committed';
  created_transactions: number;        // 这一批建出来的交易条数
  created_transfer_pairs: number;      // 由 counterpart_source_id 两腿一起建出来的转账对数
  paired_existing_transfers: number;   // 与库里已有的单腿转账配对成功的行数（决策 §14.34）
  linked_refunds: number;              // 写进 refund_of 的退款行数（决策 §14.7）
  skipped_rows: number;
  committed_at: IsoDateTime;
}
// DELETE .../imports/{bid}：带 ?dry_run=true 先问要删多少，再真删（决策 §14.43、§14.52 B24）
export interface ImportDeleteResult {
  batch_id: Uuid;
  mode: 'discard' | 'revert';          // ready = 丢弃草稿；committed = 撤销并删交易
  deleted: boolean;
  would_delete_transactions?: number;  // dry_run=true 时给
  deleted_transactions?: number;       // 真删时给
  orphaned_refunds: number;            // **批外**退款将失去原单（决策 §14.43 的 03-9）
  refunds_in_batch: number;            // **批内**退款被删后，其原支出恢复可退额度（决策 §14.52 B24）
}

// ---------- 汇率 ----------
export interface CurrencyList { currencies: Record<string, string>; }
