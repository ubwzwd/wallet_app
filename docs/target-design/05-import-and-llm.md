# 05 — 账单导入：标准格式、skill 与校验（目标设计）

> **本文回答什么问题：** 应用**不接入任何大模型**（决策 §0.1、§5、§14.25）。用户在自己的 ChatGPT / Claude 里跑我们发布的 skill，把任意账单整理成**标准导入 CSV**，再上传或粘贴到应用；应用只做同步校验、自动标记、review、入账、撤销。本章给出：标准 CSV 的完整契约（11 列固定表头、`# version:` 行、转义规则、三个完整示例）；服务端逐条校验规则与错误形态；`duplicate` / `refund_candidate` / `transfer_candidate` / `needs_review` 四种自动标记的算法；review 的可改字段、批量端点与提交映射（含退款 `refund_of`、转账配对 `transfer_pair_id`、`transaction_events` 操作记录）；撤销与 `dry_run`；`skills/wallet-import/` 的目录结构与 **`SKILL.md` 全文**、ChatGPT 版指令文本、生成脚本；安全与测试。
>
> **本文是目标设计，不是现状。** 仓库里目前没有任何导入相关代码：`backend/app` 下只有 `api/`（auth、rates、finance_sources、transactions）、`core/`、`models/`、`schemas/`、`services/rates.py`。本章描述的每一个模块、表、交付物都需要新建。
>
> **本版按 2026-09-10 / 09-11 的裁定整章重写。** 2026-09-10 决定应用不接入大模型（决策 §14.25），2026-09-11 决定标准格式只做 CSV（§14.47）。原章里的解析流水线、格式抽取、分块、模型调用、提示词、视觉路径、成本与进度全部**删除**，不保留、不加注；保留并改写的只有自动标记、与标准文件相关的校验、提交映射与撤销、安全、测试。
>
> 所有决定都可追溯到 [`00-decisions.md`](./00-decisions.md)，标注形如（决策 §5）。本文不改写决策。错误 code 一律取 [`03-backend-api.md`](./03-backend-api.md) §4.2 注册表里的名字（决策 §14.4）。

---

## 0. 总览

### 0.1 全景 ASCII 流程图

```text
  用户自己的 ChatGPT / Claude                 浏览器                       FastAPI 进程
  （用户自己的订阅，应用不参与）
 ┌───────────────────────────┐
 │ 装上 skills/wallet-import │
 │  ┌─────────────────────┐  │
 │  │ 任意账单：           │  │
 │  │ PDF / 图片 / XLSX /  │  │
 │  │ CSV / 复制的网页文本 │  │
 │  └──────────┬──────────┘  │
 │             ↓             │
 │  按 SKILL.md 的规则整理   │
 │             ↓             │
 │   标准导入 CSV（§1）      │
 │  # version: 2026-09-10    │
 │  date,amount,currency,…   │
 └──────────┬────────────────┘
            │  用户下载 .csv 文件，或复制代码块里的文本
            ↓
      ┌─────────────────────┐
      │ 导入指南 → 上传页   │   选目标账户（一份文件 = 一个账户）
      │ ① 上传 .csv 文件    │─── POST /ledgers/{lid}/imports ──────────┐
      │ ② 或粘贴 CSV 文本   │    multipart 或 JSON 体 {source_id,text} │
      └─────────────────────┘                                          ↓
                                                        ┌──────────────────────────┐
                                                        │ reading.read_csv()       │  §1
                                                        │  解码 / 去 BOM / 切行     │
                                                        └────────────┬─────────────┘
                                                                     ↓
                                                        ┌──────────────────────────┐
                     400 import_file_invalid  ←──────────│ validation.check_shape() │  §2.2
                     （逐行错误清单，不建批次） │         │  版本行 / 表头 / 列数     │
                     400 skill_outdated       ←──────────│ validation.check_version()│ §2.3
                     （带应用当前版本 + 指南链接）        └────────────┬─────────────┘
                                                                     ↓
                                                        ┌──────────────────────────┐
                                                        │ validation.normalize_row()│ §2.4
                                                        │  逐行改正 + 写 hint       │
                                                        └────────────┬─────────────┘
                                                                     ↓
                                                        ┌──────────────────────────┐
                                                        │ flagging.flag_rows()      │ §3
                                                        │ duplicate / refund_cand.  │
                                                        │ transfer_cand. / needs_rev│
                                                        └────────────┬─────────────┘
                                                                     ↓
      ┌─────────────────────┐                            ┌──────────────────────────┐
      │ review 表格         │←── 200 批次 + 全部草稿行 ───│ import_batches  status=  │
      │ 筛选：全部/待归类/  │    （同步返回，无轮询、    │ 'ready'                  │
      │       有标记        │      无后台任务、无进度）  │ import_rows  status=     │
      │ 改一行 / 批量改     │─── PATCH .../rows/{rid}    │ 'pending'                │
      │ 关联原单 / 配对转账 │─── PATCH .../rows（批量）  └──────────────────────────┘
      └──────────┬──────────┘
                 │  POST .../commit
                 ↓
      ┌──────────────────────────────────────────────────────────────────────────┐
      │ committing.commit_batch()  单事务：                                       │
      │   草稿行 → transactions（退款写 refund_of；转账配对写同一 transfer_pair_id │
      │   并清空对方 counterparty；单腿写 counterparty）                          │
      │   每笔追加 transaction_events(event='imported')                          │
      │   批次 status = 'committed'                                              │
      └──────────┬───────────────────────────────────────────────────────────────┘
                 │  DELETE .../imports/{bid}
                 ↓
      ┌──────────────────────────────────────────────────────────────────────────┐
      │ committing.delete_batch()  整批删除（决策 §14.22）：                       │
      │   dry_run=true → {orphaned_refunds, refunds_in_batch}，不删                │
      │   真删 → 拆开配进去的 pair（存活对腿追加 unpaired 事件）                  │
      │        → 删交易（其事件级联）→ 删批次（草稿行级联）；批次行从此消失        │
      └──────────────────────────────────────────────────────────────────────────┘
```

三件事在图上没有，是**有意没有**：没有后台任务（校验是同步的，秒级）、没有进度、没有任何外部模型调用。批次状态机只有两个状态：

```text
   （上传/粘贴）                （POST .../commit）
        │                              │
        ↓        校验全过             ↓
      ready ─────────────────────► committed
        │                              │
        │ DELETE = 丢弃                │ DELETE = 撤销（整批删除）
        ↓                              ↓
     （批次消失）                  （批次消失）

   校验没过 → 400，不建批次，什么都不写库
```

### 0.2 与 `03-backend-api.md` 的接口对应

| 端点（决策 §11） | 本章对应小节 | 说明 |
|---|---|---|
| `POST /ledgers/{lid}/imports` | §1、§2、§3 | multipart 上传 `.csv`，或 JSON 体 `{source_id, text}` 粘贴；同步返回批次 + 全部草稿行 |
| `GET /ledgers/{lid}/imports` | §4.9 | 批次列表：净额、标记数、目标账户、上传人（决策 §14.52 A17） |
| `GET /ledgers/{lid}/imports/{bid}` | §4.9 | 批次详情，无 `progress` 字段 |
| `GET /ledgers/{lid}/imports/{bid}/rows` | §4.1 | 草稿行列表，支持 `filter=all\|uncategorized\|flagged`（§4.2） |
| `PATCH /ledgers/{lid}/imports/{bid}/rows/{rid}` | §4.1 | 改单行 |
| `PATCH /ledgers/{lid}/imports/{bid}/rows` | §4.1 | **批量**改（决策 §14.52 A4）：`{row_ids: [...], patch: {...}}` |
| `POST /ledgers/{lid}/imports/{bid}/commit` | §4.3–§4.7 | 无请求体（决策 §14.18） |
| `DELETE /ledgers/{lid}/imports/{bid}` | §4.8 | `ready` = 丢弃，`committed` = 撤销；`?dry_run=true` 只回数 |
| `GET /import-format`（公开） | §5.5 | 标准格式说明、示例文件、skill 文本、当前 `version` |
| `GET /categories`（公开） | §2.4、§5.4 | 分类表与 `version`，与 skill 同源 |

本章用到、必须出现在 [`03-backend-api.md`](./03-backend-api.md) §4.2 注册表里的 code（决策 §14.4）：

| code | HTTP | 触发处 |
|---|---|---|
| `import_file_invalid` | 400 | §2.2 结构错误（编码不可读、缺版本行、表头不符、列数不对） |
| `skill_outdated` | 400 | §2.3 `# version:` 缺失或与应用当前分类表版本不一致 |
| `rows_exceed_limit` | 400 | §2.6 超过 2000 行 |
| `file_too_large` | 413 | §2.6 超过 2 MB |
| `import_rate_limited` | 429 | 每用户每小时 10 批（决策 §5） |
| `source_archived` | 409 | 目标账户或对手账户已归档 |
| `batch_not_ready` | 409 | §4.3 批次不是 `ready`，或必填字段仍为空 |
| `batch_already_committed` | 409 | §4.3 重复提交 |
| `rows_uncategorized` | 409 | §4.3 有非转账行没有一级分类 |
| `rows_all_skipped` | 409 | §4.3 所有行都被跳过 |
| `category_kind_mismatch` | 400 | §4.3 分类收支组与 kind 不符 |
| `category_invalid` | 400 | §4.3 二级不属于一级 / 转账行带分类 |
| `refund_target_invalid` | 400 | §4.3 退款原单不是同账本的 `kind='expense'` |
| `pair_target_invalid` | 400 | §4.3 配对目标不是同账本、方向相反的单腿转账 |
| `already_paired` | 409 | §4.3 配对目标在提交前已被别人配走 |
| `stale_update` | 409 | `PATCH .../rows` 的乐观锁（决策 §2） |

### 0.3 `services/importing/` 四个模块

决策 §14.27：导入代码放 `backend/app/services/importing/`，按**读文件 / 校验 / 标记 / 提交撤销**分文件，没有抽取器目录、没有模型客户端。

| 文件 | 职责 |
|---|---|
| `reading.py` | 把上传的字节或粘贴的文本变成"版本行 + 表头 + 原始行列表"，只管解码与切分，不判语义 |
| `validation.py` | §2 的全部规则：结构检查、版本检查、逐行归一化与 `hint` |
| `flagging.py` | §3 的四种自动标记 |
| `committing.py` | §4 的提交映射、转账配对、`transaction_events`、撤销与 `dry_run` |

顶层函数签名（全部同步函数，跑在请求线程里；校验路径不碰数据库，标记与提交路径复用请求会话）：

```python
# backend/app/services/importing/reading.py  （新增）

@dataclass(frozen=True)
class RawFile:
    """解码后的标准文件。行已按 RFC 4180 切好，尚未做任何语义判断。"""
    version_line: str | None        # 首行原文，例如 "# version: 2026-09-10"；缺失为 None
    header: list[str] | None        # 第二行切出的列名；缺失为 None
    rows: list[list[str]]           # 数据行，每行是切好的字段列表（长度可能不是 11）
    row_numbers: list[int]          # 每条数据行在原文里的行号（1 基，含版本行与表头）

def read_upload(data: bytes, filename: str) -> RawFile:
    """上传的 .csv 文件。UTF-8（可带 BOM）解码，解不出来抛 ImportFileInvalid。"""

def read_paste(text: str) -> RawFile:
    """粘贴的 CSV 文本。与 read_upload 走同一套切分规则（决策 §5）。"""


# backend/app/services/importing/validation.py  （新增）

@dataclass
class RowDraft:
    """一条草稿行在内存里的样子。字段与 import_rows 的列一一对应（02 §1.9）。"""
    row_no: int
    occurred_at: date | None        # 文件列名是 date，库里叫 occurred_at（决策 §14.41 02-D-3）
    amount: Decimal
    currency: str
    kind: str
    transfer_role: str | None
    transfer_subtype: str | None
    merchant: str | None
    note: str | None
    category_l1: str | None
    category_l2: str | None
    source_ref: str | None
    counterparty: str | None = None            # 恒为 None，用户在 review 里填（决策 §14.16）
    matched_transaction_id: UUID | None = None
    counterpart_source_id: UUID | None = None
    hint: str | None = None
    flags: set[str] = field(default_factory=set)
    candidate_ids: list[UUID] = field(default_factory=list)   # 只在内存里，不落列

class ImportFileInvalid(ApiError):
    """400 import_file_invalid。errors 是 [{line, message}] 的逐行清单（§2.2）。"""

class SkillOutdated(ApiError):
    """400 skill_outdated，detail 带应用当前 version 与导入指南链接（§2.3）。"""

def check_shape(raw: RawFile) -> None:
    """结构检查：版本行、11 列固定表头、每行列数。不过就抛 ImportFileInvalid。"""

def check_version(raw: RawFile, current: str) -> str:
    """比对 `# version:`，一致则返回版本串，否则抛 SkillOutdated。"""

def normalize_rows(raw: RawFile, ctx: ImportContext) -> list[RowDraft]:
    """§2.4 的逐行规则 + §2.7 的批内重复检查。只改正、不丢行。"""


# backend/app/services/importing/flagging.py  （新增）

def flag_rows(db: Session, ctx: ImportContext, rows: list[RowDraft]) -> None:
    """§3 的四种标记，就地改 rows 的 flags / matched_transaction_id / hint。"""


# backend/app/services/importing/committing.py  （新增）

@dataclass(frozen=True)
class CommitResult:
    transaction_count: int
    paired_count: int               # 与库里已有单腿配对成功的条数

@dataclass(frozen=True)
class DeleteResult:
    mode: Literal["discard", "revert"]
    transaction_count: int
    orphaned_refunds: int           # 批外退款将失去原单（决策 §14.52 B24）
    refunds_in_batch: int           # 批内退款，删除后其原支出恢复可退额度
    deleted: bool

def commit_batch(db: Session, batch_id: UUID, actor_id: UUID,
                 client: str | None) -> CommitResult:
    """§4.3–§4.7。单事务；client 来自请求头 X-Client，写进 transaction_events。"""

def delete_batch(db: Session, batch_id: UUID, actor_id: UUID,
                 client: str | None = None, dry_run: bool = False) -> DeleteResult:
    """§4.8。committed = 撤销，ready = 丢弃；两者最终都让这一批整个消失。
    删交易前先拆开配进去的 pair，并给存活的对腿追加 unpaired 事件。"""
```

`ImportContext` 是上传时装配一次的只读上下文：`ledger_id`、`source_id`、`source_currency`、`source_type`（`checking` / `credit` / `cash` / `other`，决策 §14.48）、`base_currency`、`actor_id`、`category_version`。它会被日志打印，所以里面不放任何账单内容。

---

## 1. 标准导入格式（唯一契约）

### 1.1 文件形态

决策 §5、§14.47：**只有 CSV**，不接受 JSON，也不接受 XLSX / PDF —— 那些格式由用户的 ChatGPT / Claude 在自己那边读，应用这边只认整理好的结果。

| 项 | 规定 |
|---|---|
| 编码 | UTF-8，可带 BOM（服务端剥掉）；其它编码一律 400 `import_file_invalid` |
| 首行 | 必须是 `# version: YYYY-MM-DD`，冒号后允许有空格，日期是**分类表版本**（`CATEGORY_VERSION`） |
| 第二行 | 必须是固定表头，11 列，顺序不可变，大小写敏感 |
| 第三行起 | 数据行，每行 11 个字段 |
| 行分隔 | `\n` 或 `\r\n`；末尾空行忽略 |
| 注释 | 除首行外**不接受** `#` 开头的行，也不接受中间空行 |
| 大小 | ≤2 MB；≤2000 数据行（决策 §5） |
| 一份文件 | 对应**一个**目标账户，账户由用户在上传时选，文件里不含账户信息（决策 §5） |

固定表头：

```csv
date,amount,currency,kind,transfer_role,transfer_subtype,merchant,note,category_l1,category_l2,source_ref
```

### 1.2 列定义

| # | 列 | 必填 | 取值 | 说明 |
|---|---|---|---|---|
| 1 | `date` | 是 | `YYYY-MM-DD` | 交易发生的日历日期，无时间、无时区（决策 §14.32） |
| 2 | `amount` | 是 | 十进制数，最多 4 位小数 | **支出为负**，收入与退款为正，转账按 `transfer_role` 定号（决策 §1）。不带货币符号、不带千分位 |
| 3 | `currency` | 是 | 三位大写字母 | 这一笔的原币种，例如 `CNY` / `SGD` / `USD` |
| 4 | `kind` | 是 | `expense` / `income` / `refund` / `transfer` | 决策 §1 的四种，不多不少 |
| 5 | `transfer_role` | 转账必填 | `out` / `in` | 非转账留空 |
| 6 | `transfer_subtype` | 转账必填 | `plain` / `repayment` | `repayment` = 信用卡还款；非转账留空 |
| 7 | `merchant` | 否 | ≤200 字 | 商户名，已清理噪音；转账行一般留空（决策 §14.52 B16） |
| 8 | `note` | 否 | ≤500 字 | 这笔账的备注：外币原值、账单原文摘要、分不清时的疑问 |
| 9 | `category_l1` | 否 | §1.3 的一级 code | 拿不准**留空**，不硬猜（决策 §1.3） |
| 10 | `category_l2` | 否 | 该一级下的二级 code | 一级留空时必须也留空 |
| 11 | `source_ref` | 否 | ≤100 字 | 指回账单原文的位置，例如 `p2:14`（第 2 页第 14 行）或原始流水号；只作追溯，不进正式交易 |

**文件里没有的列**（有意没有）：`counterparty`（对手文本由用户在 review 里填，skill 不猜，决策 §14.16）、`flags`（服务端打的标记，§3）、`source_id` / 账户名（一份文件一个账户）、`confidence`（应用不做置信度）。多出任何一列都是表头不符 → 400。

### 1.3 转义规则（RFC 4180）

- 字段里含 `,`、`"`、换行时，整个字段用双引号包起来；字段内的 `"` 写成 `""`。
- 不含这三者时可以不加引号；加了也合法。
- 前后空格不会被自动去掉，服务端解析后统一 `strip()`。

```csv
2026-08-14,-88.50,CNY,expense,,,"星巴克（国贸店）","买了两杯，其中一杯是同事的",food,snacks_drinks,p1:12
2026-08-15,-42.00,CNY,expense,,,"某某书店","《设计的设计》，原文写作 ""设计的设计""",culture,books,p1:13
```

### 1.4 粘贴文本

应用内的粘贴框收的是**同样的 CSV 文本**（决策 §5、§14.47）：用户从聊天工具的代码块里整段复制过来，连 `# version:` 行一起。服务端 `read_paste()` 与 `read_upload()` 共用同一套切分与校验，唯一区别是没有文件名和字节数：

- 粘贴走 `POST /ledgers/{lid}/imports` 的 JSON 体 `{source_id, text}`，`import_batches.source_kind = 'paste'`，`original_filename` 为 NULL。
- 上传走 multipart，`source_kind = 'csv'`，记文件名与字节数（**不保存文件**，§4.11）。
- 文本前后的多余空行、聊天工具可能带上的 ``` 围栏行：服务端剥掉首尾的 ``` 行和空行后再切分，其余一概按上表判。

### 1.5 三个完整示例

**示例 A — 中文信用卡账单（CNY，含支出、退款、还款转入腿）**

```csv
# version: 2026-09-10
date,amount,currency,kind,transfer_role,transfer_subtype,merchant,note,category_l1,category_l2,source_ref
2026-08-03,-128.00,CNY,expense,,,盒马鲜生,,groceries,fresh_food,p1:5
2026-08-05,-45.00,CNY,expense,,,滴滴出行,,transport,taxi,p1:6
2026-08-07,-1299.00,CNY,expense,,,京东,"iPad 保护套 + 键盘，一单两件",shopping,electronics,p1:7
2026-08-09,-68.00,CNY,expense,,,"星巴克（国贸店）",,food,snacks_drinks,p1:8
2026-08-11,299.00,CNY,refund,,,京东,"退了键盘，原单 2026-08-07",shopping,electronics,p1:9
2026-08-12,-238.00,CNY,expense,,,淘宝,"淘宝，看不出买的什么",,,p1:10
2026-08-20,3000.00,CNY,transfer,in,repayment,,"信用卡还款，账单原文 自动还款",,,p1:11
```

看点：第 6 行 `淘宝` 分不清买的什么 → `category_l1` / `category_l2` **留空**，疑问写进 `note`（决策 §1.3）；最后一行是信用卡账单上的还款到账，`kind=transfer` + `role=in` + `subtype=repayment`，无商户、无分类（它的对腿在示例 B 里，是一笔 SGD 付款，跨币种 → 见示例 B 的看点）；退款行金额为**正**且分类沿用原支出。

**示例 B — 新加坡储蓄卡账单（SGD，含收入、外币消费、两种转账的转出腿）**

```csv
# version: 2026-09-10
date,amount,currency,kind,transfer_role,transfer_subtype,merchant,note,category_l1,category_l2,source_ref
2026-08-01,-1850.00,SGD,expense,,,"Propnex Realty","八月房租",housing,rent,p1:3
2026-08-02,-62.40,SGD,expense,,,"NTUC FairPrice",,groceries,fresh_food,p1:4
2026-08-06,-31.90,SGD,expense,,,"Grab","Grab 打车",transport,taxi,p1:5
2026-08-09,-184.20,SGD,expense,,,"Apple Store","原值 138.00 USD",shopping,electronics,p1:6
2026-08-15,6200.00,SGD,income,,,"ACME PTE LTD","八月工资",salary,base_salary,p1:7
2026-08-20,-560.00,SGD,transfer,out,repayment,,"还中国的信用卡，那边账单是 3000.00 CNY",,,p1:8
2026-08-22,-500.00,SGD,transfer,out,plain,,"转到另一张卡",,,p1:9
2026-08-25,-800.00,SGD,transfer,out,plain,,"转给老婆",,,p1:10
```

看点：外币消费按**记账币种**（账户结算的 SGD）写 `amount` / `currency`，原值 `138.00 USD` 写进 `note`（决策 §5）；第 6 行是**跨币种还款**（SGD 账户还 CNY 信用卡，与示例 A 最后一行是同一笔钱的两条腿）—— §3.3 只在**同币种同金额**时自动配对，跨币种两腿两边数字都对不上，导入后要在交易详情页用 `POST .../transactions/{tid}/pair` 手工配（决策 §1.2 允许两腿币种不同、金额不等）；最后两行都是 `plain`，一条是转到自己另一张卡（导入后可与那张卡上的入账配对），一条是转给别人（提交时留单腿 + `counterparty="老婆"`，对手文本由用户在 review 里填）。

**示例 C — 粘贴的支付宝导出片段（含引号、逗号与跨币种退款）**

```csv
# version: 2026-09-10
date,amount,currency,kind,transfer_role,transfer_subtype,merchant,note,category_l1,category_l2,source_ref
2026-09-01,-19.90,CNY,expense,,,"美团外卖","午饭，备注写着 ""少放辣""",food,lunch,20260901-0007
2026-09-01,-19.90,CNY,expense,,,"美团外卖","同一天点了两次",food,lunch,20260901-0019
2026-09-02,-6.00,CNY,expense,,,"北京地铁",,transport,public_transit,20260902-0002
2026-09-03,-899.00,CNY,expense,,,"Shopee","看不出品类",,,20260903-0011
2026-09-05,899.00,CNY,refund,,,"Shopee","整单退",,,20260905-0004
2026-09-06,200.00,CNY,income,,,"张三","还我上次垫的电影票",social_income,transfer_in,20260906-0001
```

看点：前两行**除 `source_ref` 外完全相同**（同一天点了两次外卖），是真实存在的重复消费；服务端不合并、都打 `needs_review` 并在 `hint` 里写"本批内有相同的行"（决策 §14.31），由用户在 review 里取舍。第 4/5 行的退款没有分类（原单也没有），提交前要补。最后一行是别人转入，skill 按决策 §1.2 的默认建议记成 `income` 而不是 `transfer` —— 真正的收入不该消失在统计之外。

---

## 2. 校验（服务端同步完成）

`POST .../imports` 在**一个请求内**跑完读文件 → 结构检查 → 版本检查 → 逐行归一化 → 自动标记 → 落库，秒级返回批次和全部草稿行。没有后台任务、没有轮询、没有进度。

### 2.1 校验顺序

```text
① 大小与限流    ≤2 MB              → 413 file_too_large
                每用户每小时 10 批   → 429 import_rate_limited
② 目标账户      属于本账本、未归档  → 404 not_found / 409 source_archived
③ 解码          UTF-8（可带 BOM）   → 400 import_file_invalid
④ 结构          版本行 / 表头 / 列数 → 400 import_file_invalid（逐行清单）
⑤ 版本          与 CATEGORY_VERSION  → 400 skill_outdated
⑥ 行数          ≤2000               → 400 rows_exceed_limit
⑦ 行级          逐条改正 + 写 hint   → 不丢行、不报错，进 review
⑧ 批内重复      不合并、都打标记     → 同上
⑨ 自动标记      §3 的四种            → 同上
──────────────────────────────────────────────
①–⑥ 任一不过：不建批次，什么都不写库
⑦–⑨ 一律成功：批次 status='ready'
```

①–⑥ 是**整份文件的通过条件**，⑦ 之后是**行级提示**。这个分界是决策 §5 的原话，也是屏幕稿要改的地方（`mockups/REVIEW-2026-09-11.md` B2）：kind 认不出、缺分类、日期格式错**不是**退回重传的理由，它们进 review 表格。

### 2.2 结构错误 → 400 `import_file_invalid`

四类结构错误，都不建批次，响应里带**逐行清单**，前端整份显示并提供"复制错误清单"（§4.10）：

| 情况 | `errors[].message` |
|---|---|
| 不是文本 / 编码不可读 | `文件不是 UTF-8 文本，请让 ChatGPT / Claude 重新导出为 UTF-8 的 CSV` |
| 缺 `# version:` 行 | `第 1 行必须是 "# version: YYYY-MM-DD"，当前是 "date,amount,..."` |
| 表头与 11 列固定表头不符 | `第 2 行表头不对：缺少 transfer_subtype；多出 counterparty` |
| 某行列数不对 | `第 14 行有 10 个字段，应为 11 个` |

```json
{
  "detail": "导入文件格式不正确，共 3 处问题",
  "code": "import_file_invalid",
  "errors": [
    {"line": 2, "message": "第 2 行表头不对：缺少 transfer_subtype；多出 counterparty"},
    {"line": 14, "message": "第 14 行有 10 个字段，应为 11 个"},
    {"line": 27, "message": "第 27 行有 12 个字段，应为 11 个"}
  ],
  "current_version": "2026-09-10"
}
```

表头比对的写法：切出的列名逐个 `strip()` 后与常量列表**逐位比对**，报告缺的、多的、以及顺序不对的第一处。不做模糊匹配、不接受别名 —— 决策 §14.42 明确不做向后兼容，列名对不上就是 skill 版本不对或用户手改坏了。

列数检查一次报全（最多列前 50 条，超出时 `detail` 里写"另有 N 处"），不要报第一处就返回：用户改一次就能全改对。

### 2.3 版本检查 → 400 `skill_outdated`

决策 §14.30：`CATEGORY_VERSION` 形如 `2026-09-10`；skill 输出的 `# version:` 必须与应用当前值**完全相等**。不一致或缺失一律 400，不允许带警告继续。

```json
{
  "detail": "你的导入 skill 是 2026-08-20 版，分类表已更新到 2026-09-10，请更新 skill 后重新整理账单",
  "code": "skill_outdated",
  "current_version": "2026-09-10",
  "file_version": "2026-08-20",
  "guide_url": "/import/guide"
}
```

- `file_version` 在缺行时为 `null`（此时 §2.2 的"缺版本行"先命中，走 `import_file_invalid`；只有版本行存在但值不对才走这里）。
- `guide_url` 指应用内的导入指南页（§5.5），页面上就是新版 skill 文本的复制 / 下载按钮。
- 上传前**不**显示"你的 skill 版本"（决策 §14.52 A18 前半：应用拿不到用户装的是哪一版，只能在上传后判）。

### 2.4 行级规则逐条

进入这一步的文件结构一定是对的，所以每行恰好 11 个字段。规则按执行顺序，**每一处改动都追加进该行的 `hint`**，不另存原始值（决策 §5、§14.19、§14.28）。

```python
def _add_hint(r: RowDraft, msg: str) -> None:
    """追加式写入，别覆盖：一行可能同时被日期、币种、标记三处写提示。"""
    r.hint = msg if not r.hint else f"{r.hint}；{msg}"
```

**① `date`**

```python
m = re.fullmatch(r"\d{4}-\d{2}-\d{2}", s)
d = date.fromisoformat(s) if m else None      # fromisoformat 还会挡掉 2026-02-30
```

| 情况 | 处理 | flags |
|---|---|---|
| 匹配 `YYYY-MM-DD` 且是真实日期 | 直接用 | — |
| 格式不对（`03/08/2025`、`8月3日`、空） | `occurred_at = NULL`，`hint` = `日期 "03/08/2025" 不是 YYYY-MM-DD，请填写` | `needs_review` |
| 早于 `2000-01-01` 或晚于**今天 + 1 天** | `occurred_at = NULL`，`hint` = `日期 2031-08-03 超出可记账范围，请填写` | `needs_review` |

置空而不是"保留原值"，是为了让这行在 §4.3 被 `batch_not_ready` 拦住 —— 交易表的日期上限是今天 + 1 天（决策 §14.44 03-13），带着越界日期进提交只会在事务里炸掉。服务端**不猜** DD/MM 还是 MM/DD：标准格式已经规定了 `YYYY-MM-DD`，猜错一次就是差一天的静默错误。

**② `amount`**

```python
def parse_amount(s: str) -> Decimal | None:
    s = s.strip().replace(",", "")            # 容忍千分位；符号符、货币符不容忍
    if not re.fullmatch(r"[+-]?\d+(\.\d{1,4})?", s):
        return None
    return Decimal(s).quantize(Decimal("0.0001"))
```

| 情况 | 处理 | flags |
|---|---|---|
| 能解析且非 0 | 直接用 | — |
| 非数字（含带 `¥`、`$`、`(123)`、`1234.56 DR`） | `amount = 0`，`hint` = `金额 "¥128.00" 不是数字，请填写` | `needs_review` |
| 恰好为 `0` | 保留 0，`hint` = `金额为 0，请确认或跳过` | `needs_review` |
| `abs(amount) > 100000000` | 保留，`hint` = `金额异常大，请核对` | `needs_review` |
| 小数超过 4 位 | 视为格式不对，同"非数字" | `needs_review` |

不容忍货币符号与会计括号是**有意的**：那些是账单原文的形态，把它们转成规范数字正是 skill 的活（§5.2 的规则 2）。应用这边一容忍，skill 那边就会退化。

**③ `currency`**

| 情况 | 处理 | flags |
|---|---|---|
| 匹配 `^[A-Z]{3}$` | 直接用（不校验是不是真实货币 —— 换算时拿不到汇率会另行提示） | — |
| 不匹配（空、`人民币`、`rmb`、`CNY￥`） | 用**目标账户的 `default_currency`**，`hint` = `币种 "rmb" 无效，已改为账户币种 CNY` | `needs_review` |

小写三字母先 `upper()` 再判，`cny` 不算错。

**④ `kind`**

| 情况 | 处理 | flags |
|---|---|---|
| 在 `expense` / `income` / `refund` / `transfer` 内 | 直接用 | — |
| 不在（空、`支出`、`payment`） | 按金额符号推断：`amount < 0` → `expense`，否则 `income`，`hint` = `kind "payment" 无法识别，已按金额符号记为 expense` | `needs_review` |

**⑤ 符号与 `kind` 一致性**（决策 §10 的 CHECK 要求，不改正就会在提交时整批失败）

```python
def reconcile_sign(kind, amount, transfer_role) -> tuple[Decimal, bool]:
    a, changed = amount, False
    if kind == "expense" and a > 0:               a, changed = -a, True
    elif kind in ("income", "refund") and a < 0:  a, changed = -a, True
    elif kind == "transfer":
        if transfer_role == "out" and a > 0:      a, changed = -a, True
        if transfer_role == "in"  and a < 0:      a, changed = -a, True
    return a, changed
```

以 `kind` 为准翻符号，`hint` = `kind 是 expense 但金额是正数，已改为 -32.00`，打 `needs_review`。

**⑥ `transfer_role` / `transfer_subtype`**（决策 §10 的两条等价约束）

| 情况 | 处理 | flags |
|---|---|---|
| `kind='transfer'`，`role` 为空 | 按符号补：`amount < 0` → `out`，否则 `in`，`hint` 记一笔 | `needs_review` |
| `kind='transfer'`，`role` 不在 `out` / `in` | 同上 | `needs_review` |
| `kind='transfer'`，`subtype` 为空且账户是 `credit` 且 `role='in'` | 补 `repayment`（信用卡上的转入几乎只有还款） | — |
| `kind='transfer'`，`subtype` 仍为空或非法 | 补 `plain`，`hint` = `转账子类型为空，已按普通划转处理` | `needs_review` |
| `kind != 'transfer'` 但填了 `role` / `subtype` | 两列一律置 `NULL`，`hint` 记一笔 | — |

**⑦ 分类 code**（决策 §5：不在表内、二级不属于一级、收支方向与 kind 不符 → 对应字段置空）

```python
def sanitize_category(kind, l1, l2) -> tuple[str | None, str | None, str | None]:
    """返回 (l1, l2, hint)。hint 为 None 表示没改过。"""
    if kind == "transfer":
        if l1 or l2:
            return None, None, "转账不记分类，已清空"
        return None, None, None
    group = EXPENSE_INDEX if kind in ("expense", "refund") else INCOME_INDEX
    if not l1:
        return None, None, None                       # 主动留空，不算错（待归类）
    if l1 not in group:
        return None, None, f'分类 "{l1}" 不在{"支出" if group is EXPENSE_INDEX else "收入"}分类表里，已清空待归类'
    if l2 and l2 not in group[l1].children_codes:
        return l1, None, f'二级分类 "{l2}" 不属于 "{l1}"，已清空'
    return l1, l2, None
```

| 情况 | 结果 | flags |
|---|---|---|
| `category_l1` 留空 | 保持空（review 里显示"待归类"，提交时才拦） | 不打 |
| `category_l1` 不在表内（skill 编了 code，例如 `dining`） | 一级二级都置空 | 不打 |
| 收支组不匹配（`kind='income'` 却给了 `food`） | 一级二级都置空 | 不打 |
| `category_l2` 不属于该一级（`food` + `taxi`） | 只清二级 | 不打 |
| 转账行带了分类 | 都置空 | 不打 |

**这四种情况不打 `needs_review`**：决策 §5 列出的 `needs_review` 只有日期、金额、币种、kind 四处，分类问题一律落在"待归类"上 —— review 表格的筛选器有独立的"待归类"档（§4.2），提交时有 `rows_uncategorized` 硬拦（§4.3），再打一个 `needs_review` 只会让"有标记"筛选变成噪音。

**⑧ 文本字段**

- `merchant` 截到 200 字、`note` 截到 500 字、`source_ref` 截到 100 字，截断时 `hint` 记一笔。
- `merchant` / `note` 过卡号脱敏（§6.2）。
- 全部 `strip()`；空串统一存 `NULL`。

### 2.5 `hint` 的写法

`hint` 落 `import_rows.hint VARCHAR(200) NULL`（决策 §14.19，列见 [`02-database.md`](./02-database.md)），由 `GET .../rows` 带给前端，在 review 表格里显示成该行的提示条。三条规矩：

1. **写人话，写清楚改成了什么**：`币种 "rmb" 无效，已改为账户币种 CNY`，不是 `invalid currency`。
2. **它不拼进 `note`**：`note` 会原样进 `transactions.note`（§4.4），把校验提示带进正式交易备注是污染。
3. **追加不覆盖**：一行可能同时被 §2.4 的多条规则和 §3 的标记写提示，用 `_add_hint()`，超过 200 字时截断并以 `…` 结尾。

### 2.6 上限

| 限制 | 值 | 超出 |
|---|---|---|
| 文件大小 | 2 MB | 413 `file_too_large`（决策 §5、§9） |
| 数据行数 | 2000 | 400 `rows_exceed_limit`，`detail` = `文件有 2431 行，超过单批 2000 行上限，请拆成多份` |
| 频次 | 每用户每小时 10 批 | 429 `import_rate_limited`（决策 §5） |

行数以**数据行**计（不含版本行与表头），含后来会被用户跳过的行。不截断 —— 截断后用户不知道丢了哪些。

### 2.7 批内重复行不合并（决策 §14.31）

11 个字段**完全相同**的多行：全部保留，**都**打 `needs_review`，`hint` 写 `本批内有相同的行（第 5、9 行）`，由用户在 review 里取舍。

```python
def flag_intra_batch_duplicates(rows: list[RowDraft]) -> None:
    groups: dict[tuple, list[RowDraft]] = defaultdict(list)
    for r in rows:
        groups[(r.occurred_at, r.amount, r.currency, r.kind, r.transfer_role,
                r.transfer_subtype, r.merchant, r.note,
                r.category_l1, r.category_l2, r.source_ref)].append(r)
    for same in groups.values():
        if len(same) < 2:
            continue
        nos = "、".join(str(x.row_no) for x in same)
        for r in same:
            r.flags.add("needs_review")
            _add_hint(r, f"本批内有相同的行（第 {nos} 行）")
```

不合并的理由：同一天同一家店买两杯一样的咖啡是真实存在的，合并就是静默丢账。`source_ref` 通常能区分（示例 C 的前两行），只有 skill 把同一行输出两次时才会 11 列全同 —— 那种情况下让人看一眼比替他猜要好。**标记只有四种，没有第五种**（决策 §14.31）。

### 2.8 规则速查表

| # | 规则 | 不满足时 | `needs_review` |
|---|---|---|---|
| 1 | 文件是 UTF-8 文本 | 400 `import_file_invalid` | — |
| 2 | 首行是 `# version:` | 400 `import_file_invalid` | — |
| 3 | 第二行是 11 列固定表头 | 400 `import_file_invalid` | — |
| 4 | 每行恰好 11 个字段 | 400 `import_file_invalid`（逐行） | — |
| 5 | `version` == `CATEGORY_VERSION` | 400 `skill_outdated` | — |
| 6 | 数据行 ≤2000 | 400 `rows_exceed_limit` | — |
| 7 | `date` 是合法 `YYYY-MM-DD` | 置空 | 是 |
| 8 | `date` ∈ [2000-01-01, 今天+1 天] | 置空 | 是 |
| 9 | `amount` 能解析 | 置 0 | 是 |
| 10 | `amount != 0` | 保留 0 | 是 |
| 11 | `abs(amount) <= 1e8` | 保留 | 是 |
| 12 | `currency` 匹配 `^[A-Z]{3}$` | 用账户币种 | 是 |
| 13 | `kind` ∈ 四种 | 按符号推断 | 是 |
| 14 | 符号与 `kind` 一致 | 按 `kind` 翻符号 | 是 |
| 15 | 转账有 `role` | 按符号补 | 是 |
| 16 | 转账有合法 `subtype` | credit+in 补 `repayment`，否则补 `plain` | 补 `plain` 时是 |
| 17 | 非转账无 `role` / `subtype` | 置空 | 否 |
| 18 | `category_l1` 在对应收支组内 | 一二级都置空（待归类） | 否 |
| 19 | `category_l2` 属于该一级 | 只清二级 | 否 |
| 20 | 转账无分类 | 置空 | 否 |
| 21 | 文本字段不超长 | 截断 | 否 |
| 22 | `merchant` / `note` 无完整卡号 | 打码保留末 4 位（§6.2） | 否 |
| 23 | 批内无 11 列全同的行 | 全保留、全打标 | 是 |

---

## 3. 自动标记

`flag_rows(db, ctx, rows)` 在批次落 `ready` 之前跑一次（决策 §5）。**只有四种标记**（决策 §14.31）：`duplicate`、`refund_candidate`、`transfer_candidate`、`needs_review`。四种互不排斥，一行可以同时是 `duplicate` 和 `needs_review`。全部写进 `import_rows.flags`（排序后的 JSON 数组，方便测试断言）。

调用顺序是固定的：

```python
def flag_rows(db, ctx, rows):
    flag_duplicates(db, ctx, rows)            # 1. 撞库找同账户同日同额
    flag_transfer_candidates(db, ctx, rows)   # 2. 先把转账腿摘走
    flag_refund_candidates(db, ctx, rows)     # 3. 剩下的正数入账才当退款候选
```

- `flag_transfer_candidates` 在 `flag_refund_candidates` 之前：后者的触发条件之一是"信用卡账户上的正数入账"，还款转入腿也满足，先摘走才不会被当成退款候选。
- `flag_refund_candidates` 在 `flag_duplicates` 之后：两者都可能写 `matched_transaction_id`，后跑的**有意**覆盖 —— 退款原单比"同日同额的已有交易"更有用。为此 §3.2 在查候选前**无条件清空** `matched_transaction_id`（理由见该节）。

三种带库查询的标记都必须用 SQLAlchemy Core 表达式实现（`col.in_()`、`between()` + Python 侧算日期偏移），本章给的 SQL 只为说清逻辑 —— 测试跑在 SQLite 上（§7），`ANY(:array)` 和 `INTERVAL` 在那里不可用。

### 3.1 duplicate

判据（决策 §5："同账户同日同金额已存在"）：同账本、**同账户**、同 `occurred_at`、同 `amount`（含符号）、同 `currency` 的交易已存在。

```sql
-- 整批只跑一次：把本批所有日期和币种一次性拿去撞库
SELECT t.id, t.occurred_at, t.amount, t.currency, t.merchant
FROM transactions t
WHERE t.ledger_id   = :ledger_id
  AND t.source_id   = :source_id
  AND t.occurred_at = ANY(:dates)
  AND t.currency    = ANY(:currencies);
```

```python
def flag_duplicates(db, ctx, rows):
    dates = sorted({r.occurred_at for r in rows if r.occurred_at})
    curs  = sorted({r.currency for r in rows})
    if not dates:
        return
    existing = db.execute(_DUP_STMT, {"ledger_id": ctx.ledger_id,
                                      "source_id": ctx.source_id,
                                      "dates": dates, "currencies": curs}).all()
    index = defaultdict(list)
    for t in existing:
        index[(t.occurred_at, t.amount, t.currency)].append(t)
    for r in rows:
        hits = index.get((r.occurred_at, r.amount, r.currency), [])
        if hits:
            r.flags.add("duplicate")
            if len(hits) == 1:
                r.matched_transaction_id = hits[0].id
            _add_hint(r, f"账户里已有 {len(hits)} 笔同日同额交易")
```

一次查询搞定整批，不要在循环里查库（2000 行 × 一次查询 = 2000 次往返）。这里的 `matched_transaction_id` 只在唯一命中时预填，作用是让 review 能一键跳去看那笔已有交易；用户的默认动作是把本行标 `skipped`。

### 3.2 refund_candidate

触发条件（决策 §5、§1.1）：`kind = 'refund'`，**或者** `amount > 0` 且目标账户 `type = 'credit'`（信用卡上的正数入账绝大多数是退款或还款；还款已被 §3.3 接走）。

候选池（全部是硬条件）：

| 条件 | 说明 |
|---|---|
| 同账本、**同账户** | 退款一定退回原支付账户 |
| `kind = 'expense'` | 决策 §1.1：`refund_of` 只能指向支出 |
| `occurred_at ∈ [退款日 − 90 天, 退款日]` | 决策 §1.1、§14.33 的"最近 90 天"；不允许晚于退款日 |
| **同币种** | 跨币种退款不自动匹配 |
| `abs(amount) >= 退款额` | 退款不能超过原单 |
| **可退额度 > 0** | 原单金额 − 已关联退款合计 > 0（部分退款，决策 §1.1） |

打分（只用于在候选里排序，不改变硬条件）：

```text
score = 0
if abs(cand.amount) == refund.amount:                             score += 100  # 金额完全相等
elif abs(cand.amount) - already_refunded == refund.amount:        score +=  80  # 恰好退完剩余
if cand.merchant and refund.merchant and _merch_eq(cand, refund): score +=  20
score += max(0, 30 - days_between(cand.occurred_at, refund.date) // 3)          # 越近越高
```

`_merch_eq`：两边都 `NFKC` 归一 + 转小写 + 去空格与标点后，**一方包含另一方**即算相同（"星巴克" ⊂ "星巴克咖啡"）。商户**只加分、不作硬条件**（决策 §5 明确要求）：退款行的商户名常常和消费行不一样（走的是收单机构名）。

```sql
-- :rdate 退款日期   :ramt 退款金额（正数）   :cur 币种
SELECT t.id, t.occurred_at, t.amount, t.merchant, t.category_l1, t.category_l2,
       COALESCE(SUM(rf.amount), 0) AS refunded
FROM transactions t
LEFT JOIN transactions rf
       ON rf.refund_of = t.id AND rf.kind = 'refund'
WHERE t.ledger_id   = :ledger_id
  AND t.source_id   = :source_id
  AND t.kind        = 'expense'
  AND t.currency    = :cur
  AND t.occurred_at BETWEEN (:rdate - INTERVAL '90 days') AND :rdate
  AND ABS(t.amount) >= :ramt
GROUP BY t.id, t.occurred_at, t.amount, t.merchant, t.category_l1, t.category_l2
HAVING ABS(MIN(t.amount)) - COALESCE(SUM(rf.amount), 0) > 0
ORDER BY (CASE WHEN ABS(t.amount) = :ramt THEN 0 ELSE 1 END), t.occurred_at DESC, t.id
LIMIT 200;
```

`LIMIT` 只是防极端情况把整个账户拉进内存，不是"取最近 200 笔"的业务规则；排序保证**金额完全相等的候选一定落在截断窗口内**（它在打分里权重最高），否则"唯一候选才预填"的判定会静默失准。

```python
UNIQUE_MARGIN = 20

def flag_refund_candidates(db, ctx, rows):
    for r in rows:
        if r.occurred_at is None or r.kind == "transfer":
            continue
        if not (r.kind == "refund" or (r.amount > 0 and ctx.source_type == "credit")):
            continue
        # 进入退款判定的行，先清掉 §3.1 可能预填的 duplicate 目标：那是"同日同额的已有
        # 交易"，语义上不是"退款原单"，留着会被 §4.4 写进 refund_of（可能指向一笔非
        # expense 交易，违反决策 §1.1）。清空必须在查候选之前，否则 `if not cands`
        # 直接 continue 就漏掉了。
        r.matched_transaction_id = None
        cands = db.execute(_REFUND_STMT, {...}).all()
        if not cands:
            continue
        scored = sorted(((score(c, r), c) for c in cands), key=lambda x: -x[0])
        r.flags.add("refund_candidate")
        r.candidate_ids = [c.id for _, c in scored[:10]]     # 给界面用，不落列
        if len(scored) == 1 or scored[0][0] - scored[1][0] >= UNIQUE_MARGIN:
            best = scored[0][1]
            r.matched_transaction_id = best.id               # 唯一候选才预填（决策 §5）
            if r.kind != "refund":
                r.kind = "refund"
                r.flags.add("needs_review")                  # 服务端改过 kind，请用户过目
            # kind 可能刚被改过，分类必须按新 kind 重跑 §2.4 ⑦
            r.category_l1, r.category_l2, _ = sanitize_category(
                "refund", r.category_l1, r.category_l2)
            if r.category_l1 is None:                        # 决策 §1.1：沿用原单分类
                r.category_l1, r.category_l2 = best.category_l1, best.category_l2
            _add_hint(r, f"已关联 {best.occurred_at} 的原支出，可改选")
        else:
            r.flags.add("needs_review")
            _add_hint(r, f"找到 {len(scored)} 笔可能的原支出，请选一笔")
```

把 `kind` 改成 `refund` 之后**必须**重跑 `sanitize_category`，不能只在 `category_l1 is None` 时才覆盖：skill 若原本把这行判成收入并给了收入分类，直接改 `kind` 会留下 `kind='refund'` + 收入分类的非法组合（决策 §1.3 规定退款只能用支出分类）。

候选列表（`candidate_ids`）不占 `import_rows` 的列，也**不单独建接口**（决策 §14.11）：review 的「关联原单」选择器直接复用 `GET /ledgers/{lid}/transactions` —— `kind='expense'` 的行自带 `refunded_total` / `refundable`，按同账户 + 日期窗口筛就是上表的候选池，与记账表单用的是同一个选择器。

### 3.3 transfer_candidate（决策 §14.34）

触发条件：`kind = 'transfer'` 且 `occurred_at` 非空。判据是决策 §14.34 的原话 —— **其他账户上 ±3 天、同币种、同金额、方向相反、仍为单腿的转账**：

| 硬条件 | 说明 |
|---|---|
| 同账本、`source_id <> :source_id` | 必须是别的账户；同账户上的对腿不成立 |
| `kind = 'transfer'` | |
| `transfer_role = :opp` | 本行 `in` → 找 `out`，反之亦然 |
| `currency = :cur` | 同币种（跨币种两腿不自动配，用户可在交易详情里手工配） |
| `amount = -(:amt)` | 反向等额 |
| `occurred_at ∈ [本行日期 − 3 天, 本行日期 + 3 天]` | |

```sql
-- :d 本行日期   :amt 本行金额（带符号）   :cur 币种   :opp 反向 role   :sub 本行 subtype
SELECT t.id, t.source_id, t.occurred_at, t.transfer_pair_id, t.transfer_subtype
FROM transactions t
WHERE t.ledger_id     = :ledger_id
  AND t.source_id    <> :source_id
  AND t.kind          = 'transfer'
  AND t.transfer_role = :opp
  AND t.currency      = :cur
  AND t.amount        = -(:amt)
  AND t.occurred_at BETWEEN (:d - INTERVAL '3 days') AND (:d + INTERVAL '3 days')
ORDER BY (CASE WHEN t.transfer_subtype = :sub THEN 0 ELSE 1 END),
         ABS(t.occurred_at - :d), t.id
LIMIT 10;
```

`transfer_subtype` **不是**硬条件，只参与排序：储蓄卡账单上写 `plain`、信用卡账单上写 `repayment` 的同一笔还款很常见，硬卡 subtype 会让配对永远不触发。

```python
def flag_transfer_candidates(db, ctx, rows):
    for r in rows:
        if r.kind != "transfer" or r.occurred_at is None:
            continue
        opp = "out" if r.transfer_role == "in" else "in"
        # 与 §3.2 对称：先清掉 §3.1 可能预填的 duplicate 目标。那是"同账户同日同额的
        # 已有交易"，语义上不是"对腿"（对腿必须在别的账户上），留着会被 §4.4 / §4.5
        # 当成配对目标，commit 时必然 400 pair_target_invalid 并整批被拒。下面四个分支
        # 只有"唯一单腿候选"那支才重新写这个字段。
        r.matched_transaction_id = None
        legs = db.execute(_PAIR_STMT, {..., "opp": opp, "sub": r.transfer_subtype}).all()
        single = [x for x in legs if x.transfer_pair_id is None]
        paired = [x for x in legs if x.transfer_pair_id is not None]

        if len(single) == 1:
            r.flags.add("transfer_candidate")
            r.matched_transaction_id = single[0].id          # 唯一候选：预填（决策 §14.34）
            r.counterpart_source_id = single[0].source_id
            _add_hint(r, "已勾选：与另一个账户上的那条转账合并为一笔，可取消")
        elif len(single) > 1:
            r.flags.add("transfer_candidate")
            r.flags.add("needs_review")
            r.candidate_ids = [x.id for x in single]         # 多候选：列出让用户选
            _add_hint(r, f"找到 {len(single)} 条可以配对的转账，请选一条")
        elif paired:
            # 对方已经是两腿转账的一半 → 这一行多半是同一笔的重复导入（决策 §14.34）
            r.flags.add("duplicate")
            _add_hint(r, "另一个账户上这笔转账已经配好对了，本行可能是重复的")
        else:
            # 库里没有对腿：提交时按单腿建，counterparty 由用户填（决策 §1.2）
            r.counterpart_source_id = _guess_counterpart(db, ctx, r)
            _add_hint(r, "没找到对腿；对方账户在应用里就选一个，不在就填对方名字或留空")

def _guess_counterpart(db, ctx, r) -> UUID | None:
    """只在 subtype='repayment' 且账本里恰好只有一个未归档 checking 账户时预填它
    （绝大多数人只有一张主力储蓄卡）。其余情况返回 None，让用户自己选。"""
```

三条要点：

1. **唯一候选默认勾选**（决策 §14.34）：`matched_transaction_id` 预填 + `counterpart_source_id` 记下对方账户，review 表格把这行显示成「☑ 关联为一笔转账 · 招行储蓄卡 08-20」，用户可取消勾选。
2. **多候选不预填**：`candidate_ids` 给界面做下拉，`needs_review` 让它出现在"有标记"筛选里。
3. **对方已配对 → `duplicate`**：不是 `transfer_candidate`。一条已经有 `transfer_pair_id` 的交易不能再被配走（`UNIQUE (transfer_pair_id, transfer_role)`，决策 §10），此时本行的正确处理是跳过。

配对不是一锤子买卖：决策 §14.34 明确两种关联（退款 `refund_of`、转账配对）在导入之后都可以在交易详情页修改或解除（`POST .../transactions/{tid}/pair` 与 `POST .../transactions/transfer/{pair_id}/unpair`），review 里的自动建议只是预填。

### 3.4 needs_review

不是独立算法，是前面所有环节的汇总标记。打上它的地方一共这些：

| 来源 | 小节 |
|---|---|
| 日期、金额、币种、kind 被服务端改动或置空 | §2.4 ①–⑤ |
| 转账缺 `role` / 被补成 `plain` | §2.4 ⑥ |
| 批内有 11 列全同的行 | §2.7 |
| 退款候选不唯一 | §3.2 |
| 服务端把 kind 改成了 `refund` | §3.2 |
| 转账可配对的候选不唯一 | §3.3 |

**不打**它的地方（有意）：分类留空或被清空（那是"待归类"，有独立筛选与 `rows_uncategorized` 硬拦）、`duplicate`（那是独立标记）、唯一候选的退款 / 转账预填（预填就是替用户省事，再要求他"过目"就白省了）。

### 3.5 四种标记对照

| flag | 触发 | 硬条件 | 预填 | review 里的默认动作 |
|---|---|---|---|---|
| `duplicate` | 撞库 / 对腿已配对 | 同账户 + 同日 + 同额 + 同币种；或 §3.3 的对腿已有 pair | 唯一命中时 `matched_transaction_id` | 标 `skipped` |
| `refund_candidate` | `kind=refund` 或 信用卡正数入账 | 同账户 + 同币种 + `kind=expense` + 90 天内 + 金额足够 + 有可退额度；商户只加分 | 唯一候选时 `matched_transaction_id` + 沿用原单分类 | 确认或改选原单 |
| `transfer_candidate` | `kind=transfer` | 别的账户 + ±3 天 + 同币种 + 反向等额 + **仍是单腿** | 唯一候选时 `matched_transaction_id` + `counterpart_source_id` | 保持勾选（合并成一笔） |
| `needs_review` | §3.4 的六处 | — | — | 看一眼，改或不改 |

---

## 4. review 与提交

### 4.1 改草稿行

**单行**：`PATCH /ledgers/{lid}/imports/{bid}/rows/{rid}`，可改字段：

| 字段 | 说明 |
|---|---|
| `date` | `YYYY-MM-DD`，写进 `import_rows.occurred_at` |
| `amount` / `currency` | 改完仍按 §2.4 ⑤ 校验符号与 kind 一致性 |
| `kind` | 四种之间随便改（草稿行没有决策 §14.3 的"transfer 不可互改"限制 —— 那是正式交易的规矩，草稿改的是还没发生的事）；改完重跑分类校验 |
| `transfer_role` / `transfer_subtype` | 仅 `kind='transfer'` 时可填，否则置空 |
| `merchant` / `note` / `source_ref` | 文本，长度上限同 §2.4 ⑧ |
| `category_l1` / `category_l2` | 必须在表内且收支组匹配，否则 400 `category_invalid` / `category_kind_mismatch` |
| `matched_transaction_id` | 退款原单（`kind='refund'` 时）或配对目标（`kind='transfer'` 时）；置 `null` = 取消关联 |
| `counterpart_source_id` | 转账的对手账户（对方在应用里、但对腿还没记过账时用，提交时会**新建**对腿） |
| `counterparty` | 单腿转账的对手文本，例如"老婆""工资卡"（决策 §14.10、§14.16：只有用户填，skill 不猜） |
| `status` | `pending` / `edited` / `skipped`，三个值，没有第四个（决策 §5） |

服务端在任何一次 PATCH 之后把 `status` 置为 `edited`（用户显式标跳过时置 `skipped`），并按 §2.4 重跑该行的校验；`hint` 由服务端重写（原来的校验提示如果已经被用户改掉就该消失）。批次不是 `ready` 时一律 409 `batch_not_ready`。请求体带客户端看到的 `updated_at`，不一致 409 `stale_update`（决策 §2）。

**批量**：`PATCH /ledgers/{lid}/imports/{bid}/rows`（决策 §14.52 A4），一次给一批行打同一份改动：

```json
{
  "row_ids": ["...", "...", "..."],
  "patch": {"category_l1": "food", "category_l2": "lunch"}
}
```

```json
{"updated": 12, "items": [ /* 改完的行，与 GET .../rows 同形 */ ]}
```

- `patch` 的可改字段与单行相同，但**不接受** `matched_transaction_id` / `counterpart_source_id` / `counterparty` —— 那三个是逐行的关联，批量套用没有意义且危险。
- 界面上的两个用法就是决策点名的两个：**批量设分类**、**批量跳过**（`{"status": "skipped"}`）。
- 一个事务，全成或全不成；任一行校验不过返回 400 并带 `rows: [row_no, ...]`。
- 批量端点不做乐观锁（列表里一次选十几行，逐行比对 `updated_at` 只会让用户反复失败）；它改的是自己刚拉到的这一批草稿，冲突风险由"批次是 `ready` 且属于本账本"兜住。

### 4.2 review 内筛选

`GET .../rows?filter=` 三档（决策 §14.52 A4），前端是三个 chip，计数写在 chip 上：

| filter | 判据 |
|---|---|
| `all`（默认） | 全部行 |
| `uncategorized` | `status != 'skipped'` 且 `kind != 'transfer'` 且 `category_l1 IS NULL` —— 也就是提交时会被 `rows_uncategorized` 拦下的那些 |
| `flagged` | `flags` 非空（四种标记任意一种） |

筛选只影响返回的行，不影响提交（提交永远按整批算）。`limit` 上限 500（决策 §14.44 03-14）。

### 4.3 提交前置校验

`POST /ledgers/{lid}/imports/{bid}/commit` 在开事务前逐条检查，任一不过则整体拒绝、不写任何数据；错误响应带 `rows: [row_no, ...]`，前端把有问题的行滚到视野里。

| 检查 | HTTP | code |
|---|---|---|
| 批次 `status = 'ready'` | 409 | `batch_not_ready` |
| 批次已经是 `committed`（幂等保护，含并发双提交） | 409 | `batch_already_committed` |
| 至少有一条非 `skipped` 的行 | 409 | `rows_all_skipped` |
| 所有非 `skipped` 行 `occurred_at` / `amount` / `currency` / `kind` 非空且 `amount != 0` | 409 | `batch_not_ready` |
| 所有非 `skipped`、非 transfer 行 `category_l1 IS NOT NULL` | 409 | `rows_uncategorized` |
| 分类的收支组与 `kind` 匹配 | 400 | `category_kind_mismatch` |
| `category_l2` 属于该 `category_l1`；transfer 行两级都为 NULL | 400 | `category_invalid` |
| `kind='refund'` 且 `matched_transaction_id` 非空时，该目标仍是同账本的 `kind='expense'` 交易 | 400 | `refund_target_invalid` |
| `kind='transfer'` 且 `matched_transaction_id` 非空时，该目标仍是同账本、方向相反、同币种反向等额的转账 | 400 | `pair_target_invalid` |
| 上一条的目标在此刻仍是**单腿**（`transfer_pair_id IS NULL`） | 409 | `already_paired` |
| 目标账户、以及任何 `counterpart_source_id` 仍未归档 | 409 | `source_archived` |

`POST .../commit` **没有请求体**，也不做乐观锁（决策 §14.18）：重复提交靠 `batch_already_committed` 保护。

两条**不**拦的：`needs_review` 行照样能提交（标记是提示不是闸）；`kind='transfer'` 且 `matched_transaction_id`、`counterpart_source_id` 都为空的行照样能提交 —— 那就是"对方不在应用里"的单腿转账（决策 §1.2）。

### 4.4 字段映射

`import_rows` → `transactions`（表结构见 [`02-database.md`](./02-database.md)）：

| import_rows | transactions | 说明 |
|---|---|---|
| — | `id` | 服务端新生成 UUID |
| batch.`ledger_id` | `ledger_id` | |
| batch.`source_id` | `source_id` | 一份文件一个目标账户（决策 §5） |
| `occurred_at` | `occurred_at` | `DATE`，无时间无时区（决策 §14.32） |
| `amount` | `amount` | `NUMERIC(18,4)`，符号已在 §2.4 ⑤ 校正 |
| `currency` | `currency` | |
| `kind` | `kind` | |
| `transfer_role` / `transfer_subtype` | 同名 | 非 transfer 为 NULL |
| — | `transfer_pair_id` | 只有配对或新建对腿时才有值，见 §4.5 |
| `counterparty` | `counterparty` | 只有单腿转账写；有 `transfer_pair_id` 的行必须为 NULL（决策 §10） |
| `merchant` | `merchant` | ≤200；转账行一般为空（决策 §14.52 B16） |
| `note` | `note` | ≤500，卡号已脱敏（§6.2） |
| `category_l1` / `category_l2` | 同名 | transfer 为 NULL |
| `matched_transaction_id`（**两个**条件同时成立才写：`kind = 'refund'` 且该列非空） | `refund_of` | 决策 §14.7 的原话：不论是服务端预填还是用户改选，都写 `refund_of`，**不引入"用户已确认"这类额外状态**。不需要再看 `flags`：§3.2 在查候选前已无条件清空过这一列，所以留在退款行上的值只可能来自退款候选或用户改选 |
| `matched_transaction_id`（`kind = 'transfer'` 时） | — | 不进 `refund_of`，走 §4.5 的配对 |
| batch.`id` | `import_batch_id` | 撤销靠它 |
| batch.`created_by` | `created_by`、`updated_by` | 上传人（决策 §2） |
| — | `created_at` / `updated_at` | `now()`，naive UTC（决策 §14.26） |
| — | ← `import_rows.transaction_id` | 回写，供撤销与追溯 |

`row_no`、`source_ref`、`flags`、`hint`、`status` **不进** `transactions`：它们是草稿的元数据，留在 `import_rows` 里可追溯。

### 4.5 转账的三种落地方式

一条 `kind='transfer'` 的草稿行，按用户在 review 里做的选择，有三条不同的写法：

```text
① matched_transaction_id 非空（与库里已有的单腿配对，决策 §14.34）
   ┌──────────────────────────┐        ┌──────────────────────────┐
   │ 已有交易（储蓄卡）        │        │ 新建交易（信用卡，本行）  │
   │ 08-20  −3000 SGD  out    │        │ 08-20  +3000 SGD  in     │
   │ transfer_pair_id = NULL  │        │ transfer_pair_id = NULL  │
   │ counterparty = "招行"     │        │                          │
   └───────────┬──────────────┘        └───────────┬──────────────┘
               │       两条一起写上同一个新 pair_id  │
               └──────────────┬─────────────────────┘
                              ↓
                 已有那条：transfer_pair_id = <新 pair_id>
                           counterparty    = NULL     ← 必须清空（决策 §10、§14.34）
                           updated_by / updated_at 更新
                 新建那条：transfer_pair_id = <同一个 pair_id>
                           counterparty    = NULL

② counterpart_source_id 非空、matched_transaction_id 为空（对方账户在应用里，但对腿没记过）
   → 建两条交易，共享一个新 pair_id，counterparty 两边都为 NULL

③ 两个都为空
   → 只建本账户这一条，transfer_pair_id = NULL，counterparty = 用户填的文本（可为空）
```

```python
def commit_transfer(db, row, batch, ctx, events, actor_id, client) -> list[Transaction]:
    near = _build(row, batch, ctx)                       # 本账户这一腿，字段按 §4.4

    # ① 与库里已有的单腿配对
    if row.matched_transaction_id is not None:
        far = db.get(Transaction, row.matched_transaction_id, with_for_update=True)
        _assert_pairable(far, near)                      # §4.3 的 pair_target_invalid /
                                                         # already_paired 在这里再确认一次
        old_cp = far.counterparty                        # 先存原值，事件要记 before
        pair_id = uuid4()
        near.transfer_pair_id = pair_id
        near.counterparty = None
        far.transfer_pair_id = pair_id
        far.counterparty = None                          # 决策 §14.34：清空对方的对手文本
        far.updated_by, far.updated_at = actor_id, utcnow()
        events.append(_event(far, "paired", batch, actor_id, client,
                             {"transfer_pair_id": {"before": None, "after": str(pair_id)},
                              "counterparty": {"before": old_cp, "after": None}}))
        return [near]                                    # 只新增一条，另一条是改已有的

    # ② 对方账户在应用里，但对腿还没记过 → 两腿一起建
    if row.counterpart_source_id is not None:
        pair_id = uuid4()
        near.transfer_pair_id, near.counterparty = pair_id, None
        far = Transaction(
            ledger_id=batch.ledger_id, source_id=row.counterpart_source_id,
            occurred_at=row.occurred_at, amount=-row.amount, currency=row.currency,
            kind="transfer",
            transfer_role="out" if row.transfer_role == "in" else "in",
            transfer_subtype=row.transfer_subtype,       # 两腿 subtype 必须一致
            transfer_pair_id=pair_id, counterparty=None,
            merchant=None, note=row.note, category_l1=None, category_l2=None,
            import_batch_id=batch.id,
            created_by=actor_id, updated_by=actor_id)
        return [near, far]

    # ③ 单腿
    near.transfer_pair_id = None
    near.counterparty = row.counterparty                 # 可能为空，允许
    return [near]
```

几点约束：

- 两腿的 `transfer_subtype` 一律取 `row.transfer_subtype`，**不写死 `repayment`** —— 写死会让 `plain` 转账被存成还款，下一次导入时被 §3.3 的排序误导。
- ② 里对手腿的金额取相反数、日期与币种取本腿的。决策 §1.2 允许两腿跨币种、金额不等，但导入时没有第二份账单可依据，只能等额生成；用户要跨币种就在 commit 后用 `PATCH .../transactions/transfer/{pair_id}` 改。
- `UNIQUE (transfer_pair_id, transfer_role)`（决策 §10）保证一个 pair 最多一出一入；同一批里两行选了同一个对手账户也各有各的 `pair_id`。
- ① 的 `with_for_update()` 行锁挡住"两个人同时把不同的行配到同一条已有单腿上"的竞态：第二个事务拿到锁时看到 `transfer_pair_id` 已非空，抛 409 `already_paired`，整批回滚。

### 4.6 `transaction_events`（决策 §14.51）

导入建的每一笔交易都要追加一条 `imported` 事件；配对时改动的**已有**交易另追加一条 `paired` 事件。表结构见 [`02-database.md`](./02-database.md)，字段：`id`、`ledger_id`、`transaction_id`、`actor_id`、`at`、`event`、`changes`、`import_batch_id`、`client`。

```python
def _event(tx, event, batch, actor_id, client, changes=None) -> TransactionEvent:
    return TransactionEvent(
        ledger_id=batch.ledger_id, transaction_id=tx.id,
        actor_id=actor_id, at=utcnow(), event=event,   # 本次操作者，不是批次的上传人
        changes=changes,                       # imported 事件为 NULL：整条都是新的
        import_batch_id=batch.id,
        client=client)                         # 本次请求头 X-Client，可为 NULL
```

| 场景 | 事件 |
|---|---|
| 导入新建一条交易（含 ② 里的对手腿） | 每条一个 `imported`，`changes = NULL`，`import_batch_id` = 本批 |
| ① 配对时改的那条已有交易 | 一个 `paired`，`changes` 记 `transfer_pair_id` 与 `counterparty` 的前后值 |
| 退款行写了 `refund_of` | 不额外发 `refund_linked`：`imported` 事件已经包含"这条是导入进来的、带着原单"这件事；`refund_linked` 留给导入之后在交易页做的关联变化 |
| 撤销导入 | 被删的交易**不**发事件（事件随外键级联删除，决策 §14.51）；因撤销而被拆开的**存活对腿**追加一条 `unpaired` 事件（§4.8） |

事件的 `actor_id` 是**本次操作的人**（`commit_batch` / `delete_batch` 收到的 `actor_id`），不一定是批次的 `created_by` —— member 提交别人上传的批次时，事件要记在提交人头上（决策 §14.51「actor_id = 做这件事的人」）。`client` 同理取本次请求的 `X-Client`；`import_batches` 表**不存** `client` 列。

`GET /ledgers/{lid}/transactions/{tid}` 的 `events[]` 按时间倒序返回，交易详情页显示成时间线（决策 §14.51、§14.52 B23）。事件表**只追加不修改**。

### 4.7 事务边界

```python
def commit_batch(db: Session, batch_id: UUID, actor_id: UUID,
                 client: str | None) -> CommitResult:
    with db.begin():                                     # 单事务，异常自动全回滚
        batch = db.get(ImportBatch, batch_id, with_for_update=True)   # 行锁，防并发双提交
        _assert_committable(batch)                       # §4.3 的全部前置校验
        ctx = load_context(db, batch)
        rows = db.scalars(select(ImportRow)
                          .where(ImportRow.batch_id == batch_id,
                                 ImportRow.status != "skipped")
                          .order_by(ImportRow.row_no)).all()
        created, events, paired = [], [], 0
        for i, r in enumerate(rows, start=1):
            if r.kind == "transfer":
                txs = commit_transfer(db, r, batch, ctx, events, actor_id, client)
                paired += 1 if r.matched_transaction_id else 0
            else:
                txs = [_build(r, batch, ctx)]            # refund_of 按 §4.4 的两个条件写
            db.add_all(txs)
            if i % 200 == 0:
                db.flush()                               # 分批 flush，让 CHECK 尽早报错
            r.transaction_id = txs[0].id                 # status 不动，见下
            created.extend(txs)
        db.flush()
        for tx in created:
            events.append(_event(tx, "imported", batch, actor_id, client))
        db.add_all(events)
        batch.status = "committed"
        batch.committed_at = utcnow()
        batch.committed_transaction_count = len(created)
    return CommitResult(transaction_count=len(created), paired_count=paired)
```

- **一个事务**（决策 §5）：任何一行违反 CHECK 就整批回滚，批次保持 `ready`，用户改完再提交。
- 分批 flush（每 200 行）比逐条快一个数量级；约束报错时定位不到具体行，此时在出错路径上再对该批逐行 flush 一次定位（只有出错时才慢）。
- **提交不改 `import_rows.status`**：决策 §5 给这个列的取值只有 `pending` / `edited` / `skipped`。"这一行提交过没有"由 `transaction_id IS NULL` 回答，也不会把用户改过行的 `edited` 冲掉。
- 成功响应：`{"batch_id": ..., "status": "committed", "transaction_count": 13, "paired_count": 1}`。

### 4.8 撤销与 `dry_run`

`DELETE /ledgers/{lid}/imports/{bid}`：批次是 `committed` 时语义是**撤销**，是 `ready` 时是**丢弃**；两者最终都让这一批整个消失（决策 §14.22：不引入 `reverted` 状态、不为追溯保留已撤销批次）。无时间限制，member 也能做（决策 §14.52 B9）。

```python
def delete_batch(db, batch_id, actor_id, client=None, dry_run=False) -> DeleteResult:
    with db.begin():
        batch = db.get(ImportBatch, batch_id, with_for_update=True)
        mode = "revert" if batch.status == "committed" else "discard"
        tx_ids = db.scalars(select(Transaction.id)
                            .where(Transaction.import_batch_id == batch_id)).all()

        # B24（决策 §14.52）：两个方向分开数、分开措辞
        orphaned = db.scalar(                     # 批外的退款，指向本批里的支出
            select(func.count()).select_from(Transaction)
            .where(Transaction.kind == "refund",
                   Transaction.refund_of.in_(tx_ids),
                   Transaction.import_batch_id.is_distinct_from(batch_id))) or 0
        in_batch = db.scalar(                     # 批内的退款，删掉后其原支出恢复可退额度
            select(func.count()).select_from(Transaction)
            .where(Transaction.id.in_(tx_ids),
                   Transaction.kind == "refund",
                   Transaction.refund_of.isnot(None))) or 0

        if dry_run:
            return DeleteResult(mode, len(tx_ids), orphaned, in_batch, deleted=False)

        # ① 先拆 §4.5 ① 配进去的 pair：本批交易带的 pair_id，另一条腿不在本批里
        pair_ids = db.scalars(select(Transaction.transfer_pair_id)
                              .where(Transaction.import_batch_id == batch_id,
                                     Transaction.transfer_pair_id.isnot(None))).all()
        survivors = db.scalars(
            select(Transaction).where(
                Transaction.transfer_pair_id.in_(pair_ids),
                Transaction.import_batch_id.is_distinct_from(batch_id))
            .with_for_update()).all() if pair_ids else []
        for far in survivors:
            old_pair = far.transfer_pair_id       # 先存原值，事件要记 before
            far.transfer_pair_id = None           # counterparty 保持 NULL，见下
            far.updated_by, far.updated_at = actor_id, utcnow()
            db.add(_event(far, "unpaired", batch, actor_id, client,
                          {"transfer_pair_id": {"before": str(old_pair),
                                                "after": None}}))
        db.flush()                                # 先落拆对，再删交易

        # ② 删本批交易与批次；本批交易自己的 events 随外键级联消失
        db.execute(delete(Transaction).where(Transaction.import_batch_id == batch_id))
        db.delete(batch)                          # import_rows 随 ON DELETE CASCADE 消失
    return DeleteResult(mode, len(tx_ids), orphaned, in_batch, deleted=True)
```

`?dry_run=true` 的响应（前端拿它填确认框，决策 §14.43 03-9、§14.52 B24）：

```json
{
  "batch_id": "…",
  "mode": "revert",
  "transaction_count": 13,
  "orphaned_refunds": 2,
  "refunds_in_batch": 1,
  "deleted": false
}
```

确认框上的两句话是**分开的**，不能混成一句（这正是屏幕稿 11 要改的地方）：

- `orphaned_refunds > 0` → 「有 2 笔**其它批次或手工记的**退款指向这批里的支出，撤销后它们会失去原单（退款本身保留）」。
- `refunds_in_batch > 0` → 「这批里有 1 笔退款，删掉后它原来关联的那笔支出会恢复可退额度」。

撤销的连带影响，全部由数据库外键处理：

| 情况 | 结果 | 依据 |
|---|---|---|
| 被删的支出有批外退款指向它 | 退款行 `refund_of` 置 NULL，退款行保留 | 决策 §1.1 `ON DELETE SET NULL` |
| 被删的交易有 `transaction_events` | 事件级联删除 | 决策 §14.51 |
| 被删的是 ② 建的两腿转账 | 两腿同 `import_batch_id`，一起删 | §4.5 ② |
| 被删的是 ① 配对进去的那一腿 | 本批那条被删，**库里原来那条保留**，其 `transfer_pair_id` 置回 NULL、`counterparty` 保持 NULL（原文本已在配对时清掉，找不回来），并追加一条 `unpaired` 事件 | 决策 §14.34、§14.51 |
| 被删的交易被后来手工编辑过 | 照删不误 | 撤销就是"当初这批不该导" |
| 撤销后再次调 `DELETE` | 404 `not_found`（批次行已经没了，删除是幂等终态） | |
| 撤销后想重新导入 | 重新上传 = 新建批次 | |

① 的回滚是唯一需要应用代码兜的（就是上面伪代码的 ① 那一段）：删交易之前先把配对进去的那些 pair 拆开（`UPDATE transactions SET transfer_pair_id = NULL, updated_by = :actor, updated_at = now() WHERE transfer_pair_id IN (…) AND import_batch_id IS DISTINCT FROM :bid`）并给每条被拆开的存活腿追加一条 `unpaired` 事件，否则留下一个只有一条腿却带着 `transfer_pair_id` 的孤儿、时间线上也解释不了这条腿为什么突然不配对了。对手文本在**正式交易上**找不回来是已知的取舍：`counterparty` 在配对时被清空，决策 §14.34 没有要求恢复，本章也不为此加列 —— 但 §4.5 ① 的 `paired` 事件在 `changes.counterparty.before` 里留着原值，用户在交易详情的时间线上还能看到。

响应体：`{"batch_id": ..., "mode": "revert", "deleted_transactions": 13, "deleted": true}`。删除类端点统一 204，撤销导入是例外（要回条数，决策 §14.43 03-6）。

### 4.9 批次列表与详情

`GET /ledgers/{lid}/imports` 每行（决策 §14.52 A17）：

| 字段 | 说明 |
|---|---|
| `id`、`status`、`created_at`、`committed_at` | `status` 只有 `ready` / `committed` |
| `source` | 目标账户 `{id, name, type}` |
| `created_by` | 上传人的用户 id，前端用成员列表映射成 `display_name`（决策 §14.43 03-4、§14.40 01-7） |
| `source_kind` | `csv`（上传文件）/ `paste`（粘贴） |
| `original_filename`、`file_size` | 只记名字与字节数，**文件不保存**（§4.11）；粘贴时为 NULL |
| `skill_version` | 文件里的 `# version:` 值 |
| `row_count` | 数据行数 |
| `net_amount`、`net_currency` | 本批**净额**：非转账行按账本基准币种折算后求和（收入 + 退款 − 支出），转账不计入（决策 §14.52 A17、§7） |
| `flag_counts` | `{"duplicate": 3, "refund_candidate": 1, "transfer_candidate": 1, "needs_review": 5}` |
| `uncategorized_count` | 待归类行数，`ready` 批次的提交按钮靠它禁用 |

`GET /ledgers/{lid}/imports/{bid}` 是同一形状加上 `rows` 的第一页。**没有** `progress` 字段、没有页面缩略图、没有 `error_*` 列 —— 校验错误在上传那一刻就同步返回了，压根不会有一个"失败的批次"存在（决策 §14.25）。

### 4.10 复制错误清单（决策 §14.52 A18）

上传校验失败（§2.2 / §2.3）时，前端把 `errors[]` 渲染成清单，并给一个「复制错误清单」按钮，复制出的是纯文本：

```text
导入文件校验失败（wallet-2026-08.csv，2026-09-11 14:23）
应用当前分类表版本：2026-09-10

第 2 行：表头不对：缺少 transfer_subtype；多出 counterparty
第 14 行：有 10 个字段，应为 11 个
第 27 行：有 12 个字段，应为 11 个
```

用途很具体：用户把它贴回自己的 ChatGPT / Claude 说"按这个改"，聊天工具就能自己修好重出一份。所以格式要机器可读也人可读：一行一条、行号在前。

### 4.11 不保存文件（决策 §14.28）

- 上传的字节读进内存、校验完就丢；粘贴的文本同理。批次只记 `original_filename` 与 `file_size`。
- 后端**没有任何文件系统状态**：不设上传目录、不挂上传卷、没有目录清理任务、没有磁盘配额。
- 校验对行的每一处改动写进 `hint`，**不另存原始值**：要看原文就去看用户自己那份 CSV（在他自己的聊天记录里）。
- 撤销和删除都不需要删文件。

---

## 5. skill 规范

### 5.1 目录结构

skill 是**仓库里的交付物**（决策 §6），随代码一起版本管理，随分类表一起更新：

```text
skills/wallet-import/
  SKILL.md                  # Claude 版主文本（Claude.ai 项目 / Claude Code 都能装），§5.2
  chatgpt-instructions.md   # ChatGPT 版指令文本（Custom GPT / Project 指令），§5.3
  example.csv               # 标准 CSV 示例（就是 §1.5 的示例 A）
  README.md                 # 给用户看的安装步骤：Claude 怎么装、ChatGPT 怎么装
scripts/
  gen_import_skill.py       # 从 core/categories.py 生成上面三份文件，§5.4
```

`SKILL.md` 与 `chatgpt-instructions.md` 里的**分类清单**和 **`version`** 两段是生成的，其余是手写模板 —— 模板放 `scripts/templates/`，生成脚本只做占位符替换。**生成物一并提交进仓库**：用户是从仓库或应用内的导入指南页拿到文本的，不能要求他们自己跑脚本。

### 5.2 `SKILL.md` 全文

下面是模板渲染后的完整文本。`{{CATEGORY_VERSION}}` 与两段分类清单由 §5.4 的脚本填入，这里展示的是填好之后的样子（分类表按决策 §1.3）。

````markdown
---
name: wallet-import
description: 把任意格式的账单（PDF、图片、Excel、CSV、网页复制的文本）整理成记账应用的标准导入 CSV。当用户给出账单文件或账单文本，并要求「整理成导入文件」「转成 CSV」「导入账本」时使用。
---

# 账单整理为标准导入 CSV

## 你的角色

你是账单整理助手。用户会给你一份账单——银行或信用卡的 PDF 对账单、手机截图、支付宝 / 微信导出的
表格、Excel、或者从网银页面复制的一段文本。你的唯一任务是把它**逐笔**整理成下面规定的标准 CSV，
交给用户上传到他的记账应用。

你**只做整理，不做判断以外的事**：不要给理财建议、不要汇总统计、不要对消费习惯发表看法。

## 输入

任意账单。一次处理一个账户的账单：如果用户一次给了多个账户的账单（比如储蓄卡和信用卡各一份），
分别输出多份 CSV，并告诉用户每份对应哪个账户——应用里一份文件只能导入到一个账户。

读不清楚的地方（模糊的截图、被裁掉的一列）不要猜数字，把这一行照常输出，把疑问写进 `note`，
并在正文里告诉用户第几行需要他核对。

## 输出格式（必须严格遵守）

一个 UTF-8 的 CSV，**第一行是版本行，第二行是固定表头**：

```csv
# version: 2026-09-10
date,amount,currency,kind,transfer_role,transfer_subtype,merchant,note,category_l1,category_l2,source_ref
```

- 版本行原样照抄，**不要改日期**。它是应用用来判断你这份 skill 是不是最新的。
- 表头 11 列，顺序不能变、不能增删列、不能改名。特别地：**没有** `counterparty` 列，也**没有**
  `flags` 列——对手是谁、有没有重复由应用那边处理。
- 每行 11 个字段。字段里含逗号、引号或换行时，用双引号把整个字段包起来，字段内的引号写成两个
  双引号（RFC 4180）。
- 优先**输出成一个 .csv 文件供用户下载**；无法产生文件时，就把完整内容放进一个代码块，让用户
  整段复制——应用的粘贴框收的就是这段文本，连版本行一起。

### 列的含义

| 列 | 必填 | 写什么 |
|---|---|---|
| `date` | 是 | `YYYY-MM-DD`，交易发生日。账单上是 `03/08/2025` 这种就先判断它是日/月还是月/日，判断不了就问用户 |
| `amount` | 是 | 数字，最多 4 位小数。不要写货币符号、不要写千分位、不要用括号表示负数 |
| `currency` | 是 | 三位大写字母，例如 `CNY` / `SGD` / `USD`。写这一笔在这个账户上**实际结算**的币种 |
| `kind` | 是 | `expense` / `income` / `refund` / `transfer` 四选一 |
| `transfer_role` | 转账必填 | `out`（转出）/ `in`（转入）。非转账留空 |
| `transfer_subtype` | 转账必填 | `repayment`（还信用卡）/ `plain`（其它划转）。非转账留空 |
| `merchant` | 否 | 商户名，清理过噪音的。转账不写商户 |
| `note` | 否 | 备注：外币原值、账单原文摘要、你的疑问 |
| `category_l1` | 否 | 下面清单里的一级 code。**拿不准就留空** |
| `category_l2` | 否 | 该一级下的二级 code。一级留空时这里也必须留空 |
| `source_ref` | 否 | 指回原文的位置，例如 `p2:14`（第 2 页第 14 行）或账单上的流水号 |

## 规则清单

1. **支出写负数**：`-128.00`。买东西、扣手续费、付账单，都是负数，`kind=expense`。
2. **收入写正数**：`6200.00`。工资、利息、报销到账，`kind=income`。
   不要写货币符号（`¥128`）、不要用会计括号（`(128.00)`）、不要写 `128.00 DR` —— 把它们
   转成 `-128.00` 是你的活。
3. **退款用 `refund`，金额为正**：商家退货退款、订单取消退回、多收的钱退回来，
   `kind=refund`、金额正数。**尽量在 `note` 里注明退的是哪一笔**（"退了 08-07 的键盘"），
   分类填**原来那笔支出的分类**。退款不是收入，不要写成 `income`。
4. **信用卡还款用 `transfer` + `repayment`**：从储蓄卡还信用卡这件事，在储蓄卡账单上是
   `kind=transfer, transfer_role=out, transfer_subtype=repayment`，金额负数；在信用卡账单上是
   `kind=transfer, transfer_role=in, transfer_subtype=repayment`，金额正数。
   还款**不是支出**，写成 `expense` 会让这个月的支出凭空多一遍。
5. **本人账户之间划转用 `transfer` + `plain`**：从一张卡转到自己另一张卡、存现金、取现金。
   同样按 `out` 负 / `in` 正定号。
6. **转给别人 / 别人转给我**：如果账单上看得出是转给他人或他人转入，且**不是**本人账户之间的
   划转，默认按收支记——转出记 `expense`（分类 `social` / `transfer_out`），转入记 `income`
   （分类 `social_income` / `transfer_in`）。理由：真正的收入不该消失在统计之外。用户明确说
   "这是我自己两个账户之间的钱"时才改成 `transfer`。
7. **外币消费写原值到 `note`**：账户按 SGD 结算、原始消费是 138.00 USD 时，`amount` 写结算的
   `-184.20`、`currency` 写 `SGD`，`note` 写 `原值 138.00 USD`。不要自己换算汇率。
8. **清理商户名的噪音**：`支付宝-（上海）星巴克咖啡有限公司国贸店*POS消费` → `星巴克（国贸店）`。
   去掉渠道前缀（支付宝、微信支付、财付通）、去掉 `POS消费` / `快捷支付` / `银联` 之类的后缀、
   去掉纯数字的商户编号。保留能认出是谁的部分。转账行不写商户。
9. **日期一律 `YYYY-MM-DD`**：`2026年8月3日`、`08/03/2026`、`3 Aug 2026` 都要转成 `2026-08-03`。
   遇到 `03/08/2026` 这种日月分不清的，**先看整份账单里有没有大于 12 的数字**能定死顺序；还是
   定不了就问用户，不要蒙。
10. **分类拿不准就留空，不要猜**：淘宝、京东、Shopee、亚马逊这类看不出买了什么的订单，
    `category_l1` 和 `category_l2` **都留空**，让用户在应用里自己选。留空是正确答案，猜错不是。
11. **不要自创 code**：`category_l1` / `category_l2` 只能用下面清单里出现过的 code，
    一个字母都不能改。清单里没有的东西就留空。`kind`、`transfer_role`、`transfer_subtype`
    同理，只能用上面表格里列出的值。
12. **不要输出完整卡号**：账单上的卡号、账号一律不要抄进 `merchant` 或 `note`。需要提及时只写
    末四位（`尾号 1234`）。同样不要抄身份证号、手机号、地址。
13. **每笔一行，不合并不拆分**：同一天在同一家店的两笔一样的消费就是两行，照样输出两行。
    分期付款按账单上实际扣的那一期记一行。
14. **只输出这一份 CSV**：不要在 CSV 里加统计行、小计行、空行、说明行。想说的话写在 CSV 外面。

## 分类清单（只能用这里的 code）

一级分类带了判据，按判据归类；判据都对不上就留空。

**支出（16 个一级）**

| 一级 code | 名称 | 判据 | 二级 code |
|---|---|---|---|
| `clothing` | 服饰 | 穿在身上的：衣服、鞋、包、配饰。运动装备也算这里；童装归育儿 | `clothes` 衣服、`shoes` 鞋子、`bags` 包、`accessories` 配饰 |
| `food` | 餐饮 | 日常吃喝：堂食、外卖、咖啡奶茶、零食。旅途中的吃喝归旅游 | `breakfast` 早餐、`lunch` 午餐、`dinner` 晚餐、`late_snack` 夜宵、`snacks_drinks` 零食饮料 |
| `housing` | 居住 | 住的固定大头：房租、房贷。水电物业归固定支出 | `rent` 房租、`mortgage` 房贷 |
| `transport` | 交通 | 日常出行：公交地铁、打车、加油、停车、火车飞机。旅游期间的交通归旅游 | `public_transit` 公交地铁、`taxi` 打车、`fuel` 加油、`parking` 停车、`train` 火车、`flight` 飞机 |
| `health` | 健康 | 自己的看病买药、体检、保健品、健身。宠物和孩子的医疗各归宠物、育儿 | `medical` 看病、`medicine` 买药、`checkup` 体检、`wellness` 保健、`fitness` 健身 |
| `entertainment` | 娱乐 | 玩乐：电影、游戏、KTV、酒吧、桌游密室。视频音乐订阅归精神文化 | `movies` 电影、`games` 游戏、`ktv` KTV、`outing` 出去玩 |
| `groceries` | 生活购物 | 消耗品和家里的日常运转：买菜、洗护清洁、厨房用品、纸巾垃圾袋等日用杂货。判据：用完就没了 | `fresh_food` 买菜、`toiletries` 洗护清洁、`kitchenware` 厨房用品、`household` 日用杂货 |
| `shopping` | 消费购物 | 耐用品和一次性大件：数码、家电、家具、行李箱工具等。判据：买一次用几年 | `electronics` 数码、`appliances` 家电、`furniture` 家具、`other_goods` 其他物件 |
| `pet` | 宠物 | 宠物的吃、用、看病 | `pet_food` 宠物粮、`pet_medical` 宠物医疗、`pet_supplies` 宠物用品 |
| `childcare` | 育儿 | 孩子的一切：奶粉尿布、玩具、教育、衣物、医疗 | `formula_diapers` 奶粉尿布、`toys` 玩具、`education` 教育、`kids_clothes` 衣物、`kids_medical` 医疗 |
| `parents` | 父母 | 给父母的：孝敬钱、礼物、医疗 | `filial` 孝敬、`gifts` 礼物、`parents_medical` 医疗 |
| `bills` | 固定支出 | 每月固定的账单：水、电、燃气、物业、宽带、话费。房租房贷归居住 | `water` 水费、`electricity` 电费、`gas` 燃气、`property_fee` 物业、`internet` 宽带、`mobile` 话费 |
| `culture` | 精神文化支出 | 学习和精神消费：书、课程、文具、知识付费、展览、视频音乐订阅 | `books` 书籍、`courses` 课程、`stationery` 文具、`paid_content` 知识付费、`exhibitions` 展览、`subscriptions` 订阅 |
| `travel` | 旅游 | 离开常住地的旅程中的一切：机票、酒店、门票、当地交通、旅途餐饮 | `flights` 机票、`hotels` 酒店、`tickets` 门票、`local_transport` 当地交通、`travel_food` 旅游餐饮 |
| `social` | 人情往来 | 花在别人身上的：红包礼金、请客、借出、转给他人。给父母的归父母 | `red_packet` 红包礼金、`treat` 请客、`lend` 借出、`transfer_out` 转给他人 |
| `other` | 其他 | 归不进上面任何一类的：罚款、手续费、年费 | `fines` 罚款、`fees` 手续费 |

**收入（6 个一级）**

| 一级 code | 名称 | 判据 | 二级 code |
|---|---|---|---|
| `salary` | 工资 | 雇主发的钱：基本工资、奖金、RSU | `base_salary` 基本工资、`bonus` 奖金、`rsu` RSU |
| `side_income` | 兼职 | 主业之外的劳务收入 | — |
| `investment` | 理财 | 钱生的钱：利息、分红、基金赎回收益 | `interest` 利息、`dividend` 分红、`fund` 基金 |
| `reimbursement` | 报销 | 垫付后收回的钱 | — |
| `social_income` | 人情往来 | 别人给的：红包礼金、借入、他人转入 | `red_packet_in` 红包礼金、`borrow` 借入、`transfer_in` 他人转入 |
| `other_income` | 其他 | 归不进上面任何一类的收入 | — |

`kind=transfer` 的行**不填任何分类**，两列都留空。

## 完整示例

```csv
# version: 2026-09-10
date,amount,currency,kind,transfer_role,transfer_subtype,merchant,note,category_l1,category_l2,source_ref
2026-08-03,-128.00,CNY,expense,,,盒马鲜生,,groceries,fresh_food,p1:5
2026-08-07,-1299.00,CNY,expense,,,京东,"iPad 保护套 + 键盘，一单两件",shopping,electronics,p1:7
2026-08-11,299.00,CNY,refund,,,京东,"退了键盘，原单 2026-08-07",shopping,electronics,p1:9
2026-08-12,-238.00,CNY,expense,,,淘宝,"看不出买的什么",,,p1:10
2026-08-15,20000.00,CNY,income,,,某某科技,"八月工资",salary,base_salary,p1:11
2026-08-20,-3000.00,CNY,transfer,out,repayment,,"还信用卡",,,p1:12
2026-08-22,-500.00,CNY,transfer,out,plain,,"转到另一张卡",,,p1:13
```

这是**一个账户**（一张 CNY 储蓄卡）的一份账单：整份文件只有这一个账户的流水，`currency` 全是
这个账户的结算币种，两条转账都是从这个账户转出去的（`transfer_role=out`）。用户如果还给了别的
账户的账单（比如那张被还的信用卡），另出一份 CSV，不要混在同一份文件里。

## 交付时说什么

给出 CSV 之后，用一小段话告诉用户：

1. 一共整理了多少笔，日期范围是什么。
2. 哪些行留空了分类、为什么（"第 4 行是淘宝订单，看不出买的什么"）。
3. 哪些行你不确定，请他核对。
4. 提醒他：上传时要选对这份账单属于哪个账户。

如果应用提示 `skill_outdated`，说明分类表更新了，让用户到应用的「导入指南」页重新复制一份新的
skill 文本，再让你重新整理一次。
````

### 5.3 ChatGPT 版指令文本

`chatgpt-instructions.md` 与 `SKILL.md` 是**同一份主文本**的两种包装（决策 §6）：规则清单、分类清单、示例逐字相同，只有开头的角色定义与结尾的交付说明按 ChatGPT 的形态改写。

```markdown
# 用法

把下面「指令正文」整段复制到：
- **Custom GPT**：Configure → Instructions
- **Project**：项目设置 → Instructions
- 或者，每次对话开头直接粘贴，然后再上传账单。

分类表更新时（应用提示 `skill_outdated`），到应用的「导入指南」页重新复制一份。

---

# 指令正文

你是账单整理助手。用户会上传或粘贴一份账单（PDF、图片、Excel、CSV、或从网银复制的文本），
你把它逐笔整理成下面规定的标准 CSV，用户会把结果上传到他的记账应用。

【输出格式】
第一行必须是 `# version: 2026-09-10`，原样照抄不要改。
第二行必须是这 11 列表头，顺序不能变、不能增删：
date,amount,currency,kind,transfer_role,transfer_subtype,merchant,note,category_l1,category_l2,source_ref
之后每行一笔。字段含逗号或引号时用双引号包起来，字段内的引号写成两个双引号。
优先用代码解释器生成一个 .csv 文件让用户下载；不方便时把完整内容放进一个代码块让用户复制。

【规则】
（与 SKILL.md「规则清单」的 14 条逐字相同，此处从略——生成脚本会把同一段文本填进来）

【分类清单】
（与 SKILL.md 的两张表逐字相同，生成脚本填入）

【交付时说什么】
（与 SKILL.md 相同）
```

两点差异是形态决定的，不是规则差异：

- ChatGPT 没有 skill 的 frontmatter，所以用「用法 + 指令正文」两段包装；正文里不写 Markdown 表格以外的结构化元数据。
- 生成文件优先走代码解释器（Claude 侧是直接产出文件）。两边都要求：**做不到文件就给代码块**。

### 5.4 生成脚本 `scripts/gen_import_skill.py`

分类表与版本**同源**（决策 §6、§14.30）：`backend/app/core/categories.py` 是唯一定义处，`CATEGORY_VERSION` 是它里面的一个常量；`GET /categories`、`GET /import-format`、skill 文本三者的分类清单和版本号都从这里来。改分类表 → 手工递增 `CATEGORY_VERSION` → 重新跑脚本 → 提交生成物 → 老 skill 产出的文件从此被 `skill_outdated` 拒掉（§2.3）。

```python
#!/usr/bin/env python3
"""从 backend/app/core/categories.py 生成 skills/wallet-import/ 下的三份交付物。

    python scripts/gen_import_skill.py            # 生成
    python scripts/gen_import_skill.py --check    # 只校验生成物是最新的（CI 用）

生成物必须提交进仓库：用户是从仓库或应用内的导入指南页拿文本的。
"""
import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "backend"))

from app.core.categories import CATEGORY_VERSION, EXPENSE_CATEGORIES, INCOME_CATEGORIES

ROOT = pathlib.Path(__file__).resolve().parents[1]
TPL  = ROOT / "scripts" / "templates"
OUT  = ROOT / "skills" / "wallet-import"

def render_group(cats) -> str:
    """渲染成 SKILL.md 里的那张表：一级 code / 名称 / 判据 / 二级 code。
    判据取 desc_zh（决策 §1.3、§14.21）——它就是给整理账单的人看的归类判据。"""
    lines = ["| 一级 code | 名称 | 判据 | 二级 code |", "|---|---|---|---|"]
    for c in cats:
        subs = "、".join(f"`{s.code}` {s.name_zh}" for s in c.children) or "—"
        lines.append(f"| `{c.code}` | {c.name_zh} | {c.desc_zh} | {subs} |")
    return "\n".join(lines)

def render(template_name: str) -> str:
    text = (TPL / template_name).read_text(encoding="utf-8")
    return (text
            .replace("{{CATEGORY_VERSION}}", CATEGORY_VERSION)
            .replace("{{EXPENSE_TABLE}}", render_group(EXPENSE_CATEGORIES))
            .replace("{{INCOME_TABLE}}", render_group(INCOME_CATEGORIES)))

TARGETS = {
    "SKILL.md":                "SKILL.md.tpl",
    "chatgpt-instructions.md": "chatgpt-instructions.md.tpl",
    "example.csv":             "example.csv.tpl",     # 只替换版本行
}

def main() -> int:
    check = "--check" in sys.argv
    stale = []
    for out_name, tpl_name in TARGETS.items():
        want, path = render(tpl_name), OUT / out_name
        if check:
            if not path.exists() or path.read_text(encoding="utf-8") != want:
                stale.append(out_name)
        else:
            path.write_text(want, encoding="utf-8")
            print(f"wrote {path.relative_to(ROOT)}  (version {CATEGORY_VERSION})")
    if stale:
        print("以下文件与 categories.py 不同步，请跑 scripts/gen_import_skill.py："
              + "、".join(stale), file=sys.stderr)
        return 1
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
```

`--check` 进 CI：忘记重新生成 skill 就改了分类表，构建直接红。这是"同源"落到实处的地方 —— 光靠约定，`CATEGORY_VERSION` 和 skill 文本迟早会分叉，而分叉的后果是所有用户的导入在毫无预兆的情况下被 `skill_outdated` 拒掉，或者更糟：版本号对得上但分类清单是旧的，`category_l1` 被静默清空。

### 5.5 应用内「导入指南」页与 `GET /import-format`

**页面**（决策 §6，前端形态见 [`04-frontend.md`](./04-frontend.md)，屏幕稿见 [`mockups/README.md`](./mockups/README.md) 屏幕 10）三步：

1. **装 skill** —— Claude 用户下载 / 复制 `SKILL.md`，ChatGPT 用户复制指令文本；两个 tab，各带「复制」与「下载」按钮。
2. **在你自己的 ChatGPT / Claude 里整理账单** —— 一句话说明：把账单丢给它，让它输出标准 CSV。
3. **把 CSV 拿回来** —— 上传 `.csv` 文件，或把代码块整段粘贴进来；选目标账户；提交。

页面上还有：标准 CSV 的示例文件（下载 `example.csv`）、11 列表头的说明表（§1.2）、常见问题（"提示 skill 版本过期怎么办" → 回到第 1 步重新复制）。页面**不**显示"你的 skill 版本"—— 应用拿不到用户装的是哪一版（决策 §14.52 A18 前半）。

**接口** `GET /import-format`（公开，决策 §11）是这一页的唯一数据源，也让 skill 文本只有仓库一处来源：

```json
{
  "version": "2026-09-10",
  "columns": [
    {"name": "date", "required": true, "description": "YYYY-MM-DD，交易发生日"},
    {"name": "amount", "required": true, "description": "数字，支出为负、收入与退款为正"},
    "…共 11 列"
  ],
  "example_csv": "# version: 2026-09-10\ndate,amount,currency,…",
  "skill_claude": "---\nname: wallet-import\n…",
  "skill_chatgpt": "# 用法\n…",
  "limits": {"max_bytes": 2097152, "max_rows": 2000}
}
```

- 三段文本在启动时从 `skills/wallet-import/` 读进内存（文件随镜像一起打包），不在请求里读盘。
- 与 `GET /categories` 一样是公开、可长缓存的：响应带 `ETag`，`version` 变了才变。
- 前端**不**自己拼 skill 文本、也不自己维护一份列说明 —— 那是第二处事实来源，迟早和仓库里的分叉。

---

## 6. 安全

### 6.1 上传的文件是数据，不是指令

标准导入文件是用户的聊天工具生成的，内容仍然是**外部输入**：商户名可以叫 `=cmd|'/c calc'!A1`，`note` 里可以写一段"忽略以上规则"。应用这边的防线是结构性的：

1. **不执行**：没有 `eval`、没有把字段拼进 SQL（全部走 SQLAlchemy 参数绑定）、没有把 `note` 当模板渲染、没有 shell 调用。文件内容只经过 §2 的解析函数，产物是 `Decimal` / `date` / 枚举 / 有长度上限的字符串。
2. **不解析成别的东西**：`.csv` 只按 RFC 4180 切分。不猜格式、不按扩展名换解析器、不解压、不跟随任何外部引用（文件里也没有能表达引用的地方）。
3. **所有值域在服务端二次校验**（§2.4）：分类 code 必须在常量表内，`kind` 必须在四个枚举内，金额必须能被 `parse_amount` 解析，币种必须匹配 `^[A-Z]{3}$`。编出来的东西进不了数据库。
4. **不落盘**（§4.11）：字节读进内存、校验完就丢。没有上传目录、没有可执行位、没有静态路径能到达它。
5. **文本只当文本显示**：前端是 React Native / react-native-web 的 `<Text>`，不做 `dangerouslySetInnerHTML`、不渲染 Markdown。

CSV 公式注入（以 `=` `+` `-` `@` 开头的单元格）在本版本**不构成风险**：应用只读 CSV、不导出 CSV（决策 §14.52 A1 明确本版本不做导出）。将来做导出时要在导出侧加单引号前缀，这里不预留。

### 6.2 卡号脱敏

整理账单的聊天工具被要求不输出完整卡号（§5.2 规则 12），但那是**它那边**的规则，不能当防线。归一化的最后一步统一脱敏，作用于 `merchant` 和 `note`：

```python
_PAN = re.compile(r"(?<!\d)(?:\d[ -]?){12,18}\d(?!\d)")   # 13–19 位，允许空格/连字符分组

def mask_pan(text: str | None) -> str | None:
    if not text:
        return text
    def _mask(m: re.Match) -> str:
        digits = re.sub(r"\D", "", m.group())
        if not (13 <= len(digits) <= 19) or not _luhn(digits):
            return m.group()          # 不是卡号（订单号、流水号）就别动
        return "*" * (len(digits) - 4) + digits[-4:]
    return _PAN.sub(_mask, text)

def _luhn(d: str) -> bool:
    s, alt = 0, False
    for ch in reversed(d):
        n = int(ch)
        if alt:
            n *= 2
            if n > 9:
                n -= 9
        s += n
        alt = not alt
    return s % 10 == 0
```

加 Luhn 校验的原因：账单里 13–19 位的连续数字大多是订单号、流水号、交易参考号（示例 C 的 `source_ref` 就是），直接全打码会毁掉有用信息。Luhn 通过的才当卡号。`source_ref` **不**脱敏 —— 它按 §1.2 是位置引用，长数字在这里是有意义的，而且不进正式交易。

### 6.3 日志不落账单内容

| 允许记 | 禁止记 |
|---|---|
| `batch_id`、`ledger_id`、`source_id`、`user_id` | 原始文件名、文件内容、任何一行的字段值 |
| 行数、标记计数、耗时 | 任何一行的 `merchant` / `note` / `amount` |
| HTTP 状态码、错误 code、`skill_version` | 结构错误清单里的原文片段（那里面有表头和字段值） |

具体做法：`ImportFileInvalid` 的 `errors[]` 只在**响应体**里带原文片段（用户自己的数据回给用户自己），日志里只记 `code` 与错误条数；`ImportContext` 会被日志打印，所以它里面不放任何账单内容（§0.3）。原始文件名属于用户数据，进数据库（`original_filename`）但不进日志。

---

## 7. 测试

新增 `backend/tests/importing/`。现有约定：pytest + SQLite，`conftest.py` 在 import 应用前先设好 `DATABASE_URL` 与 `SECRET_KEY`。导入测试沿用这套，另外**绝不联网**（本章已经没有任何外部调用，这条现在是免费的）。

### 7.1 fixture 清单

`backend/tests/fixtures/import/`，全部是**纯文本 CSV**，可以逐字读、可以在 review diff 里看懂：

| 文件 | 覆盖的点 |
|---|---|
| `ok_credit_cny.csv` | §1.5 示例 A：支出、退款、还款转入腿；含中文商户与引号转义 |
| `ok_checking_sgd.csv` | §1.5 示例 B：收入、外币原值、`repayment` / `plain` 两种转出腿；`repayment` 那条与 `ok_credit_cny.csv` 的转入腿**币种与金额都不同**（跨币种还款，不该自动配对） |
| `ok_paste_alipay.txt` | §1.5 示例 C 的**粘贴文本**，前后带 ``` 围栏与空行，测 `read_paste()` 的剥离 |
| `ok_bom.csv` | 带 UTF-8 BOM，测 BOM 剥离 |
| `ok_crlf.csv` | `\r\n` 行尾 |
| `ok_2000_rows.csv` | 恰好 2000 行，测边界通过 |
| `bad_no_version.csv` | 缺 `# version:` 行 → `import_file_invalid` |
| `bad_header_extra_col.csv` | 表头多一列 `counterparty` → `import_file_invalid`，错误文案点名多出的列 |
| `bad_header_reordered.csv` | 表头 11 列齐全但顺序不对 → `import_file_invalid` |
| `bad_ragged.csv` | 第 14 行 10 个字段、第 27 行 12 个字段 → 一次报两条 |
| `bad_gbk.csv` | GBK 编码 → `import_file_invalid`（编码不可读） |
| `bad_2001_rows.csv` | 2001 行 → `rows_exceed_limit` |
| `stale_version.csv` | `# version: 2026-08-20` → `skill_outdated`，响应带 `current_version` |
| `dirty_rows.csv` | 一份"每种行级问题各一行"的样本：日期 `03/08/2026`、金额 `¥128.00`、金额 `0`、币种 `rmb`、`kind=payment`、`kind=expense` 却正数、转账缺 `role`、分类 `dining`、`food`+`taxi`、`kind=income`+`food`、转账带分类、批内两行全同 |

fixture 由维护者手工写，姓名统一"张三" / "John Doe"，卡号统一 `6225880212341234`（Luhn 通过，用于测 §6.2），金额是编的。

### 7.2 校验规则单测表

`test_validation.py`，参数化跑 `dirty_rows.csv` 的每一行 + 补充用例（覆盖 §2.8 速查表的 23 条）：

| 输入（该列，其余合法） | 期望结果 | 期望 flags | 期望 `hint` 含 |
|---|---|---|---|
| `date=2026-08-03` | `occurred_at=2026-08-03` | — | — |
| `date=03/08/2026` | `occurred_at=None` | `needs_review` | `不是 YYYY-MM-DD` |
| `date=2026-02-30` | `occurred_at=None` | `needs_review` | `不是 YYYY-MM-DD` |
| `date=1998-01-01` | `occurred_at=None` | `needs_review` | `超出可记账范围` |
| `date=` 今天 + 2 天 | `occurred_at=None` | `needs_review` | `超出可记账范围` |
| `date=` 今天 + 1 天 | 原样保留 | — | — |
| `amount=-128.00` | `Decimal("-128.0000")` | — | — |
| `amount=1,234.56` | `Decimal("1234.5600")` | — | — |
| `amount=¥128.00` | `0` | `needs_review` | `不是数字` |
| `amount=(128.00)` | `0` | `needs_review` | `不是数字` |
| `amount=0` | `0` | `needs_review` | `金额为 0` |
| `amount=999999999999` | 原样 | `needs_review` | `异常大` |
| `amount=1.23456` | `0` | `needs_review` | `不是数字` |
| `currency=cny` | `CNY` | — | — |
| `currency=rmb`，账户币种 CNY | `CNY` | `needs_review` | `已改为账户币种 CNY` |
| `currency=XYZ` | `XYZ` | — | — |
| `kind=payment`，`amount<0` | `expense` | `needs_review` | `无法识别` |
| `kind=expense`，`amount=32` | `amount=-32` | `needs_review` | `已改为 -32` |
| `kind=refund`，`amount=-32` | `amount=32` | `needs_review` | `已改为 32` |
| `kind=transfer`，`role=in`，`amount=-3000` | `amount=3000` | `needs_review` | — |
| `kind=transfer`，`role` 空，`amount<0` | `role=out` | `needs_review` | — |
| `kind=transfer`，`subtype` 空，账户 `credit`，`role=in` | `repayment` | — | — |
| `kind=transfer`，`subtype` 空，账户 `checking`，`role=out` | `plain` | `needs_review` | `已按普通划转` |
| `kind=expense`，`role=out` | `role=None` | — | `已清空` |
| `kind=expense`，`l1=dining` | `l1=None, l2=None` | **不含** `needs_review` | `不在支出分类表里` |
| `kind=income`，`l1=food` | `l1=None, l2=None` | **不含** `needs_review` | `不在收入分类表里` |
| `kind=expense`，`l1=food, l2=taxi` | `l1=food, l2=None` | **不含** `needs_review` | `不属于` |
| `kind=expense`，`l1=` 空 | 都为 `None` | 无 flags | 无 hint |
| `kind=transfer`，`l1=food` | 都为 `None` | 无 flags | `转账不记分类` |
| `note=卡号 6225880212341234` | `卡号 ************1234` | — | — |
| `note=订单号 1234567890123456789`（Luhn 不过） | 原样 | — | — |
| `note=` 600 字 | 截到 500 | — | `已截断` |
| 两行 11 列全同 | **两行都在**，各带 hint | 两行都 `needs_review` | `本批内有相同的行（第 3、7 行）` |

结构与版本的单测（`test_validation_shape.py`）逐个跑 §7.1 的 `bad_*` / `stale_*` fixture，断言 HTTP 状态、`code`、`errors[].line` 的集合，以及**不建批次**（`SELECT count(*) FROM import_batches == 0`）。

### 7.3 标记算法单测表

`test_flagging.py`，每条先用 factory 造库里的已有交易，再跑 `flag_rows`：

| 场景 | 期望 |
|---|---|
| 库里已有同账户同日同额同币种交易 | `duplicate`，`matched_transaction_id` = 那笔 |
| 库里有同日同额但**不同账户** | 无 `duplicate` |
| 库里有同日同额但不同币种 | 无 `duplicate` |
| 库里有两笔同日同额 | `duplicate`，`matched_transaction_id` 为 `None` |
| `kind=refund` 32，库里 30 天前有 32 同商户支出 | `refund_candidate`，预填该笔，分类沿用 |
| 同上但库里有两笔 32、商户都不同 | `refund_candidate`，**不**预填，`needs_review` |
| 同上但一笔商户相同、一笔不同 | 商户相同的高 20 分 → 预填它 |
| `kind=refund` 32，库里只有 100 天前的 32 支出 | 无候选 |
| `kind=refund` 32，原单已被别的退款退完 | 无候选（可退额度 = 0） |
| `kind=refund` 32，**同时**命中 `duplicate`，但退款候选为空 | `flags` 含 `duplicate`、不含 `refund_candidate`；`matched_transaction_id` 必须是 `None`（§3.2 查候选前已清空）；提交后该交易 `refund_of IS NULL` |
| `kind=refund` 32，库里 100 支出已退 68 | 命中（剩余 32，+80 分） |
| `kind=refund` 50，库里只有 30 支出 | 无候选 |
| 信用卡账户，正数入账，`kind=income` + 收入分类，命中唯一候选 | `kind` 改成 `refund`，收入分类被置空后沿用原单分类，行带 `needs_review` |
| `transfer/in` +3000，别的账户有 `transfer/out` −3000 同日**单腿** | `transfer_candidate`，预填 `matched_transaction_id` 与 `counterpart_source_id`，无 `needs_review` |
| 同上但对腿在 4 天前 | 无 `transfer_candidate`，`hint` 写"没找到对腿" |
| 同上但对腿在 3 天前 | 命中（边界含端点） |
| 同上但对腿币种不同 | 不命中 |
| 同上但对腿金额差 0.01 | 不命中 |
| 同上但对腿在**同一个账户**上 | 不命中（`source_id <> :source_id`） |
| 同上但对腿 `subtype` 是 `plain`、本行是 `repayment` | **仍然命中**（subtype 只参与排序） |
| 同上但对腿已有 `transfer_pair_id` | `duplicate`，不是 `transfer_candidate` |
| 转账行**同时**命中 `duplicate`（同账户同日同额）且对腿已配对 | `flags` 含 `duplicate`、不含 `transfer_candidate`；`matched_transaction_id` 必须是 `None`（§3.3 查候选前已清空），提交时不会走 §4.5 ① 的配对分支 |
| 两条单腿对腿都符合 | `transfer_candidate` + `needs_review`，`candidate_ids` 两个，**不**预填 |
| 一条已配对 + 一条单腿 | 预填那条单腿（`paired` 只在没有单腿时才触发 `duplicate`） |
| `transfer/out` `repayment`，库里没对腿，账本只有 1 个未归档 checking | `counterpart_source_id` 预填该 checking |
| 同上但账本有 3 个 checking | `counterpart_source_id=None` |

### 7.4 端到端

`test_import_e2e.py`，用 Starlette `TestClient` 打真实路由：

```python
def test_upload_review_pair_commit_revert(client, auth, ledger,
                                          credit_source, checking_source):
    # 前置：储蓄卡上已有一条单腿转出（模拟"上个月导过储蓄卡账单"）
    leg = make_transaction(source=checking_source, occurred_at="2026-08-20",
                           amount="-3000.00", currency="CNY", kind="transfer",
                           transfer_role="out", transfer_subtype="repayment",
                           counterparty="招行信用卡")

    # 1. 上传信用卡账单（同步返回批次 + 全部草稿行，没有 202、没有轮询）
    r = client.post(f"/api/v1/ledgers/{ledger.id}/imports",
                    files={"file": ("ok_credit_cny.csv", CSV_BYTES, "text/csv")},
                    data={"source_id": str(credit_source.id)}, headers=auth)
    assert r.status_code == 200
    b = r.json()
    bid = b["id"]
    assert b["status"] == "ready" and b["row_count"] == 7
    assert "progress" not in b

    rows = b["rows"]
    # 2. 自动标记：还款转入腿与库里那条单腿配上了对
    rep = next(x for x in rows if x["transfer_subtype"] == "repayment")
    assert "transfer_candidate" in rep["flags"]
    assert rep["matched_transaction_id"] == str(leg.id)
    # 退款行预填了原单
    rf = next(x for x in rows if x["kind"] == "refund")
    assert "refund_candidate" in rf["flags"] and rf["matched_transaction_id"]

    # 3. 待归类行拦住提交
    bad = client.post(f"/api/v1/ledgers/{ledger.id}/imports/{bid}/commit", headers=auth)
    assert bad.status_code == 409 and bad.json()["code"] == "rows_uncategorized"

    # 4. 改一行（淘宝那行补分类）
    tb = next(x for x in rows if x["merchant"] == "淘宝")
    client.patch(f"/api/v1/ledgers/{ledger.id}/imports/{bid}/rows/{tb['id']}",
                 json={"category_l1": "shopping", "category_l2": "other_goods",
                       "updated_at": tb["updated_at"]}, headers=auth)

    # 5. commit
    c = client.post(f"/api/v1/ledgers/{ledger.id}/imports/{bid}/commit", headers=auth)
    assert c.status_code == 200
    assert c.json()["transaction_count"] == 7 and c.json()["paired_count"] == 1

    # 6. 配对生效：库里那条单腿被写上 pair_id、counterparty 被清空
    leg2 = client.get(f"/api/v1/ledgers/{ledger.id}/transactions/{leg.id}",
                      headers=auth).json()
    assert leg2["transfer_pair_id"] and leg2["counterparty"] is None
    assert [e["event"] for e in leg2["events"]] == ["paired", "created"]
    # 导入进来的交易各有一条 imported 事件
    tx = client.get(f"/api/v1/ledgers/{ledger.id}/transactions"
                    f"?import_batch_id={bid}", headers=auth).json()
    assert len(tx["items"]) == 7
    one = client.get(f"/api/v1/ledgers/{ledger.id}/transactions/{tx['items'][0]['id']}",
                     headers=auth).json()
    assert one["events"][0]["event"] == "imported"
    assert one["events"][0]["import_batch_id"] == bid

    # 7. 撤销：先 dry_run 看两个数
    dry = client.delete(f"/api/v1/ledgers/{ledger.id}/imports/{bid}?dry_run=true",
                        headers=auth).json()
    assert dry["mode"] == "revert" and dry["transaction_count"] == 7
    assert dry["orphaned_refunds"] == 0 and dry["refunds_in_batch"] == 1
    assert dry["deleted"] is False

    d = client.delete(f"/api/v1/ledgers/{ledger.id}/imports/{bid}", headers=auth)
    assert d.status_code == 200 and d.json()["deleted_transactions"] == 7
    # 配对被拆开，库里那条单腿还在
    leg3 = client.get(f"/api/v1/ledgers/{ledger.id}/transactions/{leg.id}",
                      headers=auth).json()
    assert leg3["transfer_pair_id"] is None
    # 批次整个消失（决策 §14.22，没有第三个状态）
    assert client.get(f"/api/v1/ledgers/{ledger.id}/imports/{bid}",
                      headers=auth).status_code == 404
```

其它端到端用例：

| 用例 | 断言 |
|---|---|
| 粘贴 `ok_paste_alipay.txt`（带 ``` 围栏） | 200，`source_kind='paste'`，`original_filename is None`，行数与文件上传一致 |
| `stale_version.csv` | 400 `skill_outdated`，响应带 `current_version`、`file_version`、`guide_url`；`import_batches` 表为空 |
| `bad_ragged.csv` | 400 `import_file_invalid`，`errors` 恰好两条、`line` 是 14 与 27 |
| `bad_header_extra_col.csv` | 400 `import_file_invalid`，错误文案点名 `counterparty` |
| 3 MB 文件 | 413 `file_too_large` |
| `bad_2001_rows.csv` | 400 `rows_exceed_limit` |
| 1 小时内第 11 批 | 429 `import_rate_limited` |
| 归档账户作为目标 | 409 `source_archived` |
| 别的账本的成员访问本批次 | 404 |
| `committed` 批次 `PATCH .../rows` | 409 `batch_not_ready` |
| 全部行标 `skipped` 后 commit | 409 `rows_all_skipped` |
| 批量 `PATCH .../rows` 设分类 12 行 | 200，`updated=12`，12 行的 `status` 都变 `edited` |
| 批量 `PATCH .../rows` 里混一个别的批次的 `row_id` | 400，一行都没改 |
| 批量 `PATCH` 传 `counterparty` | 400（批量不接受逐行关联字段） |
| `GET .../rows?filter=uncategorized` | 只回没有一级分类的非转账、非 skipped 行；计数与 `uncategorized_count` 一致 |
| 同一批次并发两次 commit | 一次 200、一次 409 `batch_already_committed`，交易只建一遍 |
| 两个批次同时想配到同一条单腿上 | 一次成功、一次 409 `already_paired`，失败的那批仍是 `ready` |
| 提交后**不撤销**、直接重传同一份文件 | 所有行 `duplicate`；退款行因原单可退额度已为 0 而无候选，`matched_transaction_id is None`；还款行因对腿已配对而是 `duplicate` 不是 `transfer_candidate` |
| 撤销后重传同一份文件 | 新批次独立，无 `duplicate` |
| 批外退款指向本批支出，撤销 dry_run | `orphaned_refunds == 1`；真撤销后那条退款仍在、`refund_of is None` |
| 批次列表 | 每行带 `net_amount`、`flag_counts`、`source`、`created_by`（决策 §14.52 A17） |

### 7.5 不测什么

- 不测用户的 ChatGPT / Claude 整理得准不准 —— 那不在应用边界内，也没法在 CI 里跑。skill 的效果靠人工试用与 §7.1 的 fixture 反映"整理正确时长什么样"。
- 不测 CSV 库本身。切分用标准库 `csv`，只测我们的表头比对、BOM/围栏剥离与列数检查。
- §3 给的 SQL 用了 `ANY(:array)` 和 `INTERVAL`，SQLite 不支持，所以标记算法**必须**用 SQLAlchemy Core 表达式写（`col.in_()`、`between()` + Python 侧算日期偏移）。给出 SQL 只为说清逻辑。这条不是可选项。
- `scripts/gen_import_skill.py --check` 进 CI 但不算测试：它保证生成物与分类表同步（§5.4）。

---

## 待决

无。本章原有的 17 条待决全部关闭：其中与解析流水线、视觉路径、进度、文件存储、批内合并相关的条目随决策 §14.25 / §14.28 / §14.31 一并作废（对应正文已删除，不是加注保留），其余由决策 §14.7、§14.10、§14.11、§14.19、§14.22、§14.34、§14.47 逐条裁定并写进正文。

§0.2 列出的 16 个错误 code 需要出现在 [`03-backend-api.md`](./03-backend-api.md) §4.2 的注册表里（决策 §14.4）；其中 `pair_target_invalid` 与 `already_paired` 是本轮新增配对端点带来的，若 03 章最终选了别的名字，以 03 章为准并回改本章 —— 这是跨章对齐，不是待决。

---

## 另见

- [`./README.md`](./README.md) — 目标设计总览、各章导读
- [`./00-decisions.md`](./00-decisions.md) — 决策记录（唯一事实来源），本章每个决定的出处
- [`./01-domain-and-flows.md`](./01-domain-and-flows.md) — 四种 kind、退款与转账配对的语义、导入在领域流程里的位置
- [`./02-database.md`](./02-database.md) — `import_batches` / `import_rows` / `transaction_events` 的完整 DDL、`transactions` 的 CHECK 约束、迁移链
- [`./03-backend-api.md`](./03-backend-api.md) — 导入端点的请求 / 响应、`GET /import-format`、错误 code 注册表（§4.2）
- [`./04-frontend.md`](./04-frontend.md) — 导入指南页、上传 / 粘贴、review 表格与筛选、批次列表、撤销确认框
- [`./mockups/README.md`](./mockups/README.md) — 屏幕稿（屏幕 10 导入指南与上传、屏幕 03 review 表格、屏幕 11 导入历史）与视觉 token
- [`../current-design/README.md`](../current-design/README.md) — 现状总览与产品范围
- [`../current-design/03-backend-api.md`](../current-design/03-backend-api.md) — 现有后端结构与依赖版本
- [`../current-design/05-infra-and-ops.md`](../current-design/05-infra-and-ops.md) — 部署形态（本章不再需要任何上传卷或磁盘状态）
