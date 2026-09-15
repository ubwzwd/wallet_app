# 03 — 后端结构与接口定义（目标设计）

> **本文回答什么问题：** v3.0 的 FastAPI 服务由哪些模块组成、每个模块暴露哪些公共函数；配置项有哪些、默认值是什么、`.env.example` 要加哪几行；鉴权与"账本成员"授权怎么做、什么时候返回 404 什么时候返回 403；统一的错误体、分页、乐观并发、日期与金额序列化约定是什么；`00-decisions.md` §11 里的**每一个**端点接受什么、返回什么、有哪些错误码、会写哪些表；汇率函数的签名与回退算法；交易操作记录怎么写；限流、安全与测试计划。
>
> 本文只展开 [`00-decisions.md`](./00-decisions.md) 里已经拍板的决定，每个设计点都标注了来源（形如 `（决策 §1.2）`）。决策没覆盖到的问题一律进文末的 `## 待决`，不在正文里自行拍板。现状（as-is）以 [`../current-design/03-backend-api.md`](../current-design/03-backend-api.md) 为准，引用现有代码用 `path:line` 格式，行号已在本工作树核对。

阅读前提：读者没看过这个仓库。全部路径相对于仓库根目录。技术栈沿用现状：FastAPI 0.109.2 + SQLAlchemy 2.0.44 + Alembic + PostgreSQL 15（测试用 SQLite），汇率来自 Frankfurter。

> **修订说明（2026-09-11 版）**：本版按 [`00-decisions.md`](./00-decisions.md) §14.20–§14.52 整体改写，属于**删旧立新**，不是加注：
>
> - **应用不接入 LLM**（决策 §14.25、§5、§6）。模型设置的四个端点、批次重试端点、页面图端点三组路由删除；模型客户端、提示词、密钥加密与它的配置项、上传落盘目录与它的配置项、后台任务与线程池、启动恢复、同账本导入互斥、重启中断的失败 code、解析进度轮询全部从正文删除，不留"已作废"的旧文。
> - **导入端点改为同步、只收 CSV**（决策 §5、§14.30、§14.47）：`POST /ledgers/{id}/imports` 同步校验，成功 201 直接返回批次和全部草稿行；结构错误 400 按行号列出（缺 `# version:` 行也算结构错误）；版本行存在但与当前分类表版本不符 400 `skill_outdated`（决策 §14.53d）。批次状态只有 `ready → committed`。
> - **新增端点**：`GET /config`（§14.46）、`GET /import-format`（§6）、`POST .../transactions/{tid}/pair` 与 `POST .../transactions/transfer/{pair_id}/unpair`（§14.34）、`DELETE /ledgers/{id}/invites/{code}`（§14.52 A2）、`PATCH .../imports/{bid}/rows` 批量端点（§14.52 A4）。
> - **屏幕稿审阅后的裁定**（§14.47–§14.52）：账户类型四种且币种创建后不可改、加 `archived_at`、账户列表给资产 / 负债 / 净资产三个合计并排除归档账户；金额区间筛选按基准币种折算比较、列表返回 `summary`；交易详情返回 `events[]`、`refunds[]`、展开的 `refund_of`、所用汇率；新表 `transaction_events` 与请求头 `X-Client`；撤销导入的 `dry_run` 返回两个计数；趋势只回支出。
> - `§4.2` 的 code 清单仍是全仓库**唯一的错误 code 注册表**（决策 §14.4）：01 / 04 / 05 章引用的每个 code 都必须能在这里找到。本版删除了八个 code（分六类：三个 `llm_` 开头的、重启中断的那个 500、`batch_not_failed`、`import_in_progress`、`invite_used`，以及只收 CSV 之后不再需要的那个文件类型 code；逐条见 §4.2 末尾），把 `rows_exceed_limit` 从 422 改成 400，新增了 `skill_outdated`、`import_format_invalid`、`pair_invalid`、`unpair_invalid`、`currency_locked`、`repayment_target_not_credit`。
> - auth 路由下的 `me` 别名（GET / PATCH 两条）与 `default_source_id` 按决策 §14.42「不做向后兼容」直接删除，`/me` 是唯一入口，并新增 `display_name`（§14.40）。

---

## 0. 与现状的差异总览

现状一共 20 条注册路由（`backend/app/main.py:27-30` 挂了四个路由器）。目标是 **47 条业务路由**，其中 **5 条沿用现状路径**（3 条原样保留、2 条保留并增强）、**9 条改前缀**、**33 条新增**；另删除标签相关的全部行为，以及现状 auth 路由下的 `me` 两条别名（决策 §14.42：不保留别名）。下表的"变化"列可逐行核对这三个桶。

| # | 现状端点 | 目标端点 | 变化 | 说明 |
|---|---|---|---|---|
| 1 | `POST /api/v1/auth/register` | `POST /api/v1/auth/register` | 保留 + 增强 | 受 `REGISTRATION_OPEN` 控制；注册时自动建默认账本（决策 §2、§9） |
| 2 | `POST /api/v1/auth/login` | `POST /api/v1/auth/login` | 保留 + 增强 | 增加同 IP 每分钟 10 次限流（决策 §9） |
| 3 | — | `GET /api/v1/me` | 新增 | 决策 §11「我」组；含 `display_name`（决策 §14.40） |
| 4 | — | `PATCH /api/v1/me` | 新增 | 默认币种、语言、显示名（决策 §11、§14.40） |
| 5 | — | `GET /api/v1/categories` | 新增 | 公开、带 `version`、`Cache-Control: immutable`（决策 §1.3、§11） |
| 6 | — | `GET /api/v1/config` | 新增 | 公开、`{registration_open}`，注册页提前判断（决策 §14.46） |
| 7 | — | `GET /api/v1/import-format` | 新增 | 公开、标准 CSV 格式说明 + 示例 + skill 文本 + `version`（决策 §6） |
| 8 | — | `GET /api/v1/ledgers` | 新增 | 决策 §2；**不含净资产**（决策 §14.52 A16） |
| 9 | — | `POST /api/v1/ledgers` | 新增 | 每人最多 10 本（决策 §2） |
| 10 | — | `GET /api/v1/ledgers/{id}` | 新增 | 带交易 / 账户 / 批次计数，供删除前确认（决策 §14.52 A22） |
| 11 | — | `PATCH /api/v1/ledgers/{id}` | 新增 | owner；改名 / 基准币种（决策 §2） |
| 12 | — | `DELETE /api/v1/ledgers/{id}` | 新增 | owner；级联删账户、交易、导入（决策 §2） |
| 13 | — | `GET /api/v1/ledgers/{id}/members` | 新增 | 带 `display_name`（决策 §14.40） |
| 14 | — | `DELETE /api/v1/ledgers/{id}/members/{user_id}` | 新增 | owner 移除成员 |
| 15 | — | `POST /api/v1/ledgers/{id}/leave` | 新增 | member 自行退出；owner 必须先转让 |
| 16 | — | `POST /api/v1/ledgers/{id}/transfer-ownership` | 新增 | |
| 17 | — | `POST /api/v1/ledgers/{id}/invites` | 新增 | 6 位数字码、10 分钟过期、一次性（决策 §2、§14.29） |
| 18 | — | `DELETE /api/v1/ledgers/{id}/invites/{code}` | 新增 | owner 主动作废未用的码（决策 §14.52 A2） |
| 19 | — | `POST /api/v1/ledgers/join` | 新增 | 端点级全局 1 QPS（决策 §14.35） |
| 20 | `GET /api/v1/finance-sources` | `GET /api/v1/ledgers/{id}/sources` | 改前缀 + 增强 | 挂账本；每行带 `balance` / `balance_base`；响应带资产 / 负债 / 净资产三个合计（决策 §3、§7、§14.2、§14.50） |
| 21 | `POST /api/v1/finance-sources` | `POST /api/v1/ledgers/{id}/sources` | 改前缀 + 增强 | 新增 `opening_balance`；`type` 四选一（决策 §3、§14.48） |
| 22 | `GET /api/v1/finance-sources/{source_id}` | `GET /api/v1/ledgers/{id}/sources/{sid}` | 改前缀 | |
| 23 | `PATCH /api/v1/finance-sources/{source_id}` | `PATCH /api/v1/ledgers/{id}/sources/{sid}` | 改前缀 + 增强 | 带 `updated_at` 乐观并发；**`default_currency` 不可改**（决策 §14.50）；归档写 `archived_at` |
| 24 | — | `DELETE /api/v1/ledgers/{id}/sources/{sid}` | 新增 | 有交易只能归档不能删（决策 §3） |
| 25 | `GET /api/v1/transactions` | `GET /api/v1/ledgers/{id}/transactions` | 改前缀 + 重写 | 参数按决策 §4；返回 `{items, total, summary}`；支持 `import_batch_id`（决策 §14.46、§14.49、§14.52 A14） |
| 26 | `POST /api/v1/transactions` | `POST /api/v1/ledgers/{id}/transactions` | 改前缀 + 重写 | 新增 `kind`、分类、`refund_of`、单腿转账字段（决策 §1） |
| 27 | `GET /api/v1/transactions/{transaction_id}` | `GET /api/v1/ledgers/{id}/transactions/{tid}` | 改前缀 + 重写 | 详情带 `refunds[]`、展开的 `refund_of`、`events[]`、所用汇率（决策 §14.46、§14.51、§14.52 A24/A25） |
| 28 | `PATCH /api/v1/transactions/{transaction_id}` | `PATCH /api/v1/ledgers/{id}/transactions/{tid}` | 改前缀 + 重写 | 乐观并发；写 `transaction_events`；两腿转账的腿走此接口返回 409 |
| 29 | `DELETE /api/v1/transactions/{transaction_id}` | `DELETE /api/v1/ledgers/{id}/transactions/{tid}` | 改前缀 + 重写 | 不再"删一腿连带删对腿"，两腿必须走 transfer 接口 |
| 30 | — | `POST /api/v1/ledgers/{id}/transactions/transfer` | 新增 | 一次事务建两腿（决策 §1.2） |
| 31 | — | `PATCH /api/v1/ledgers/{id}/transactions/transfer/{pair_id}` | 新增 | 一起改两腿 |
| 32 | — | `DELETE /api/v1/ledgers/{id}/transactions/transfer/{pair_id}` | 新增 | 一起删两腿 |
| 33 | — | `POST /api/v1/ledgers/{id}/transactions/{tid}/pair` | 新增 | 两条单腿转账配对成一笔（决策 §14.34） |
| 34 | — | `POST /api/v1/ledgers/{id}/transactions/transfer/{pair_id}/unpair` | 新增 | 拆开，两腿各自变回单腿（决策 §14.34） |
| 35 | — | `GET /api/v1/ledgers/{id}/stats/summary` | 新增 | 决策 §7 |
| 36 | — | `GET /api/v1/ledgers/{id}/stats/trend` | 新增 | 只回支出（决策 §7、§14.52 B20） |
| 37 | — | `POST /api/v1/ledgers/{id}/imports` | 新增 | **同步校验**：multipart CSV 文件或 JSON 体粘贴 CSV 文本，201 直接返回批次与草稿行（决策 §5） |
| 38 | — | `GET /api/v1/ledgers/{id}/imports` | 新增 | 批次列表，带净额 / 标记数 / 目标账户 / 上传人（决策 §14.52 A17） |
| 39 | — | `GET /api/v1/ledgers/{id}/imports/{bid}` | 新增 | 单个批次 |
| 40 | — | `GET /api/v1/ledgers/{id}/imports/{bid}/rows` | 新增 | 草稿行分页，带 review 内筛选（决策 §14.52 A4） |
| 41 | — | `PATCH /api/v1/ledgers/{id}/imports/{bid}/rows/{rid}` | 新增 | 改单条草稿行 |
| 42 | — | `PATCH /api/v1/ledgers/{id}/imports/{bid}/rows` | 新增 | 批量设分类 / 批量跳过（决策 §14.52 A4） |
| 43 | — | `POST /api/v1/ledgers/{id}/imports/{bid}/commit` | 新增 | 单事务建全部交易，无请求体（决策 §14.18） |
| 44 | — | `DELETE /api/v1/ledgers/{id}/imports/{bid}` | 新增 | `ready` = 丢弃；`committed` = 撤销（整批删除，决策 §14.22） |
| 45 | `GET /api/v1/rates/currencies` | `GET /api/v1/rates/currencies` | 保留 | |
| 46 | `GET /api/v1/rates/latest` | `GET /api/v1/rates/latest` | 保留 + 修正 | `date` 改为上游汇率日期而不是服务器日期 |
| 47 | `POST /api/v1/rates/convert` | `POST /api/v1/rates/convert` | 保留 + 修正 | 只发一次上游请求；`date` 同上 |
| — | 现状 auth 路由下的 `me` 别名（GET 与 PATCH 两条） | **删除** | 删除 | `/me` 是唯一入口，不保留别名（决策 §14.42） |
| — | `?tag=` 筛选、请求/响应里的 `tags` 字段 | **删除** | 删除 | `transaction_tags` 表与标签输入框全部移除（决策 §1.3） |

按决策 §11 的分组核对端点数：认证 2 + 我 2 + 分类 1 + 配置 1 + 导入格式 1 + 账本 12 + 账户 5 + 交易 10 + 统计 2 + 导入 8 + 汇率 3 = **47**。

除路由外的行为差异（都在后面章节展开）：

| 主题 | 现状 | 目标 | 决策 |
|---|---|---|---|
| 归属判定 | 每张表带 `user_id`，按 `user_id == current_user.id` 过滤 | 每张业务表带 `ledger_id`，按"当前用户是该账本成员"过滤 | §2 |
| 错误体 | `{"detail": "..."}` 或 FastAPI 的 422 数组 | 统一 `{"detail": "...", "code": "snake_case"}` | §9 |
| 列表响应 | 裸数组、无总数（`../current-design/06-known-issues.md` H-07） | `{"items": [...], "total": n}`（交易列表另加 `summary`） | §4、§14.52 A14 |
| 汇率 | 两套互相矛盾的公式，永远用当天汇率（H-02） | 一个函数；交易用发生日、余额用最新；缺行情回退最近交易日 | §8 |
| 转账 | 前端发两次 POST 自己配对，后端一无所知（H-01） | 服务端 transfer 接口，一个事务两腿；另有配对 / 拆开两个端点 | §1.2、§14.34 |
| 并发 | 无版本检查，后写覆盖先写 | PATCH 带 `updated_at`，不一致 409 `stale_update` | §2 |
| 账单导入 | 无 | 用户在自己的 ChatGPT / Claude 里用 skill 生成标准 CSV，上传后**同步**校验、review、提交；应用不调任何大模型 | §5、§6、§14.25 |
| 文件上传 | 没有任何 `File` / `Form` 用法 | multipart 上传标准 CSV，≤2 MB、≤2000 行，**不落盘** | §5、§14.28 |
| 操作留痕 | 只有 `created_by` | 每次改交易追加一条 `transaction_events` | §14.51 |

---

## 1. 应用结构

### 1.1 目标模块图

```text
backend/
  app/
    main.py                    FastAPI 实例、CORS、路由挂载、统一异常处理器、/health、/
    core/
      config.py                Settings（pydantic-settings）+ 模块级单例 settings
      database.py              engine、SessionLocal、Base、get_db（沿用现状）
      security.py              bcrypt 封装、JWT 签发/解码、HTTPBearer、get_current_user（沿用现状）
      deps.py          [新]    get_ledger_member、require_owner、pagination、client_name
      errors.py        [新]    ApiError 异常类 + ErrorCode 常量 + 异常处理器
      categories.py    [新]    冻结的分类常量表（含一级说明文字）+ 校验/查表函数（决策 §1.3）
      ratelimit.py     [新]    进程内令牌桶（决策 §14.43）
    api/
      auth.py                  /auth/register、/auth/login（见 §5.1-§5.2）
      me.py            [新]    /me（GET / PATCH）
      categories.py    [新]    /categories
      config.py        [新]    /config（公开，决策 §14.46）、/import-format（公开，决策 §6）
      ledgers.py       [新]    /ledgers、/ledgers/{id}、成员、邀请、join
      finance_sources.py [重写] /ledgers/{id}/sources（改为账本前缀，带余额与三个合计）
      transactions.py  [重写]  /ledgers/{id}/transactions + /transactions/transfer + pair / unpair
      stats.py         [新]    /ledgers/{id}/stats/summary、/trend
      imports.py       [新]    /ledgers/{id}/imports 全组（全部同步，无后台任务）
      rates.py                 /rates/currencies、/rates/latest、/rates/convert（保留）
    schemas/
      common.py        [新]    Page[T]、ErrorBody、OptimisticBase
      user.py          [改]    UserCreate/Login/Response/Update、Token（含 display_name）
      category.py      [新]    CategoryNode、CategoryTable
      ledger.py        [新]    LedgerCreate/Update/Response、MemberResponse、InviteResponse、JoinRequest
      finance_source.py [改]   SourceCreate/Update/Response、SourceListResponse（含三个合计）
      transaction.py   [重写]  TransactionCreate/Update/Response、TransferCreate/Update、
                               PairRequest、TransactionEventResponse、TransactionSummary
      stats.py         [新]    SummaryResponse、TrendResponse
      import_.py       [新]    ImportBatchResponse、ImportRowResponse、ImportRowUpdate、
                               ImportRowsBulkUpdate、CommitResult、ImportFormatResponse
      currency.py              CurrencyCode、CurrencyList、ExchangeRateResponse、ConversionRequest/Result（保留）
    services/
      fx.py            [新]    统一汇率换算（取代现状 services/rates.py 的两套公式）
      rates_client.py  [改名]  Frankfurter HTTP 客户端（现状 backend/app/services/rates.py 的网络部分）
      importing/       [新]    账单导入包（决策 §14.27，四个模块，没有抽取器目录；
                               算法与标准格式详见 ./05-import-and-llm.md）：
                               reader.py（读文件 / 读粘贴文本、解码、拆 CSV）、
                               validate.py（结构校验 + 行级校验与 hint）、
                               flagging.py（duplicate / refund_candidate / transfer_candidate / needs_review）、
                               commit.py（提交建交易、撤销整批删除）
      events.py        [新]    transaction_events 的追加与查询（决策 §14.51）
      stats.py         [新]    汇总、趋势、账户余额与资产 / 负债 / 净资产的 SQL 聚合
      ledger_service.py [新]   账本 / 成员 / 邀请码的业务逻辑
    models/                    User、Ledger、LedgerMember、LedgerInvite、FinanceSource、
                               Transaction、TransactionEvent、ImportBatch、ImportRow、ExchangeRate
                               （表结构见 ./02-database.md）
  scripts/
    reset_password.py  [新]    管理员重置密码（决策 §9）
    gen_import_skill.py [新]   从 core/categories.py 生成 skills/wallet-import/ 的 skill 文本与示例 CSV（决策 §6）
  migrations/                  Alembic，新链条接在 head 8a4f4d66d893 之后（决策 §13）
  tests/                       pytest（§10）
skills/
  wallet-import/       [新]    交付给用户装进自己 ChatGPT / Claude 的 skill（决策 §6），
                               由 gen_import_skill.py 生成，`GET /import-format` 下发同一份文本
```

删除的模块（相对上一版目标设计）：`backend/app/models/transaction_tag.py`（决策 §1.3 移除标签）、模型设置表对应的 model 与 schema、`backend/app/core/crypto.py`、`backend/app/services/llm_client.py`、以及 `backend/app/services/importing/` 下的流水线、落盘、抽取器、分块器与模型调用五个子模块（决策 §14.25、§14.27、§14.28）。应用没有任何文件系统状态。

### 1.2 各模块职责与公共函数签名

下面列的是**目标**签名，全部是新写或重写的代码，不是对现有代码的描述。

#### `core/errors.py`

```python
class ErrorCode:
    VALIDATION_ERROR = "validation_error"
    NOT_FOUND = "not_found"
    FORBIDDEN = "forbidden"
    UNAUTHORIZED = "unauthorized"
    STALE_UPDATE = "stale_update"
    # …完整清单见 §4.2

class ApiError(Exception):
    def __init__(self, status_code: int, code: str, detail: str) -> None: ...

def install_error_handlers(app: FastAPI) -> None:
    """注册三个处理器：ApiError、HTTPException、RequestValidationError，
    保证任何错误响应体都是 {"detail": str, "code": str}（§4.1）。"""
```

#### `core/deps.py`

```python
@dataclass(frozen=True)
class LedgerContext:
    ledger: Ledger
    member: LedgerMember          # role 为 "owner" 或 "member"
    user: User

def get_ledger_member(
    id: UUID = Path(...),                       # 路径里的 {id} 就是 ledger_id
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> LedgerContext:
    """账本存在且当前用户是成员 → 返回上下文；否则一律 404 not_found（§3.3）。"""

def require_owner(ctx: LedgerContext = Depends(get_ledger_member)) -> LedgerContext:
    """ctx.member.role != "owner" → 403 not_owner。"""

@dataclass(frozen=True)
class Pagination:
    limit: int      # 1..200，默认 50（决策 §14.44 的 03-14）
    offset: int     # >= 0，默认 0

def pagination(limit: int = Query(50, ge=1, le=200),
               offset: int = Query(0, ge=0)) -> Pagination: ...

def client_name(x_client: str | None = Header(None, alias="X-Client")) -> str | None:
    """请求头 X-Client 的值，写进 transaction_events.client（决策 §14.51）。
    ≤ 16 字符、只留可打印 ASCII，超长截断，缺头返回 None。（同步 2026-09-12：与 02 §1.9 的 transaction_events.client VARCHAR(16) 对齐）"""
```

#### `core/categories.py`（决策 §1.3）

```python
CATEGORY_VERSION: str = "2026-09-10"      # 分类表内容的版本号；改常量必须改它，
                                          # 也是 skill 输出的 "# version:" 行与导入硬校验的依据（决策 §14.30）

@dataclass(frozen=True)
class Category:
    code: str
    name_zh: str
    name_en: str
    desc_zh: str | None = None            # 归类判据说明；只有一级有，二级恒为 None（决策 §14.21）
    desc_en: str | None = None
    children: tuple["Category", ...] = ()

EXPENSE_CATEGORIES: tuple[Category, ...]   # 16 个一级，见决策 §1.3 的冻结表
INCOME_CATEGORIES: tuple[Category, ...]    # 6 个一级

def category_side(l1_code: str) -> Literal["expense", "income"] | None:
    """一级 code 属于支出侧还是收入侧；不存在返回 None。"""

def validate_category(kind: str, l1: str | None, l2: str | None) -> None:
    """按决策 §1.3 校验：transfer 必须两个都为 None；其他 kind 必须有 l1；
    l1 在表内；l2 属于该 l1；l1 的收支侧与 kind 匹配（expense/refund→支出侧，income→收入侧）。
    不通过抛 ApiError(400, category_invalid | category_kind_mismatch, …)。"""

def category_table() -> dict:
    """GET /categories 的响应体（§5.5），也是 skill 文本里分类清单的来源。"""

def render_skill_categories(lang: str = "zh") -> str:
    """给 scripts/gen_import_skill.py 与 GET /import-format（§5.7）用：
    把分类表压成 skill 文本里的一段列表，一级行带 desc_zh 作判据（决策 §6、05 §5）。"""
```

`desc_zh` / `desc_en` 写的是这一级的归类判据和易混淆项的去向（逐字见决策 §1.3 的说明文字表），三个用途共用同一份常量：`GET /categories` 下发给前端选分类时显示（§5.5、04 §4.6/§4.11）、统计页一级分类名的提示（04 §4.4，前端从分类缓存按 code 取，统计接口不下发）、`render_skill_categories()` 注入 skill 文本作判据（决策 §6、05 §5）。它们**与分类表一起冻结**——改名字、改二级、改说明文字，任何一种都必须同时递增 `CATEGORY_VERSION`：否则前端的永久缓存不会失效，而且用户手上的旧 skill 会生成一份带旧版本号的 CSV，导入时才被 `skill_outdated` 拦下（决策 §1.3、§14.21、§14.30）。

#### `core/ratelimit.py`（决策 §14.43 的 03-8）

```python
@dataclass(frozen=True)
class Limit:
    capacity: int          # 桶容量 = 允许的突发次数
    refill_seconds: float  # 装满一整桶所需秒数

def check(bucket: str, key: str, limit: Limit) -> None:
    """进程内令牌桶。取不到令牌时抛 ApiError(429, <bucket 对应的 code>, …)，
    并在异常里带 Retry-After 秒数。登录、注册、加入账本、导入四处共用这一个组件
    （进程内、重启清零、单实例，决策 §14.43）。"""

def reset(bucket: str, key: str) -> None:
    """成功后清零（如登录成功）。测试也用它做隔离。"""

def reset_all() -> None:
    """清空所有桶；测试 fixture 用。"""
```

`POST /ledgers/join` 用的是**全局**桶（`key` 是固定串 `"global"`，不是用户 id），`Limit(capacity=3, refill_seconds=3)` 即 1 QPS、突发 3（决策 §14.35）。

#### `services/fx.py`（决策 §8，详见 §6）

```python
def convert(amount: Decimal, currency: str, to_currency: str, on: date
            ) -> tuple[Decimal, Decimal, date]:
    """返回 (amount_base, rate_used, rate_date)。currency == to_currency 时
    返回 (amount, Decimal("1"), on)。缺行情回退到最近一个已公布交易日（§6.2）。"""

def latest_rate(currency: str, to_currency: str) -> tuple[Decimal, date]:
    """最新可用汇率与其日期，用于账户余额折算（决策 §8）。"""

def convert_many(items: Sequence[tuple[Decimal, str, date]], to_currency: str
                 ) -> list[tuple[Decimal, Decimal, date]]:
    """批量版本：一次查出日期区间内所有需要的汇率再逐条算，避免 N+1（§6.3）。
    交易列表的金额区间筛选（决策 §14.49）也走它。"""

def warm_cache(currencies: Iterable[str], base: str, start: date, end: date) -> None:
    """把区间内缺失的汇率从 Frankfurter 拉回并 upsert 进 exchange_rates 缓存表；
    已有的行不动（历史汇率一经公布不再变，决策 §14.1）。"""
```

#### `services/importing/`（决策 §5、§14.27；标准格式、校验规则与标记算法详见 [`./05-import-and-llm.md`](./05-import-and-llm.md)）

四个模块，**没有抽取器、没有分块器、没有 LLM 客户端**（决策 §14.25、§14.27）：

```python
# importing/reader.py
def read_csv_text(raw: bytes | str) -> str:
    """multipart 文件的字节或 JSON 体里的粘贴文本 → 文本。
    UTF-8（允许 BOM）解码失败抛 ApiError(400, import_format_invalid, …)。
    两个入口（上传 / 粘贴）在这里汇合，后面的路径完全相同（决策 §5）。"""

def parse_standard_csv(text: str) -> tuple[str, list[RawRow]]:
    """拆出首行 "# version: <日期串>" 与 11 列固定表头，返回 (version, 原始行)。
    缺 version 行、表头不符、某行列数不对 → 抛 ApiError(400, import_format_invalid, …)，
    detail 里按行号列出（§5.37）。"""

# importing/validate.py
def validate_rows(ctx: ImportContext, rows: list[RawRow]) -> list[DraftRow]:
    """行级校验：不丢行、只改值并写 hint（决策 §5）。
    date / amount / currency / kind / 分类 五类问题的处理规则见 05 §2。"""

# importing/flagging.py
def flag_rows(db: Session, ctx, rows: list[DraftRow]) -> None:
    """打四种标记：duplicate、refund_candidate、transfer_candidate、needs_review
    （决策 §5、§14.31、§14.34）。批内完全相同的行都保留、都打 needs_review，
    hint 写"本批内有相同的行（第 N 行）"，不合并（决策 §14.31）。"""

# importing/commit.py
def commit_batch(db: Session, batch_id: UUID, actor_id: UUID, client: str | None) -> CommitResult:
    """一个事务内把所有非 skipped 行建成交易（两腿转账一起建、配对行与已有单腿共用
    新的 transfer_pair_id），每条交易写一条 transaction_events(event='imported')。"""

def delete_batch(db: Session, batch_id: UUID, actor_id: UUID,
                 dry_run: bool = False) -> DeleteResult:
    """§5.44 的实现：committed 时先删这批建的交易再删批次（撤销 = 整批删除，
    决策 §14.22），ready 时直接删批次（丢弃）；dry_run 只回条数，含
    orphaned_refunds 与 refunds_in_batch 两个计数（决策 §14.43 的 03-9、§14.52 B24）。"""
```

#### `services/stats.py`（决策 §7）

```python
def summary(db: Session, ledger: Ledger, month: date) -> dict:
    """按一级分类汇总当月 expense / income（退款按退款日期冲减对应分类），
    转账不计入；金额折算到账本基准币种。某分类冲成负数照实返回（决策 §14.44 的 03-10）。"""

def trend(db: Session, ledger: Ledger, months: int, end: date) -> dict:
    """最近 N 个月的**支出**（首页只放支出，决策 §14.52 B20）。"""

def source_balances(db: Session, ledger: Ledger) -> dict[UUID, tuple[Decimal, Decimal]]:
    """每个账户的 (balance 账户币种, balance_base 账本基准币种)。
    balance 按决策 §14.2：opening_balance + Σ convert(amount, tx.currency -> 账户币种, 发生日)；
    balance_base 用最新汇率折算（决策 §8）。见 §5.20。"""

def net_worth(db: Session, ledger: Ledger) -> dict:
    """资产 / 负债 / 净资产三个数（决策 §14.50）：
    assets     = Σ balance_base（type != 'credit' 且 archived_at IS NULL）
    liabilities= Σ balance_base（type == 'credit' 且 archived_at IS NULL，通常为负）
    net_worth  = assets + liabilities
    归档账户一律不计入。"""

def list_summary(db: Session, ledger: Ledger, where) -> dict:
    """交易列表的 summary：在**全部筛选结果**（不分页）上算支出 / 收入 / 净额，
    转账不计入净额（决策 §14.52 A14）。"""
```

#### `services/events.py`（决策 §14.51）

```python
def record(db: Session, *, ledger_id: UUID, transaction_id: UUID, actor_id: UUID,
           event: Literal["created", "updated", "imported", "paired", "unpaired",
                          "refund_linked", "refund_unlinked"],
           changes: dict[str, dict] | None = None,
           import_batch_id: UUID | None = None,
           client: str | None = None) -> None:
    """在同一个事务里追加一条 transaction_events。只追加、不修改、不删除
    （交易被删时由外键级联删掉它的事件）。changes 是 {字段: {"before": …, "after": …}}。"""

def list_for(db: Session, transaction_id: UUID) -> list[dict]:
    """按 at DESC 返回该交易的全部事件，供 GET /transactions/{tid} 的 events[]（§5.27）。"""
```

#### `services/ledger_service.py`（决策 §2）

```python
def create_ledger(db: Session, user: User, name: str, base_currency: str) -> Ledger: ...

def create_default_ledger(db: Session, user: User) -> Ledger:
    """注册时调用；名字 "我的账本"，base_currency = users.base_currency。"""

def issue_invite(db: Session, ledger: Ledger, actor: User) -> LedgerInvite:
    """先删掉本账本所有 expires_at <= now() 的行（懒清理，决策 §14.29），
    再摇一个 6 位码：只与**当前仍有效**的码查重，撞上就重摇（不建全表唯一索引）。
    有效期 10 分钟、一次性。"""

def revoke_invite(db: Session, ledger: Ledger, code: str) -> None:
    """owner 主动作废：DELETE ledger_invites WHERE ledger_id AND code（决策 §14.52 A2）。"""

def redeem_invite(db: Session, user: User, code: str) -> Ledger:
    """只在 expires_at > now() 的行里查；顺手删掉查到的过期行。
    校验不是已有成员、人数未超限，同一事务内写成员并**删除**该邀请码行
    （表里永远只有有效的码，没有 used_by / used_at，决策 §14.29）。"""

def transfer_ownership(db: Session, ledger: Ledger, to_user_id: UUID) -> None: ...

def remove_member(db: Session, ledger: Ledger, user_id: UUID) -> None: ...
```

### 1.3 路由挂载

`main.py` 里挂十个路由器，前缀仍硬编码为 `"/api/v1"`（现状写法见 `backend/app/main.py:27-30`）；`settings.API_V1_PREFIX` 依旧不参与（定义在 `backend/app/core/config.py:20`），本设计不改这一点。

| 路由器 | 子前缀 | OpenAPI tag |
|---|---|---|
| `auth` | `/auth` | Authentication |
| `me` | `/me` | Me |
| `categories` | `/categories` | Categories |
| `config` | `/config`、`/import-format` | Public Config |
| `ledgers` | `/ledgers` | Ledgers |
| `finance_sources` | `/ledgers/{id}/sources` | Finance Sources |
| `transactions` | `/ledgers/{id}/transactions` | Transactions |
| `stats` | `/ledgers/{id}/stats` | Stats |
| `imports` | `/ledgers/{id}/imports` | Imports |
| `rates` | `/rates` | Currency & Exchange Rates |

路径参数命名与决策 §11 保持一致：账本 id 是 `{id}`，账户 `{sid}`，交易 `{tid}`，批次 `{bid}`，草稿行 `{rid}`，转账对 `{pair_id}`，成员 `{user_id}`，邀请码 `{code}`。

三个必须注意的声明顺序：

- `POST /api/v1/ledgers/join` 是固定段路由，必须声明在 `/{id}` 系列之前，否则 `join` 会被当成 UUID 解析而得到 422。
- `/transactions/transfer`、`/transactions/transfer/{pair_id}`、`/transactions/transfer/{pair_id}/unpair` 必须声明在 `/transactions/{tid}` 与 `/transactions/{tid}/pair` 之前，同理。
- `PATCH /imports/{bid}/rows`（批量，§5.42）必须声明在 `PATCH /imports/{bid}/rows/{rid}`（单条，§5.41）之前或之后都行——路径长度不同不会冲突，但两者要写在同一个文件里挨着，避免有人只改一个。

`/health`、`/`、`/docs`、`/openapi.json` 沿用现状（`backend/app/main.py:33-51`）。**没有 lifespan 钩子**：导入是同步的，没有需要在启动时收拾的中间状态（决策 §14.25 作废了原来的启动恢复）。

---

## 2. 配置

加载规则沿用现状（`backend/app/core/config.py:33-38`：`env_file=".env"`、`case_sensitive=True`、`extra="allow"`；优先级为真实环境变量 > `.env` > 字段默认值）。下表把现有 10 个字段和新增 10 个字段列全，新增项都标 `[新]`。

### 2.1 字段表

| 字段 | 类型 | 默认值 | 用在哪 | 决策 |
|---|---|---|---|---|
| `DATABASE_URL` | str | `postgresql://wallet_user:wallet_password@localhost:5432/wallet_db` | engine、Alembic | — |
| `SECRET_KEY` | str | 无默认，**必填**（见下） | JWT 签名 | §9 |
| `ALGORITHM` | str | `HS256` | JWT | — |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | int | `30` | 令牌有效期 | §9 |
| `API_V1_PREFIX` | str | `/api/v1` | 仍未被读取（前缀硬编码） | — |
| `PROJECT_NAME` | str | `Wallet App API` | FastAPI `title` | — |
| `DEBUG` | bool | `False` | FastAPI `debug=`、SQL echo | — |
| `ALLOWED_ORIGINS` | str（逗号分隔） | `http://localhost:8081,http://localhost:19006,http://localhost:3000` | CORS | — |
| `EXCHANGE_RATE_API_URL` | str | `https://api.frankfurter.dev/v1` | Frankfurter 基地址（默认值从 `https://api.frankfurter.app` 改过来，修复 `../current-design/06-known-issues.md` H-03 的 301 跳转问题） | §8 |
| `ENVIRONMENT` | str | `development` | `/health`、SQL echo | — |
| `REGISTRATION_OPEN` `[新]` | bool | `true` | `POST /auth/register` 的开关、`GET /config` 的返回值 | §0.5、§9、§14.46 |
| `MAX_UPLOAD_MB` `[新]` | int | `2` | 标准导入文件大小上限（纯文本 CSV，决策 §5 定为 2 MB） | §5、§9 |
| `IMPORT_MAX_ROWS` `[新]` | int | `2000` | 单批草稿行上限 | §5 |
| `FX_HTTP_TIMEOUT_SECONDS` `[新]` | float | `10` | Frankfurter 请求超时（与现状硬编码的 10 s 一致，见 `backend/app/services/rates.py:62-99`） | §8 |
| `RATE_LIMIT_LOGIN_PER_MINUTE` `[新]` | int | `10` | 同 IP 登录限流 | §9 |
| `RATE_LIMIT_REGISTER_PER_HOUR` `[新]` | int | `5` | 同 IP 注册限流 | §14.43 |
| `RATE_LIMIT_JOIN_QPS` `[新]` | float | `1` | `POST /ledgers/join` 的**全局**速率（令牌桶，突发 3） | §2、§14.35 |
| `RATE_LIMIT_IMPORTS_PER_HOUR` `[新]` | int | `10` | 每用户每小时导入批数 | §9 |
| `MAX_LEDGERS_PER_USER` `[新]` | int | `10` | 软限制 | §2 |
| `MAX_MEMBERS_PER_LEDGER` `[新]` | int | `10` | 软限制 | §2 |

`SECRET_KEY` 去掉默认值并在 `Settings` 上加校验器：值为空、或等于模板里的 `CHANGE_ME_*` 哨兵时直接在进程启动阶段抛异常退出（现状 `SECRET_KEY` 有一个可用的公开默认值，是 `../current-design/06-known-issues.md` H-08）。

**不再存在的配置项**（相对上一版目标设计）：加密密钥、上传目录、导入分块行数、模型调用超时、模型默认 base_url 五项随"应用不接入 LLM、不保存上传文件"取消（决策 §14.25、§14.28）；邀请码尝试次数与它的窗口两项随邀请码限流改为端点级 1 QPS 取消（决策 §14.35）。

### 2.2 `.env.example` 需要新增的行

`backend/env.example` 现在到第 21 行为止（`ENVIRONMENT=development`），`infra/.env.example` 到第 44 行为止（`CADDY_ACME_CA=`）。两个模板都追加下面这段，并把 `infra/.env.example:28` 的 `EXCHANGE_RATE_API_URL` 保持在 `https://api.frankfurter.dev/v1`、把 `backend/env.example:18` 从 `https://api.frankfurter.app` 改成同一个值：

```dotenv
# Registration switch (decision §0.5) — set false to close signups
REGISTRATION_OPEN=true

# Statement import (decision §5) — standard CSV only, never stored on disk
MAX_UPLOAD_MB=2
IMPORT_MAX_ROWS=2000

# Exchange rates (decision §8)
FX_HTTP_TIMEOUT_SECONDS=10

# Rate limits (decision §2, §9, §14.35, §14.43)
RATE_LIMIT_LOGIN_PER_MINUTE=10
RATE_LIMIT_REGISTER_PER_HOUR=5
RATE_LIMIT_JOIN_QPS=1
RATE_LIMIT_IMPORTS_PER_HOUR=10

# Soft limits (decision §2)
MAX_LEDGERS_PER_USER=10
MAX_MEMBERS_PER_LEDGER=10
```

`infra/.env.example` 里 `SECRET_KEY` 已经是哨兵值（`infra/.env.example:20`）。`infra/scripts/env-coverage.sh` 会自动要求每个新字段都出现在 `infra/.env.example` 里，所以漏一行就会在校验脚本上失败；反过来，上面那七个被删掉的字段也要从模板里删干净，否则脚本会报出多余字段。

**部署侧不再需要上传卷**：后端没有任何文件系统状态（决策 §14.28），`api` 容器不挂数据卷，compose 里原先给上传目录准备的命名卷一并删除。这是对 [`../current-design/05-infra-and-ops.md`](../current-design/05-infra-and-ops.md) 的一个简化请求，与 §8 里 `--proxy-headers` 的请求一起提出。

---

## 3. 鉴权与授权

### 3.1 认证（不变）

JWT 部分完全沿用现状：bcrypt 哈希（`backend/app/core/security.py:33-37`）、`create_access_token({"sub": str(user.id)})`（`backend/app/core/security.py:40-60`）、`HTTPBearer` + `get_current_user`（`backend/app/core/security.py:83-144`）。仍然没有刷新令牌、没有服务端注销、没有找回密码（决策 §9）。

两个小修正：

- 注册时口令长度上限设为 72 字节并在 schema 层拦截，避免 bcrypt 5.0.0 对超长口令抛 `ValueError` 导致 500（`../current-design/03-backend-api.md` §3.1）。
- `HTTPBearer(auto_error=True)` 在 FastAPI 0.109.2 上缺头时返回 403 `"Not authenticated"`；目标统一为 401 + `code=unauthorized`，做法是 `HTTPBearer(auto_error=False)` 自己判空后抛 `ApiError(401, "unauthorized", …)`。

### 3.2 授权：账本成员

所有 `/api/v1/ledgers/{id}/...` 端点都通过 `Depends(get_ledger_member)`（决策 §2）。它做三件事，顺序固定：

1. `SELECT ledgers WHERE id = :id`；不存在 → 404 `not_found`。
2. `SELECT ledger_members WHERE ledger_id = :id AND user_id = :me`；不是成员 → **也是** 404 `not_found`。
3. 返回 `LedgerContext(ledger, member, user)`；处理函数从 `ctx.ledger.id` 取账本 id，从 `ctx.ledger.base_currency` 取折算目标币种，从 `ctx.user.id` 填 `created_by` / `updated_by`。

需要 owner 的端点再叠一层 `Depends(require_owner)`：

| 端点 | 角色 |
|---|---|
| `PATCH /ledgers/{id}` | owner |
| `DELETE /ledgers/{id}` | owner |
| `DELETE /ledgers/{id}/members/{user_id}` | owner |
| `POST /ledgers/{id}/transfer-ownership` | owner |
| `POST /ledgers/{id}/invites` | owner |
| `DELETE /ledgers/{id}/invites/{code}` | owner |
| 其余全部账本端点 | 成员即可（owner 与 member 权限相同，决策 §2） |

子资源的二次归属检查：拿到 `sid` / `tid` / `bid` / `rid` / `pair_id` 之后，查询条件必须同时带 `ledger_id = ctx.ledger.id`。跨账本引用别人的资源一律 404，不返回 403。

### 3.3 404 与 403 的选择规则

| 情形 | 状态码 | code | 理由 |
|---|---|---|---|
| 账本不存在 | 404 | `not_found` | — |
| 账本存在但当前用户不是成员 | 404 | `not_found` | 不泄露账本是否存在（决策 §2 的"鉴权 = 当前用户是该账本成员"） |
| 子资源不存在，或存在但属于别的账本 | 404 | `not_found` | 同上 |
| 是成员但要求 owner 的操作 | **403** | `not_owner` | 账本的存在对该用户已经不是秘密，告诉他"权限不够"更有用 |
| 令牌缺失 / 无效 / 过期 | 401 | `unauthorized` | — |
| 注册被关闭 | 403 | `registration_closed` | 与身份无关的策略拒绝 |

一句话规则：**"你能不能看见这个东西"用 404，"你看得见但不能做这件事"用 403。**

---

## 4. 通用约定

### 4.1 错误体

任何非 2xx 响应的体都是（决策 §9）：

```json
{"detail": "Ledger not found", "code": "not_found"}
```

- `detail`：面向开发者的英文短句，可以带上下文；前端不直接展示它，而是按 `code` 查自己的中英文案（决策 §0.4 的双语要求，见 [`./04-frontend.md`](./04-frontend.md)）。
- `code`：稳定的 snake_case 标识，属于对外契约，改动等同破坏性变更。

422 也被改造成同一形状：`RequestValidationError` 处理器把 pydantic 的错误数组压成一句 `detail`（形如 `"body.amount: Input should be greater than 0"`），`code` 固定为 `validation_error`。原始数组放在 `detail` 之外不再返回——前端只需要知道哪个字段错了，这一点由 `detail` 的 `<loc>: <msg>` 前缀承担。

### 4.2 全局 code 清单

| code | HTTP | 触发条件 |
|---|---|---|
| `validation_error` | 422 / 400 | **422**：请求体 / 查询参数 / 路径参数不满足 pydantic schema（由 §4.1 的 `RequestValidationError` 处理器统一产出）。**400**：schema 过了、但业务层校验没过且没有更专属的 code（币种不在支持列表、金额为 0、符号与 `kind` 冲突、非转账行却带了 `transfer_role` 等）。两种情形共用这一个 code，用状态码区分：422 = 形状不对，400 = 形状对但值不合法 |
| `unauthorized` | 401 | 缺令牌、令牌无效或过期 |
| `invalid_credentials` | 401 | 登录邮箱或口令错 |
| `not_found` | 404 | 资源不存在，或对当前用户不可见（§3.3） |
| `forbidden` | 403 | 通用权限拒绝（保留给未来） |
| `not_owner` | 403 | 需要 owner 角色的操作由 member 发起 |
| `registration_closed` | 403 | `REGISTRATION_OPEN=false` 时注册 |
| `email_exists` | 409 | 注册邮箱已存在 |
| `stale_update` | 409 | PATCH 体里的 `updated_at` 与库里当前值不一致 |
| `use_transfer_endpoint` | 409 | 对有 `transfer_pair_id` 的腿调用普通交易 PATCH / DELETE |
| `ledger_limit_reached` | 409 | 建账本超过 `MAX_LEDGERS_PER_USER` |
| `member_limit_reached` | 409 | 加入后成员数超过 `MAX_MEMBERS_PER_LEDGER` |
| `already_member` | 409 | 用自己已在的账本的邀请码 |
| `owner_must_transfer` | 409 | owner 调 `/leave` 但尚未转让 |
| `cannot_remove_owner` | 409 | 移除成员时目标是 owner |
| `member_not_found` | 404 | 转让 / 移除的目标不是该账本成员 |
| `invite_invalid` | 400 | 邀请码不存在、格式不对、或已过期被清理（表里只留有效码，"不存在"与"已用掉"对外无法区分，决策 §14.29） |
| `invite_expired` | 400 | 查到的码 `expires_at <= now()`（该行同时被删除） |
| `invite_rate_limited` | 429 | `POST /ledgers/join` 超过全局 1 QPS（突发 3），带 `Retry-After`（决策 §14.35） |
| `login_rate_limited` | 429 | 同 IP 每分钟登录超过 10 次 |
| `register_rate_limited` | 429 | 同 IP 每小时注册超过 5 次（决策 §14.43 的 03-8） |
| `import_rate_limited` | 429 | 每用户每小时导入超过 10 批 |
| `source_archived` | 409 | 用已归档账户记账，或作为导入目标 |
| `source_has_transactions` | 409 | 删除有交易的账户 |
| `currency_locked` | 400 | `PATCH /sources/{sid}` 想改 `default_currency`——账户币种创建后不可改（决策 §14.50） |
| `same_source` | 400 | 两腿转账的转出账户与转入账户是同一个账户 |
| `repayment_target_not_credit` | 400 | `subtype='repayment'` 的转账，**转入腿**的账户不是 `credit` 类型（单腿的 `transfer_role='out'` 不判定，§5.26）（决策 §14.52 A11） |
| `category_invalid` | 400 | 分类 code 不在表内，或二级不属于该一级 |
| `category_kind_mismatch` | 400 | 分类的收支侧与 `kind` 不匹配 |
| `kind_change_not_allowed` | 400 | PATCH 想让 `kind` 跨越 `transfer` / 非 `transfer` 的边界（决策 §14.3） |
| `refund_target_invalid` | 400 | `refund_of` 指向的交易不在同账本、或 `kind != 'expense'` |
| `transfer_pair_incomplete` | 409 | `pair_id` 找不到恰好两腿（数据损坏时的保护） |
| `pair_invalid` | 400 | `POST .../transactions/{tid}/pair` 的两条交易不满足配对条件：不是 `kind='transfer'`、不是单腿（已有 `transfer_pair_id`）、方向相同、同一个账户、不在同一账本，或就是自己（决策 §14.34） |
| `unpair_invalid` | 409 | `POST .../transfer/{pair_id}/unpair` 的 `pair_id` 下不是恰好两腿 |
| `skill_outdated` | 400 | 导入文件的 `# version:` 行**存在**、但版本串与应用当前 `CATEGORY_VERSION` 不一致；响应里带当前版本、文件版本与"导入指南"链接（决策 §14.30、§14.53d）。**缺这一行不算版本问题**，算结构错误，见下一行 |
| `import_format_invalid` | 400 | 结构错误：不是文本 / 编码不可读、**缺 `# version:` 行**、表头与 11 列固定表头不符、某行列数不对；`errors` 按行号列出（决策 §5、§14.47、§14.53d）。只收 CSV，凡不是一份能解出 11 列的 CSV 文本，一律落在这个 code 上。判定顺序上**解码失败先于版本检查**：字符都读不出来时谈不上有没有版本行 |
| `file_too_large` | 413 | 上传超过 `MAX_UPLOAD_MB`（2 MB） |
| `rows_exceed_limit` | 400 | 数据行数超过 `IMPORT_MAX_ROWS`（2000） |
| `batch_not_ready` | 409 | 在非 `ready` 状态下改行 / 提交 |
| `batch_already_committed` | 409 | 重复 commit（幂等保护，决策 §14.18） |
| `rows_uncategorized` | 409 | commit 时仍有非转账行缺一级分类 |
| `rows_all_skipped` | 409 | commit 时所有行都被标 `skipped`，一条交易也建不出来（[`./05-import-and-llm.md`](./05-import-and-llm.md) §4.3） |
| `fx_unavailable` | 503 | 汇率上游不可用且缓存里也没有可用值 |
| `internal_error` | 500 | 未捕获异常（处理器兜底） |

这张表是**唯一注册表**（决策 §14.4）：其他章节（01 / 04 / 05）在描述错误时只能引用这里的名字，不允许另起同义名。前端的中英文案表按 code 一一对应，见 [`./04-frontend.md`](./04-frontend.md) §3.7。新增 code 等同于扩展对外契约，必须先加进这张表。

本版**删除**的 code（连同它们描述的行为一起消失，不是改名）：三个 `llm_` 开头的 code（应用不接入 LLM，决策 §14.25）；「重启中断」那个 500（没有后台解析，决策 §14.25 作废 §14.14）；`batch_not_failed`（没有 `failed` 状态、也没有重试端点）；`import_in_progress`（同步校验没有"正在解析"，也就不需要同账本互斥）；`unsupported_file`（只收 CSV，结构不对就是 `import_format_invalid`，决策 §14.53d）；`invite_used`（码用掉即删，对外表现为 `invite_invalid`，决策 §14.29）。

### 4.3 分页

所有列表端点返回同一形状（决策 §4）：

```json
{"items": [ /* … */ ], "total": 137}
```

- `total` 是**过滤后**的总行数（同样的 `WHERE`，`SELECT count(*)`），不是全表行数；前端据此算页数（修复 `../current-design/06-known-issues.md` H-07）。
- 参数固定为 `limit`（1..200，默认 50）和 `offset`（≥0，默认 0），由 `core/deps.py:pagination` 提供。超出范围返回 422 而不是像现状那样静默截断（现状把 `limit>100` 悄悄改成 100）。
- `GET /categories`、`GET /ledgers`、`GET /ledgers/{id}/members`、`GET /ledgers/{id}/sources` 数据量天然很小（分别是常量表、≤10、≤10、几十条），返回 `{items, total}` 但不接受分页参数；`total == len(items)`。
- 两处例外是在这个形状上**多加了顶层字段**，不是换了形状：`GET /ledgers/{id}/transactions` 多一个 `summary`（全部筛选结果的支出 / 收入 / 净额，决策 §14.52 A14，见 §5.25），`GET /ledgers/{id}/sources` 多 `assets` / `liabilities` / `net_worth` 三个合计（决策 §14.50，见 §5.20）。`items` / `total` 的语义不变。
- 上限的两个特例：草稿行列表 `GET .../imports/{bid}/rows` 的 `limit` 上限是 **500**（review 表格一次要看很多行），`POST /imports` 的响应**不分页**，一次给回全部草稿行（≤2000 条，决策 §14.44 的 03-14、§5.37）。

### 4.4 乐观并发（决策 §2）

`transactions`、`finance_sources`、`ledgers` 三张表带 `updated_at`。规则：

1. GET 响应里带 `updated_at`（ISO-8601 UTC）。
2. 客户端 PATCH 时**必须**在请求体里回传它看到的 `updated_at`；缺这个字段 → 422 `validation_error`。
3. 服务端在同一事务里 `SELECT ... WHERE id = :id FOR UPDATE`，比对 `updated_at` 是否与请求体完全相等（微秒级）；不等 → 409 `stale_update`。
4. 相等则应用改动，把 `updated_at` 设为 `now()`、`updated_by` 设为当前用户，提交，返回新对象（其中带新的 `updated_at`）。
5. 前端收到 409 后提示"这条记录已被他人修改，请重新加载"并重新拉取（[`./04-frontend.md`](./04-frontend.md)）。

`updated_at` 只做版本戳用，客户端不该拿它做展示。DELETE 不带版本检查：删除是幂等的终态，重复删除返回 404。

请求示例：

```json
PATCH /api/v1/ledgers/8f0f.../transactions/1c2d...
{"amount": "-42.00", "updated_at": "2026-09-08T11:20:31.442000Z"}
```

冲突响应：

```json
409
{"detail": "Transaction was modified by someone else; reload and retry", "code": "stale_update"}
```

### 4.5 序列化格式

| 类型 | JSON 形态 | 例 |
|---|---|---|
| 金额（`Decimal(18,4)`） | 字符串，固定 4 位小数 | `"-45.5000"` |
| 汇率 | 字符串，最多 8 位小数（不再像现状那样一条路径 6 位、一条路径原始精度） | `"1.08696000"` |
| 日期（`occurred_at`、`from`、`to`、`rate_date`） | `YYYY-MM-DD` | `"2026-09-01"` |
| 月份（`stats/summary` 的 `month`） | `YYYY-MM` | `"2026-09"` |
| 时间戳（`created_at`、`updated_at`、`expires_at`） | ISO-8601，UTC，带 `Z` 后缀，微秒精度 | `"2026-09-08T11:20:31.442000Z"` |
| UUID | 小写带连字符的字符串 | `"1c2d3e4f-..."` |
| 币种 | 大写三字母；请求里允许小写、服务端统一 `.upper()` | `"CNY"` |
| 枚举（`kind`、`type`、`status`、`role`…） | 小写 snake_case 字符串 | `"expense"` |

时间戳的序列化是对现状的修正：现状用 `datetime.utcnow()` 存 naive 值、序列化时不带 `Z`（`../current-design/03-backend-api.md` §4.0），客户端没法确定它是哪个时区。目标态**存储形状不变**——仍是 `TIMESTAMP WITHOUT TIME ZONE` 里的 naive UTC 值（[`./02-database.md`](./02-database.md) §7.2 给了理由：本应用没有任何按用户时区展示时刻的需求，改 `timestamptz` 要全表 ALTER 而收益为零）——但**写入一律取 UTC**、API 层序列化时一律补 `Z`，对外契约因此是明确的 UTC ISO-8601。

`occurred_at` 仍然只有日期没有时间（决策 §0.7 明确不做交易时间）。所有"今天"的判断用 UTC 日历日，与 `date.today()` 在 UTC 容器里的行为一致。

### 4.6 账本 id 在路径里

除 `/auth/*`、`/me`、`/categories`、`/config`、`/import-format`、`/rates/*`、`/ledgers`、`/ledgers/join` 之外，所有端点的第一段都是 `/api/v1/ledgers/{id}`（决策 §2）。没有"当前账本"这种服务端会话状态；前端把账本 id 放在自己的 URL 里（决策 §12）。

### 4.7 `X-Client` 请求头（决策 §14.51）

所有**会改交易的**请求都可以带一个可选的请求头 `X-Client`，值是发起端的自称，例如：

```text
X-Client: web
```

服务端把它原样写进 `transaction_events.client`（≤ 16 字符、只保留可打印 ASCII，超长截断，缺头存 `null`；同步 2026-09-12：与 02 §1.9 的 `transaction_events.client VARCHAR(16)` 对齐），交易详情的操作记录（§5.27 的 `events[]`）据此显示"在 web 上修改"。它**不参与任何鉴权或授权判断**，纯粹是留痕；缺这个头不影响任何接口的行为。前端固定发 `web`（[`./04-frontend.md`](./04-frontend.md) §3.2 的 axios 拦截器里加），将来有别的客户端再换值。

带这个头有意义的端点：`POST/PATCH/DELETE /transactions`、`POST/PATCH/DELETE /transactions/transfer`、`POST .../pair`、`POST .../unpair`、`POST .../imports/{bid}/commit`、`DELETE .../imports/{bid}`。其余端点收到它会忽略。

---

## 5. 接口逐个说明

### 5.0 本章的写法

每个端点固定给六项：方法与路径、鉴权与角色、请求（体或参数 + 校验规则）、成功响应、错误清单（状态码 + code + 触发条件）、副作用（写哪些表 / 调哪些外部服务；本版没有任何后台任务，决策 §14.25）。

所有端点都可能返回下面这三种错误，后面的错误表里不再重复：

| 状态码 | code | 条件 |
|---|---|---|
| 401 | `unauthorized` | 需要鉴权的端点缺令牌 / 令牌无效或过期 |
| 422 | `validation_error` | 请求体或参数不满足 schema |
| 500 | `internal_error` | 未捕获异常 |

示例里的 UUID 一律用 `<...>` 之外的完整占位符，方便直接复制。`{id}` 在示例里写成真实 UUID。

### 5.1 `POST /api/v1/auth/register`

鉴权：无。决策 §9（注册开关）、§2（自动建默认账本）、§14.43（注册限流）。

请求体：

| 字段 | 类型 | 必填 | 校验 |
|---|---|---|---|
| `email` | EmailStr | 是 | email-validator 语法校验；存库前 `.lower()` |
| `password` | str | 是 | 8 ≤ 长度，且 UTF-8 编码后 ≤ 72 字节 |
| `base_currency` | str | 是 | `^[A-Za-z]{3}$`，存前 `.upper()` |
| `language` | str | 否 | `zh` \| `en`，默认 `zh`（决策 §0.4） |

```json
POST /api/v1/auth/register
{"email": "alice@example.com", "password": "correct horse battery", "base_currency": "cny", "language": "zh"}

-> 201
{"access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9....", "token_type": "bearer"}
```

错误：

| 状态码 | code | 条件 |
|---|---|---|
| 403 | `registration_closed` | `REGISTRATION_OPEN=false`（前端本来就该先问 `GET /config`（§5.6）把注册表单藏起来，这里是服务端的兜底） |
| 409 | `email_exists` | 邮箱已注册（先查一次，并捕获唯一索引 `IntegrityError` 兜底并发） |
| 429 | `register_rate_limited` | 同 IP 每小时注册超过 `RATE_LIMIT_REGISTER_PER_HOUR`（5）次（§8.2） |
| 400 | `validation_error` | `base_currency` 不在 Frankfurter 支持列表里（与 §5.4、§5.9 同口径；实现同步 2026-09-12） |
| 503 | `fx_unavailable` | 校验币种时汇率上游不可用且本进程还没有币种列表缓存（注册时没有"当前币种"可放行，实现同步 2026-09-12） |

副作用（一个事务）：`INSERT users`（`display_name` 为 NULL，用户以后在个人设置里填，决策 §14.40）→ `INSERT ledgers`（名字 `我的账本`、`base_currency` = 用户填的币种、`created_by` = 该用户）→ `INSERT ledger_members`（role=`owner`）。返回令牌，前端随后调 `GET /me`。不建任何默认账户（用户自己去建）。

### 5.2 `POST /api/v1/auth/login`

鉴权：无。决策 §9（限流）。

请求体：`{"email": EmailStr, "password": str}`。

```json
POST /api/v1/auth/login
{"email": "alice@example.com", "password": "correct horse battery"}

-> 200
{"access_token": "eyJ...", "token_type": "bearer"}
```

错误：

| 状态码 | code | 条件 |
|---|---|---|
| 401 | `invalid_credentials` | 邮箱不存在或口令错（两者响应完全一致） |
| 429 | `login_rate_limited` | 同 IP 每分钟超过 `RATE_LIMIT_LOGIN_PER_MINUTE` 次（§8） |

限流键是客户端 IP（取 `X-Forwarded-For` 的第一跳，需要 uvicorn 加 `--proxy-headers`，决策 §14.44 的 03-15；否则退回 `request.client.host`）。成功登录后 `ratelimit.reset("login", ip)`。不写库。

### 5.3 `GET /api/v1/me`

鉴权：bearer。决策 §11、§14.40（`display_name`）、§14.42（`/me` 是唯一入口，auth 路由下不再注册 `me` 别名）。

```json
GET /api/v1/me
-> 200
{
  "id": "4ee1c8fa-eeac-4a08-ad9a-c4be7211a876",
  "email": "alice@example.com",
  "display_name": "Alice",
  "base_currency": "CNY",
  "language": "zh",
  "created_at": "2026-09-03T05:51:45.537326Z",
  "ledger_count": 2
}
```

- `display_name`：`VARCHAR(40) NULL`（决策 §14.40 的 03-3）。为 `null` 时前端显示邮箱 `@` 前的部分，服务端**不代为填充**——空就是空，前端知道该怎么显示（[`./04-frontend.md`](./04-frontend.md) §3.6）。
- `base_currency` 在这里只是"新建账本时的默认币种"（决策 §2），不参与任何折算。
- `ledger_count` 是给前端引导用的便利字段（一条 `count(*)`）：为 0 时进"新建 / 加入账本"引导页（决策 §14.40 的 01-8）。
- **没有** `has_llm_settings`（应用不接入 LLM，决策 §14.25），也**没有** `default_source_id`（决策 §14.42 的 03-2：这一列在迁移里直接 drop，前端改为本地记住上次使用的账户）。

错误：只有通用三项。副作用：只读。

### 5.4 `PATCH /api/v1/me`

鉴权：bearer。决策 §11（默认币种、语言）、§14.40（显示名）。

请求体（三个字段都可选，`exclude_unset` 语义；显式 `null` 默认拒绝为 422，不再像现状那样把 `null` 写进 NOT NULL 列导致 500。**`language` 与 `display_name` 是两个例外**，见下表）：

| 字段 | 类型 | 校验 |
|---|---|---|
| `base_currency` | str | `^[A-Za-z]{3}$`，`.upper()` 后必须在 Frankfurter 支持列表里，否则 400；不接受 `null` |
| `language` | `'zh' \| 'en' \| null` | 只接受这三个值。显式传 `null` 是合法的，表示**恢复「跟随系统」**（写 `users.language = NULL`，决策 §14.6） |
| `display_name` | `str \| null` | `strip()` 后 1..40 字符；显式传 `null`（或空串）表示**清空**，界面回到显示邮箱前缀（决策 §14.40） |

所以「跟随系统 → 中文 → 跟随系统」这条路是通的：前端在语言设置里选「跟随系统」就发 `{"language": null}`。

```json
PATCH /api/v1/me
{"base_currency": "usd", "language": "en", "display_name": "Alice"}

-> 200
{"id": "4ee1c8fa-...", "email": "alice@example.com", "display_name": "Alice",
 "base_currency": "USD", "language": "en",
 "created_at": "2026-09-03T05:51:45.537326Z", "ledger_count": 2}
```

错误：

| 状态码 | code | 条件 |
|---|---|---|
| 400 | `validation_error` | 币种不在支持列表（`detail` 里写清楚是哪个码） |

外观（跟随系统 / 浅色 / 深色）**不在这里**：它存在浏览器本地，不上服务器（决策 §14.52 A23），所以 `/me` 没有 `theme` 字段。

用户对象不参与乐观并发（只有他自己能改）。副作用：`UPDATE users`。

### 5.5 `GET /api/v1/categories`

鉴权：**无**（公开）。决策 §1.3、§11。

无参数。响应就是 `core/categories.category_table()`：

```json
GET /api/v1/categories
-> 200
Cache-Control: public, max-age=31536000, immutable
ETag: "2026-09-10"

{
  "version": "2026-09-10",
  "expense": [
    {"code": "food", "name_zh": "餐饮", "name_en": "Food & Dining",
     "desc_zh": "日常吃喝：堂食、外卖、咖啡奶茶、零食。旅途中的吃喝归旅游",
     "desc_en": "Everyday eating and drinking, incl. delivery, coffee, snacks. Meals on trips go under Travel",
     "children": [
      {"code": "breakfast", "name_zh": "早餐", "name_en": "Breakfast", "desc_zh": null, "desc_en": null, "children": []},
      {"code": "lunch", "name_zh": "午餐", "name_en": "Lunch", "desc_zh": null, "desc_en": null, "children": []},
      {"code": "dinner", "name_zh": "晚餐", "name_en": "Dinner", "desc_zh": null, "desc_en": null, "children": []},
      {"code": "late_snack", "name_zh": "夜宵", "name_en": "Late-night Snack", "desc_zh": null, "desc_en": null, "children": []},
      {"code": "snacks_drinks", "name_zh": "零食饮料", "name_en": "Snacks & Drinks", "desc_zh": null, "desc_en": null, "children": []}
    ]},
    {"code": "transport", "name_zh": "交通", "name_en": "Transport",
     "desc_zh": "日常出行：公交地铁、打车、加油、停车、火车飞机。旅游期间的交通归旅游",
     "desc_en": "Daily getting around. Transport during trips goes under Travel",
     "children": [
      {"code": "public_transit", "name_zh": "公交地铁", "name_en": "Public Transit", "desc_zh": null, "desc_en": null, "children": []},
      {"code": "taxi", "name_zh": "打车", "name_en": "Taxi & Ride-hailing", "desc_zh": null, "desc_en": null, "children": []},
      {"code": "fuel", "name_zh": "加油", "name_en": "Fuel", "desc_zh": null, "desc_en": null, "children": []},
      {"code": "parking", "name_zh": "停车", "name_en": "Parking", "desc_zh": null, "desc_en": null, "children": []},
      {"code": "train", "name_zh": "火车", "name_en": "Train", "desc_zh": null, "desc_en": null, "children": []},
      {"code": "flight", "name_zh": "飞机", "name_en": "Flight", "desc_zh": null, "desc_en": null, "children": []}
    ]},
    {"code": "groceries", "name_zh": "生活购物", "name_en": "Groceries & Household",
     "desc_zh": "消耗品和家里的日常运转：买菜、洗护清洁、厨房用品、纸巾垃圾袋等日用杂货。判据：用完就没了",
     "desc_en": "Consumables that keep the household running: groceries, toiletries, kitchen and household supplies. Test: it gets used up",
     "children": [
      {"code": "fresh_food", "name_zh": "买菜", "name_en": "Fresh Food", "desc_zh": null, "desc_en": null, "children": []},
      {"code": "toiletries", "name_zh": "洗护清洁", "name_en": "Toiletries & Cleaning", "desc_zh": null, "desc_en": null, "children": []},
      {"code": "kitchenware", "name_zh": "厨房用品", "name_en": "Kitchenware", "desc_zh": null, "desc_en": null, "children": []},
      {"code": "household", "name_zh": "日用杂货", "name_en": "Household Supplies", "desc_zh": null, "desc_en": null, "children": []}
    ]},
    {"code": "shopping", "name_zh": "消费购物", "name_en": "Shopping",
     "desc_zh": "耐用品和一次性大件：数码、家电、家具、行李箱工具等。判据：买一次用几年",
     "desc_en": "Durable and one-off purchases: electronics, appliances, furniture, luggage, tools. Test: bought once, used for years",
     "children": [
      {"code": "electronics", "name_zh": "数码", "name_en": "Electronics", "desc_zh": null, "desc_en": null, "children": []},
      {"code": "appliances", "name_zh": "家电", "name_en": "Appliances", "desc_zh": null, "desc_en": null, "children": []},
      {"code": "furniture", "name_zh": "家具", "name_en": "Furniture", "desc_zh": null, "desc_en": null, "children": []},
      {"code": "other_goods", "name_zh": "其他物件", "name_en": "Other Goods", "desc_zh": null, "desc_en": null, "children": []}
    ]}
    /* …其余 12 个一级支出分类，顺序与决策 §1.3 的表一致；每个一级的 desc_zh / desc_en 逐字取自决策 §1.3 的说明文字表… */
  ],
  "income": [
    {"code": "salary", "name_zh": "工资", "name_en": "Salary",
     "desc_zh": "雇主发的钱：基本工资、奖金、RSU",
     "desc_en": "From your employer: base salary, bonus, RSU",
     "children": [
      {"code": "base_salary", "name_zh": "基本工资", "name_en": "Base Salary", "desc_zh": null, "desc_en": null, "children": []},
      {"code": "bonus", "name_zh": "奖金", "name_en": "Bonus", "desc_zh": null, "desc_en": null, "children": []},
      {"code": "rsu", "name_zh": "RSU", "name_en": "RSU", "desc_zh": null, "desc_en": null, "children": []}
    ]},
    {"code": "side_income", "name_zh": "兼职", "name_en": "Side Income",
     "desc_zh": "主业之外的劳务收入",
     "desc_en": "Income from work outside your main job",
     "children": []}
    /* …其余 4 个一级收入分类… */
  ]
}
```

字段：

| 字段 | 类型 | 说明 |
|---|---|---|
| `version` | string | 分类表内容的版本号（日期串，就是 `CATEGORY_VERSION`）；同时是 `ETag`，也是导入文件首行 `# version:` 要对上的那个值（决策 §14.30） |
| `code` | string | 分类 code，全表唯一；就是 `transactions.category_l1` / `category_l2` 存的值 |
| `name_zh` / `name_en` | string | 中英显示名。分类名不进前端语言包，界面按当前语言取（04 §5.3） |
| `desc_zh` / `desc_en` | string \| null | 这一级的归类判据与易混淆项的去向（决策 §14.21）。**只有一级有值，二级恒为 `null`**；逐字取自决策 §1.3 的说明文字表 |
| `children` | array | 二级分类，结构与一级相同（`desc_*` 都是 `null`） |

约定：

- `children` 永远是数组（没有二级时为空数组），前端不需要判空。
- 一级分类的 `children` 深度固定为 1，不做三级。
- `desc_zh` / `desc_en` 在一级上**永远非空**，前端可以无条件显示；二级上永远是 `null`，不要在二级选项下面留空行（决策 §14.21）。
- `version` 是常量表内容的版本号；改了分类表——包括增删分类、改显示名、改 `desc_zh` / `desc_en`——就必须改它，前端据此判断本地永久缓存是否失效（决策 §1.3、§14.21）。
- 缓存头写 `immutable` 是安全的，因为 URL 不变而内容会变——前端的做法是启动时带 `If-None-Match: "<缓存里的 version>"` 请求一次，服务端 `version` 相同则回 304。

错误：只有 500。副作用：不查库、不调外部服务，纯常量序列化（可在进程内缓存序列化结果）。

### 5.6 `GET /api/v1/config`

鉴权：**无**（公开、匿名可读）。决策 §14.46 的 04-D-5。

无参数。给登录 / 注册页在渲染之前判断注册是否开放，免得用户填完表单才被 403 打回来。

```json
GET /api/v1/config
-> 200
Cache-Control: no-store

{"registration_open": true}
```

注册关闭时：

```json
{"registration_open": false}
```

字段：

| 字段 | 类型 | 说明 |
|---|---|---|
| `registration_open` | bool | 就是 `settings.REGISTRATION_OPEN`。前端据此把注册入口换成一句"当前不开放注册"（[`./04-frontend.md`](./04-frontend.md) §4.1） |

约定：

- **只放与身份无关、匿名可见也无所谓的开关**。任何与用户、账本相关的东西都不进这个端点。将来要加字段（比如上传上限）也必须满足这一条。
- `Cache-Control: no-store`：管理员把 `REGISTRATION_OPEN` 改成 `false` 之后，下一次打开页面就该看到新值，这里没有缓存的价值。
- 它是服务端的**提示**不是**闸门**：真正的拒绝仍由 `POST /auth/register` 的 403 `registration_closed`（§5.1）负责。

错误：只有 500。副作用：只读，不查库。

### 5.7 `GET /api/v1/import-format`

鉴权：**无**（公开）。决策 §6（"应用内导入指南页：三步说明，附 skill 文本的复制 / 下载按钮，以及标准 CSV 的示例文件"）。

无参数。这是"导入指南"页（[`./04-frontend.md`](./04-frontend.md) §4.9）的唯一数据源，也是用户把 skill 装进自己 ChatGPT / Claude 时要复制的那段文本的来源。内容全部由 `backend/app/core/categories.py` 与 `skills/wallet-import/` 生成（决策 §6：分类表与版本同源），**不查库**。

```json
GET /api/v1/import-format
-> 200
Cache-Control: public, max-age=86400
ETag: "2026-09-10"

{
  "version": "2026-09-10",
  "file": {
    "content_type": "text/csv",
    "encoding": "UTF-8（允许 BOM）",
    "max_bytes": 2097152,
    "max_rows": 2000,
    "version_line": "# version: 2026-09-10",
    "header": ["date", "amount", "currency", "kind", "transfer_role", "transfer_subtype",
               "merchant", "note", "category_l1", "category_l2", "source_ref"]
  },
  "columns": [
    {"name": "date", "required": true, "format": "YYYY-MM-DD",
     "desc_zh": "交易发生的日历日期，无时区", "desc_en": "Calendar date, no timezone"},
    {"name": "amount", "required": true, "format": "小数，支出为负、收入与退款为正、转账按 transfer_role 定号",
     "desc_zh": "原币金额", "desc_en": "Amount in the original currency"},
    {"name": "currency", "required": true, "format": "三位字母 ISO 代码",
     "desc_zh": "原币种，如 CNY / SGD", "desc_en": "ISO 4217 code"},
    {"name": "kind", "required": true, "format": "expense | income | refund | transfer",
     "desc_zh": "四种之一", "desc_en": "One of the four kinds"},
    {"name": "transfer_role", "required": false, "format": "out | in",
     "desc_zh": "只在 kind=transfer 时有值", "desc_en": "Only when kind=transfer"},
    {"name": "transfer_subtype", "required": false, "format": "plain | repayment",
     "desc_zh": "只在 kind=transfer 时有值；信用卡还款用 repayment", "desc_en": "Only when kind=transfer"},
    {"name": "merchant", "required": false, "format": "≤200 字",
     "desc_zh": "商户名，清理掉流水号等噪音", "desc_en": "Merchant name, cleaned"},
    {"name": "note", "required": false, "format": "≤500 字",
     "desc_zh": "备注；外币原值等写在这里", "desc_en": "Note; put foreign-currency values here"},
    {"name": "category_l1", "required": false, "format": "§1.3 冻结表里的一级 code",
     "desc_zh": "拿不准就留空，不要硬猜", "desc_en": "Leave empty when unsure"},
    {"name": "category_l2", "required": false, "format": "属于 category_l1 的二级 code",
     "desc_zh": "同上", "desc_en": "Same as above"},
    {"name": "source_ref", "required": false, "format": "自由文本",
     "desc_zh": "指回账单原文位置，便于核对", "desc_en": "Pointer back into the statement"}
  ],
  "sample_csv": "# version: 2026-09-10\ndate,amount,currency,kind,transfer_role,transfer_subtype,merchant,note,category_l1,category_l2,source_ref\n2026-08-03,-128.50,CNY,expense,,,全家便利店,,food,snacks_drinks,p1:l14\n2026-08-04,-45.00,SGD,expense,,,Fairprice,新元原值 45.00,groceries,fresh_food,p1:l15\n2026-08-05,3000.00,CNY,transfer,in,repayment,,自动还款,,,p1:l22\n2026-08-09,12.90,CNY,refund,,,全家便利店,退了一盒草莓,food,snacks_drinks,p2:l3\n2026-08-25,23500.00,CNY,income,,,,八月工资,salary,base_salary,p2:l31\n",
  "skill": {
    "name": "wallet-import",
    "claude_skill_md": "---\nname: wallet-import\ndescription: 把任意账单整理成 Wallet App 的标准导入 CSV\n---\n\n你是账单整理助手……（全文见 05 §5，由 scripts/gen_import_skill.py 生成）",
    "chatgpt_instructions": "你是账单整理助手……（同一份规则的 ChatGPT Custom GPT / Project 指令版本）",
    "categories_block": "支出：\n- clothing 服饰 — 穿在身上的：衣服、鞋、包、配饰。运动装备也算这里；童装归育儿\n  - clothes 衣服 / shoes 鞋子 / bags 包 / accessories 配饰\n……（由 core/categories.render_skill_categories() 生成，逐字取自决策 §1.3）"
  },
  "guide_url": "/import/guide"
}
```

字段：

| 字段 | 类型 | 说明 |
|---|---|---|
| `version` | string | 就是 `CATEGORY_VERSION`，同时是 `ETag`。它必须与 skill 生成的 CSV 首行 `# version:` 相同，否则导入被 400 `skill_outdated` 拦下（§5.37、决策 §14.30） |
| `file` | object | 文件层面的硬约束：类型、编码、大小、行数、首行、11 列固定表头（决策 §5、§14.47） |
| `columns` | array | 每列的语义与格式，中英双语，供导入指南页直接渲染成表格 |
| `sample_csv` | string | 一份可直接下载的示例文件内容（前端存成 `wallet-import-sample.csv`）。它本身满足全部校验规则，用户可以先拿它试一次导入 |
| `skill` | object | 两种包装的 skill 文本（Claude 的 `SKILL.md`、ChatGPT 的指令文本）与生成出来的分类清单块。前端提供"复制"与"下载"两个按钮 |
| `guide_url` | string | 前端导入指南页的路由，`skill_outdated` 错误的 `detail` 里也带这个链接 |

约定：

- **只有 CSV**（决策 §14.47）：`file.content_type` 恒为 `text/csv`，没有 JSON 变体，`columns` 就是那 11 列，多一列少一列都是结构错误。
- 缓存一天而不是 `immutable`：skill 文本可能因为措辞改动而更新，而 `version` 只在分类表变化时才动，所以不能拿 `version` 当强缓存的唯一依据。前端仍可带 `If-None-Match` 拿 304。
- 公开的原因：用户可能在没登录的机器上装 skill；这里没有任何用户数据。

错误：只有 500。副作用：只读，不查库、不调外部服务（可在进程内缓存序列化结果）。

### 5.8 `GET /api/v1/ledgers`

鉴权：bearer。决策 §2、§11。

返回当前用户所属的全部账本，按 `created_at ASC`（第一次注册建的"我的账本"永远在最前）。

```json
GET /api/v1/ledgers
-> 200
{
  "items": [
    {"id": "8f0f7b2e-2a20-4c39-9c0f-2a9d5a1b6c31", "name": "我的账本", "base_currency": "CNY",
     "role": "owner", "member_count": 2, "created_by": "4ee1c8fa-...",
     "created_at": "2026-09-03T05:51:45.600000Z", "updated_at": "2026-09-03T05:51:45.600000Z"},
    {"id": "b1d2c3e4-5f60-4718-9a0b-1c2d3e4f5061", "name": "家庭账本", "base_currency": "CNY",
     "role": "member", "member_count": 3, "created_by": "77aa...",
     "created_at": "2026-09-05T09:02:11.000000Z", "updated_at": "2026-09-06T12:44:02.100000Z"}
  ],
  "total": 2
}
```

`role` 是**当前用户在这本账里的角色**。错误：只有通用三项。副作用：只读（一条带 `JOIN ledger_members` 的查询 + 一条分组 count）。

### 5.9 `POST /api/v1/ledgers`

鉴权：bearer。决策 §2。

| 字段 | 类型 | 必填 | 校验 |
|---|---|---|---|
| `name` | str | 是 | 1..100 字符，`strip()` 后非空（决策 §14.13，与账户名一致；`ledgers.name` 是 `VARCHAR(100)`） |
| `base_currency` | str | 否 | `^[A-Za-z]{3}$`；省略则用 `users.base_currency`；必须在支持列表内 |

```json
POST /api/v1/ledgers
{"name": "家庭账本", "base_currency": "cny"}

-> 201
{"id": "b1d2c3e4-5f60-4718-9a0b-1c2d3e4f5061", "name": "家庭账本", "base_currency": "CNY",
 "role": "owner", "member_count": 1, "created_by": "4ee1c8fa-...",
 "created_at": "2026-09-09T04:00:00.000000Z", "updated_at": "2026-09-09T04:00:00.000000Z"}
```

错误：

| 状态码 | code | 条件 |
|---|---|---|
| 409 | `ledger_limit_reached` | 该用户已有 `MAX_LEDGERS_PER_USER`（10）本账 |
| 400 | `validation_error` | 币种不在支持列表 |

副作用（一个事务）：`INSERT ledgers` + `INSERT ledger_members(role='owner')`。

### 5.10 `GET /api/v1/ledgers/{id}`

鉴权：成员（`get_ledger_member`）。决策 §14.52 A22（删除账本前要先显示交易 / 账户 / 批次计数）。

```json
GET /api/v1/ledgers/8f0f7b2e-2a20-4c39-9c0f-2a9d5a1b6c31
-> 200
{"id": "8f0f7b2e-...", "name": "我的账本", "base_currency": "CNY", "role": "owner",
 "member_count": 2, "created_by": "4ee1c8fa-...",
 "counts": {"transactions": 1284, "sources": 6, "import_batches": 9},
 "created_at": "2026-09-03T05:51:45.600000Z", "updated_at": "2026-09-03T05:51:45.600000Z"}
```

`counts` 是三条 `SELECT count(*)`（按 `ledger_id` 过滤），只在**本端点与 `POST /ledgers/join`（§5.19）** 的响应里出现——它是给删除确认弹窗准备的，`GET /ledgers`（§5.8）的列表项、`POST /ledgers`（§5.9）与 `PATCH /ledgers/{id}`（§5.11）的响应都没有它，也都没有净资产（决策 §14.52 A16：账本卡片只显示成员数与基准币种）。删除账本的确认弹窗把这三个数摆出来，用户手打账本名才能删（§5.12）。

错误：404 `not_found`（不存在或非成员，§3.3）。副作用：只读。

### 5.11 `PATCH /api/v1/ledgers/{id}`

鉴权：**owner**（`require_owner`）。决策 §2。带乐观并发（§4.4）。

| 字段 | 类型 | 必填 | 校验 |
|---|---|---|---|
| `updated_at` | datetime | 是 | 版本戳 |
| `name` | str | 否 | 1..100（决策 §14.13） |
| `base_currency` | str | 否 | `^[A-Za-z]{3}$`，必须在支持列表内 |

```json
PATCH /api/v1/ledgers/8f0f7b2e-2a20-4c39-9c0f-2a9d5a1b6c31
{"name": "家用", "base_currency": "usd", "updated_at": "2026-09-03T05:51:45.600000Z"}

-> 200
{"id": "8f0f7b2e-...", "name": "家用", "base_currency": "USD", "role": "owner", "member_count": 2,
 "created_by": "4ee1c8fa-...", "created_at": "2026-09-03T05:51:45.600000Z",
 "updated_at": "2026-09-09T04:12:55.700000Z"}
```

改基准币种**不改任何已存交易**：交易永远存自己的原币金额，折算是读取时算的（决策 §8），所以改完之后所有统计和余额立刻按新币种呈现。

错误：

| 状态码 | code | 条件 |
|---|---|---|
| 404 | `not_found` | 不存在或非成员 |
| 403 | `not_owner` | 成员但不是 owner |
| 409 | `stale_update` | 版本戳不一致 |
| 400 | `validation_error` | 币种不支持 |

副作用：`UPDATE ledgers`。

### 5.12 `DELETE /api/v1/ledgers/{id}`

鉴权：**owner**。决策 §2（"owner 可…删除账本（级联删除账户、交易、导入）"）、§14.52 A22。

无请求体。为防误删，要求 query 参数 `confirm_name` 与账本当前名字完全相等（前端让用户**手打**账本名，并在弹窗里先显示 §5.10 的三个计数）：

```text
DELETE /api/v1/ledgers/8f0f7b2e-2a20-4c39-9c0f-2a9d5a1b6c31?confirm_name=%E5%AE%B6%E7%94%A8
-> 204
```

错误：

| 状态码 | code | 条件 |
|---|---|---|
| 404 | `not_found` | 不存在或非成员 |
| 403 | `not_owner` | 不是 owner |
| 400 | `validation_error` | `confirm_name` 缺失或与账本名不符 |

副作用（一个事务，靠数据库外键 `ON DELETE CASCADE` 完成，见 [`./02-database.md`](./02-database.md)）：删除该账本的 `import_rows` → `import_batches` → `transaction_events` → `transactions` → `finance_sources` → `ledger_invites` → `ledger_members` → `ledgers` 本身。**没有任何磁盘清理**——后端不保存上传的账单文件（决策 §14.28）。用户账号不受影响。

### 5.13 `GET /api/v1/ledgers/{id}/members`

鉴权：成员。决策 §2、§14.40（01-7：记账人显示 `display_name`，没填时显示邮箱前缀）。

```json
GET /api/v1/ledgers/8f0f7b2e-2a20-4c39-9c0f-2a9d5a1b6c31/members
-> 200
{
  "items": [
    {"user_id": "4ee1c8fa-...", "email": "alice@example.com", "display_name": "Alice",
     "role": "owner", "joined_at": "2026-09-03T05:51:45.600000Z", "is_me": true},
    {"user_id": "77aa1122-...", "email": "bob@example.com", "display_name": null,
     "role": "member", "joined_at": "2026-09-05T09:10:00.000000Z", "is_me": false}
  ],
  "total": 2
}
```

这是前端把交易上的 `created_by` / `updated_by`（都只回 UUID，决策 §14.43 的 03-4）映射成人名的**唯一**数据源：`display_name` 非空就显示它，为空显示 `email` 里 `@` 前的部分（决策 §14.40）。成员退出账本后，他记的交易照旧显示他的名字、不匿名化（决策 §14.40 的 01-7）——所以前端还要为"`created_by` 不在成员列表里"的情况准备一个回退（显示"已退出的成员"）。

排序：owner 在前，然后 `joined_at ASC`。没有头像（决策 §14.52 B22）。

错误：404 `not_found`。副作用：只读。

### 5.14 `DELETE /api/v1/ledgers/{id}/members/{user_id}`

鉴权：**owner**。决策 §2（"owner 可…移除成员"）。

```text
DELETE /api/v1/ledgers/8f0f7b2e-.../members/77aa1122-...
-> 204
```

错误：

| 状态码 | code | 条件 |
|---|---|---|
| 404 | `not_found` | 账本不存在 / 非成员 |
| 403 | `not_owner` | 不是 owner |
| 404 | `member_not_found` | 目标不是该账本成员 |
| 409 | `cannot_remove_owner` | 目标是 owner（含自己）；要退出请先 `transfer-ownership` |

副作用：`DELETE ledger_members WHERE ledger_id AND user_id`。**不删除**该成员创建的账户和交易——它们属于账本（决策 §2），只是 `created_by` 仍指向那个用户。

### 5.15 `POST /api/v1/ledgers/{id}/leave`

鉴权：成员。决策 §2（"member 可自行退出；owner 必须先转让再退出"）。

无请求体。

```text
POST /api/v1/ledgers/8f0f7b2e-.../leave
-> 204
```

错误：

| 状态码 | code | 条件 |
|---|---|---|
| 404 | `not_found` | 账本不存在或已不是成员 |
| 409 | `owner_must_transfer` | 当前用户是该账本 owner |

副作用：`DELETE ledger_members`。退出后该账本从 `GET /ledgers` 消失，其下所有资源对该用户变成 404。

### 5.16 `POST /api/v1/ledgers/{id}/transfer-ownership`

鉴权：**owner**。决策 §2（"转让 owner"，且"每本账恰有一个 owner（应用层保证）"）。

| 字段 | 类型 | 必填 | 校验 |
|---|---|---|---|
| `to_user_id` | UUID | 是 | 必须是该账本的现有成员，且不是自己 |

```json
POST /api/v1/ledgers/8f0f7b2e-.../transfer-ownership
{"to_user_id": "77aa1122-3344-4556-8899-aabbccddeeff"}

-> 200
{
  "items": [
    {"user_id": "4ee1c8fa-...", "email": "alice@example.com", "role": "member",
     "joined_at": "2026-09-03T05:51:45.600000Z", "is_me": true},
    {"user_id": "77aa1122-...", "email": "bob@example.com", "role": "owner",
     "joined_at": "2026-09-05T09:10:00.000000Z", "is_me": false}
  ],
  "total": 2
}
```

错误：

| 状态码 | code | 条件 |
|---|---|---|
| 404 | `not_found` | 账本不存在或非成员 |
| 403 | `not_owner` | 不是 owner |
| 404 | `member_not_found` | `to_user_id` 不是该账本成员 |
| 400 | `validation_error` | `to_user_id` 就是自己 |

副作用（一个事务，对两行 `ledger_members` 都加行锁）：原 owner 降为 `member`，目标升为 `owner`。转让后调用者立刻失去 owner 权限。

### 5.17 `POST /api/v1/ledgers/{id}/invites`

鉴权：**owner**。决策 §2（"6 位数字、生成后 10 分钟过期、一次性使用"）、§14.29（不要求全表唯一、用掉即删、过期即删）。

无请求体。

```json
POST /api/v1/ledgers/8f0f7b2e-2a20-4c39-9c0f-2a9d5a1b6c31/invites
-> 201
{
  "id": "c9d0e1f2-3344-4a5b-8c7d-9e0f1a2b3c4d",
  "code": "418302",
  "ledger_id": "8f0f7b2e-2a20-4c39-9c0f-2a9d5a1b6c31",
  "ledger_name": "我的账本",
  "expires_at": "2026-09-09T04:32:10.000000Z",
  "created_at": "2026-09-09T04:22:10.000000Z"
}
```

生成规则（决策 §14.29）：

```text
1. DELETE FROM ledger_invites WHERE ledger_id = :id AND expires_at <= now()
   （懒清理：每次生成先把本账本的过期码删掉，不做定时任务）
2. code = f"{secrets.randbelow(1_000_000):06d}"
3. 只与**当前仍有效**的码查重：
   SELECT 1 FROM ledger_invites WHERE code = :code AND expires_at > now()
   撞上就回第 2 步重摇（最多 5 次，全撞则 500 internal_error）
4. INSERT ledger_invites(ledger_id, code, created_by, created_at, expires_at = now() + 10 min)
```

**`code` 上没有全表唯一索引**（决策 §14.29）：两本不同的账本在不同时间用过同一个 6 位数字完全没问题，因为过期的行早就被删了，`POST /ledgers/join` 又只在未过期的行里查——同一时刻全表最多几十个有效码，撞号概率可以忽略，撞了也只是重摇一次。这条同时解掉了"码空间被用过的码耗尽"这个老问题：表里永远只有有效的码。

`code` 只在这一次响应里出现（决策 §2 说流程是"生成 → 线下告诉对方"）；**没有**列出邀请码的 GET 接口，刷新页面就得重新生成。同一账本可以有多个同时有效的码。

错误：

| 状态码 | code | 条件 |
|---|---|---|
| 404 | `not_found` | 账本不存在或非成员 |
| 403 | `not_owner` | 不是 owner |
| 409 | `member_limit_reached` | 成员已满 10 人，先移除再邀请 |

副作用：一次 `DELETE`（懒清理）+ 一次 `INSERT ledger_invites`。表里**没有** `used_by` / `used_at` 两列（决策 §14.29）。

### 5.18 `DELETE /api/v1/ledgers/{id}/invites/{code}`

鉴权：**owner**。决策 §14.52 A2（邀请码可主动作废）。

码发出去之后发现发错了人、或者干脆不想让人加了，owner 可以立刻作废它，不用等 10 分钟。

```text
DELETE /api/v1/ledgers/8f0f7b2e-.../invites/418302
-> 204
```

路径参数 `code` 必须匹配 `^[0-9]{6}$`，否则 422。

错误：

| 状态码 | code | 条件 |
|---|---|---|
| 404 | `not_found` | 账本不可见；或该账本下没有这个码（已过期被清理、已被用掉、或从来没有过——三种情况响应完全一样，§3.3） |
| 403 | `not_owner` | 不是 owner |

副作用：`DELETE FROM ledger_invites WHERE ledger_id = :id AND code = :code`（决策 §14.43 的 03-6：删除类端点统一 204）。作废是**幂等**的终态：同一个码删第二次是 404。

### 5.19 `POST /api/v1/ledgers/join`

鉴权：bearer（任何登录用户）。决策 §2、§14.29（只查未过期码、成功即删）、§14.35（端点级全局 1 QPS）。**注意路径里没有 `{id}`**——账本是从邀请码反查出来的。

| 字段 | 类型 | 必填 | 校验 |
|---|---|---|---|
| `code` | str | 是 | `^[0-9]{6}$`（前端应去掉空格；不符正则直接 422） |

```json
POST /api/v1/ledgers/join
{"code": "418302"}

-> 200
{"id": "8f0f7b2e-2a20-4c39-9c0f-2a9d5a1b6c31", "name": "我的账本", "base_currency": "CNY",
 "role": "member", "member_count": 3, "created_by": "4ee1c8fa-...",
 "counts": {"transactions": 1284, "sources": 6, "import_batches": 9},
 "created_at": "2026-09-03T05:51:45.600000Z", "updated_at": "2026-09-03T05:51:45.600000Z"}
```

校验顺序：

```text
1. ratelimit.check("join", "global", Limit(capacity=3, refill_seconds=3))
       -> 429 invite_rate_limited + Retry-After（决策 §14.35）
2. SELECT * FROM ledger_invites
     WHERE code = :code AND expires_at > now() FOR UPDATE      （只查未过期的行）
     没查到                                                     -> 400 invite_invalid
   顺手：DELETE FROM ledger_invites WHERE code = :code AND expires_at <= now()
3. 已经是该账本成员                                              -> 409 already_member
4. 该账本成员数 >= MAX_MEMBERS_PER_LEDGER                       -> 409 member_limit_reached
5. 该用户账本数 >= MAX_LEDGERS_PER_USER                         -> 409 ledger_limit_reached
6. INSERT ledger_members(role='member'); DELETE 这一行邀请码     （同一事务）
```

限流是**端点级、全局**的（决策 §14.35，推翻了原来的"同一用户 15 分钟 5 次"）：桶的 key 是固定串 `"global"`，不按用户、不按 IP 计数。理由是 6 位码的暴力破解本来就是全局问题——1 QPS 意味着把 10^6 个码试一遍要 11 天，而码只活 10 分钟；同时，正常用户一天也就点一次"加入"，全局 1 QPS 对他们毫无感觉。突发容量 3 是为了让"手抖点了两下"不至于被挡。

**429 不消耗邀请码**（决策 §2）：限流发生在第 1 步，还没碰数据库；码只在第 6 步成功加入时被删除，或者到期后被下一次生成 / 校验顺手删掉。因此"被限流"和"码被用掉"这两件事永远不会同时发生，前端可以放心让用户重试。

`invite_used` 这个 code 不存在了（决策 §14.29）：码用掉就删行，第二个人再输同一个码，第 2 步查不到，得到的是 `invite_invalid`——从外部看不出"这个码存在过但被用了"，这也更安全。

错误：

| 状态码 | code | 条件 |
|---|---|---|
| 400 | `invite_invalid` | 码不存在（含已被用掉、已过期被清理） |
| 400 | `invite_expired` | 查到了行但 `expires_at <= now()`（并发窗口下才会出现；同时删除该行） |
| 409 | `already_member` | 已经在这本账里 |
| 409 | `member_limit_reached` | 账本满 10 人（决策 §14.52 B7） |
| 409 | `ledger_limit_reached` | 自己已有 10 本账 |
| 429 | `invite_rate_limited` | 超过全局 1 QPS；`Retry-After` 给出还需等待的秒数 |

副作用（一个事务）：`INSERT ledger_members` + `DELETE ledger_invites`（这一行）。

**不做**输码即时预览账本信息（决策 §14.52 B17）：没有"校验码但不加入"的接口，输完六位数字直接提交。

### 5.20 `GET /api/v1/ledgers/{id}/sources`

鉴权：成员。决策 §3、§11（"GET 含余额"）、§8（余额用最新汇率）、§14.2（余额以账户 `default_currency` 计价）、§14.50（三个合计、归档不计入、按类型分组）。

| query 参数 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `include_archived` | bool | `false` | `false` 时只返回 `archived = false` 的账户 |

排序：`archived ASC, type ASC, name ASC`（活跃在前，然后按类型聚在一起，界面直接按 `type` 分组画小标题与小计，决策 §14.50）。

```json
GET /api/v1/ledgers/8f0f7b2e-.../sources?include_archived=true
-> 200
{
  "items": [
    {
      "id": "34fa63d8-5776-4775-982b-4d58deb0ace9",
      "ledger_id": "8f0f7b2e-2a20-4c39-9c0f-2a9d5a1b6c31",
      "name": "招商 储蓄卡",
      "type": "checking",
      "default_currency": "CNY",
      "opening_balance": "0.0000",
      "archived": false,
      "archived_at": null,
      "balance": "12480.3300",
      "balance_base": "12480.3300",
      "balance_rate": "1.00000000",
      "balance_rate_date": "2026-09-08",
      "rate_missing_count": 0,
      "created_by": "4ee1c8fa-...",
      "updated_by": "4ee1c8fa-...",
      "created_at": "2026-09-03T05:51:45.934119Z",
      "updated_at": "2026-09-03T05:51:45.934119Z"
    },
    {
      "id": "5b6c7d8e-1111-4222-8333-444455556666",
      "ledger_id": "8f0f7b2e-2a20-4c39-9c0f-2a9d5a1b6c31",
      "name": "招商 信用卡",
      "type": "credit",
      "default_currency": "CNY",
      "opening_balance": "-2300.0000",
      "archived": false,
      "archived_at": null,
      "balance": "-1840.0000",
      "balance_base": "-1840.0000",
      "balance_rate": "1.00000000",
      "balance_rate_date": "2026-09-08",
      "rate_missing_count": 0,
      "created_by": "4ee1c8fa-...",
      "updated_by": "4ee1c8fa-...",
      "created_at": "2026-09-03T05:52:10.000000Z",
      "updated_at": "2026-09-06T10:00:00.000000Z"
    },
    {
      "id": "1022fd24-78a1-4c09-9de9-1cd7fbb0877f",
      "ledger_id": "8f0f7b2e-2a20-4c39-9c0f-2a9d5a1b6c31",
      "name": "Revolut EUR",
      "type": "other",
      "default_currency": "EUR",
      "opening_balance": "100.0000",
      "archived": true,
      "archived_at": "2026-09-06T10:00:00.000000Z",
      "balance": "54.5000",
      "balance_base": "452.3500",
      "balance_rate": "8.30000000",
      "balance_rate_date": "2026-09-08",
      "rate_missing_count": 0,
      "created_by": "4ee1c8fa-...",
      "updated_by": "77aa1122-...",
      "created_at": "2026-09-03T05:51:45.953116Z",
      "updated_at": "2026-09-06T10:00:00.000000Z"
    }
  ],
  "total": 3,
  "base_currency": "CNY",
  "assets": "12480.3300",
  "liabilities": "-1840.0000",
  "net_worth": "10640.3300"
}
```

字段语义（口径由决策 §14.2、§14.50 钉死，与 [`./01-domain-and-flows.md`](./01-domain-and-flows.md) §5.4 逐字一致）：

- `type`：**四选一**（决策 §14.48）——`checking` 储蓄卡 / `credit` 信用卡 / `cash` 现金 / `other` 其他。**没有 `savings`**（新加坡没有这个区分，"储蓄"就是 checking），迁移把现有 `savings` 改写成 `checking`（[`./02-database.md`](./02-database.md) §5 的迁移计划）。
- `archived` / `archived_at`：`archived` 是布尔开关，`archived_at` 是**归档发生的时刻**（未归档为 `null`，决策 §14.50）。取消归档时 `archived_at` 一并置回 `null`。界面在归档账户的名字旁显示"于 2026-09-06 归档"。
- `balance`：余额，**以账户自己的 `default_currency` 计价**：

```text
balance(a) = a.opening_balance
           + Σ  convert(t.amount, t.currency → a.default_currency, on = t.occurred_at)
              t.source_id = a.id
```

  也就是说：`opening_balance` 本来就是账户币种；与账户币种**相同**的交易直接相加（绝大多数情况，一次换算都不发生）；与账户币种**不同**的交易（用人民币账户刷了一笔欧元）按**该笔交易发生日**的汇率折算成账户币种后再加（决策 §8"交易用发生日汇率"）。**不按币种分桶**，接口只回一个标量。包含单腿转账；两腿转账的每一腿各自计入自己那个账户。

  实现：一条 `GROUP BY source_id, currency, occurred_at` 的聚合查询把全部账户的分组小计一次取回，再交给 `fx.convert_many`（§6.3）批量折算后在应用层求和——不做 N+1，上游请求数只与"出现过的币种数"有关。

- `balance_base`：把 `balance` 按**最新**汇率折算到账本 `base_currency`（决策 §8"账户余额用最新汇率"、§14.2）：`balance_base = convert(balance, a.default_currency → ledger.base_currency, 最新)`。`balance_rate` / `balance_rate_date` 就是这一步用到的汇率和它的行情日，界面上可以标"按 2026-09-08 汇率折算"。
- 账户币种 == 账本基准币种时 `balance_rate = "1.00000000"`，`balance_rate_date` = 今天。
- 信用卡的余额是**负数**表示欠款（`opening_balance` 输入欠款、存为负数，决策 §14.52 A13）。

响应顶层的三个合计（决策 §14.50，全部以账本 `base_currency` 计价）：

| 字段 | 定义 |
|---|---|
| `assets` | Σ `balance_base`，取 `type != 'credit'` 且 **未归档**的账户 |
| `liabilities` | Σ `balance_base`，取 `type == 'credit'` 且 **未归档**的账户；欠款为负，所以这个数通常是负的 |
| `net_worth` | `assets + liabilities`（不是相减——负债本身已经带负号） |

**归档账户一律不计入这三个数**，即使 `include_archived=true` 把它们返回了也不算（决策 §14.50）。这就是归档账户时前端要提示"该账户余额将从净资产中移除"的原因（§5.23）。首页的资产 / 负债 / 净资产三个数用的就是这三个字段（[`./04-frontend.md`](./04-frontend.md) §4.4）。

- `rate_missing_count`：这个账户上**因为取不到汇率而没有计入 `balance` 的交易条数**，正常恒为 `0`（与 §5.25 `summary`、§5.35 统计里的同名字段是同一个口径的信号）。

汇率上游不可用且缓存里也没有可用值时：折不动的**异币种交易按原值计入 `balance`** 会算错，所以这种情况下 `balance` 仍然返回（只把折不动的那部分按 0 计，并把这些交易的条数写进该账户的 `rate_missing_count`），并把 `balance_base` / `balance_rate` / `balance_rate_date` 三个字段置 `null`，顶层的 `assets` / `liabilities` / `net_worth` 也一并置 `null`，其余字段照常返回 200（列表接口不因为汇率而失败，沿用现状的容错取向）。**`rate_missing_count > 0` 时前端必须把这个账户的 `balance` 标成"不完整"**（[`./04-frontend.md`](./04-frontend.md) §4.4）——没有这个信号，用户看到的就是一个静默少算的数。账户上全部交易都是账户币种时（最常见）这条分支根本不会触发，三个数与所有 `rate_missing_count` 都是正常值。

`transactions.amount` 的符号约定由数据库 CHECK 保证（决策 §10），所以求和就是余额，不需要按 kind 分支。

错误：404 `not_found`。副作用：只读（一条账户查询 + 一条余额聚合 + 最多一次 Frankfurter 调用，命中 `exchange_rates` 缓存时零次）。

### 5.21 `POST /api/v1/ledgers/{id}/sources`

鉴权：成员。决策 §3、§14.48（四种类型）、§14.50（币种创建后不可改，所以这里是唯一能定币种的地方）。

| 字段 | 类型 | 必填 | 校验 |
|---|---|---|---|
| `name` | str | 是 | 1..100，`strip()` 后非空 |
| `type` | str | 是 | `checking` \| `credit` \| `cash` \| `other`（四选一，无 `savings`，决策 §14.48） |
| `default_currency` | str | 是 | `^[A-Za-z]{3}$`，`.upper()` 后必须在支持列表内。**创建后不可再改**（§5.23），所以前端要在表单上明确写这句 |
| `opening_balance` | Decimal | 否 | 默认 `0`；4 位小数；可正可负。信用卡填欠款、存为负数（决策 §14.52 A13） |

```json
POST /api/v1/ledgers/8f0f7b2e-.../sources
{"name": "招商 信用卡", "type": "credit", "default_currency": "cny", "opening_balance": "-2300.00"}

-> 201
{"id": "5b6c7d8e-...", "ledger_id": "8f0f7b2e-...", "name": "招商 信用卡", "type": "credit",
 "default_currency": "CNY", "opening_balance": "-2300.0000", "archived": false, "archived_at": null,
 "balance": "-2300.0000", "balance_base": "-2300.0000", "balance_rate": "1.00000000",
 "balance_rate_date": "2026-09-09", "created_by": "4ee1c8fa-...", "updated_by": "4ee1c8fa-...",
 "created_at": "2026-09-09T05:00:00.000000Z", "updated_at": "2026-09-09T05:00:00.000000Z"}
```

**期初余额是账户上的一列，不是一笔交易**（决策 §14.52 B5）：不会因为建账户而多出一条"建账"的 `transactions` 行，交易列表里看不到它，四种 kind 之外也不会冒出第五种。

错误：

| 状态码 | code | 条件 |
|---|---|---|
| 404 | `not_found` | 账本不存在或非成员 |
| 400 | `validation_error` | 币种不在支持列表；`type` 不在四个值里 |

副作用：`INSERT finance_sources`（`ledger_id` 来自路径，`created_by` / `updated_by` = 当前用户）。**不再**有"第一个账户自动设为用户默认账户"的行为（现状 `backend/app/api/finance_sources.py:44-49`），因为 `users.default_source_id` 随账本化一起去掉了（决策 §14.42）。账本内账户名不要求唯一（决策 §14.40 的 01-6：允许同名，按 id 区分，只在界面提示）。

### 5.22 `GET /api/v1/ledgers/{id}/sources/{sid}`

鉴权：成员。

```json
GET /api/v1/ledgers/8f0f7b2e-.../sources/34fa63d8-5776-4775-982b-4d58deb0ace9
-> 200
（字段与 §5.20 的单个 item 完全一致，含 balance / balance_base / archived_at；
  没有顶层的 assets / liabilities / net_worth——那三个数是账本层面的，只在列表接口给）
```

错误：404 `not_found`（账本不可见、账户不存在、或账户属于别的账本，§3.3）。副作用：只读。

### 5.23 `PATCH /api/v1/ledgers/{id}/sources/{sid}`

鉴权：成员。带乐观并发（§4.4）。决策 §14.50（币种不可改）。

| 字段 | 类型 | 必填 | 校验 |
|---|---|---|---|
| `updated_at` | datetime | 是 | 版本戳 |
| `name` | str | 否 | 1..100 |
| `type` | str | 否 | 四选一 |
| `opening_balance` | Decimal | 否 | 4 位小数 |
| `archived` | bool | 否 | `true` 归档、`false` 取消归档 |

**`default_currency` 不在可改字段里**（决策 §14.50）：给了它就是 400 `currency_locked`，哪怕值与当前币种相同也一样拒绝（少一条"改了等于没改"的特例，前端更容易解释）。理由是账户币种一旦有了交易就是余额口径的基准，改它会让所有历史余额的含义悄悄变掉；要换币种就新建一个账户、把旧的归档。

所有字段都不接受显式 `null`（现状允许把 `name` 置 null 并在 commit 时 500）。

```json
PATCH /api/v1/ledgers/8f0f7b2e-.../sources/1022fd24-78a1-4c09-9de9-1cd7fbb0877f
{"archived": true, "updated_at": "2026-09-03T05:51:45.953116Z"}

-> 200
{"id": "1022fd24-...", "ledger_id": "8f0f7b2e-...", "name": "Revolut EUR", "type": "other",
 "default_currency": "EUR", "opening_balance": "100.0000",
 "archived": true, "archived_at": "2026-09-09T05:10:00.000000Z",
 "balance": "54.5000", "balance_base": "452.3500", "balance_rate": "8.30000000",
 "balance_rate_date": "2026-09-08", "created_by": "4ee1c8fa-...", "updated_by": "4ee1c8fa-...",
 "created_at": "2026-09-03T05:51:45.953116Z", "updated_at": "2026-09-09T05:10:00.000000Z"}
```

改币种被拒：

```json
PATCH /api/v1/ledgers/8f0f7b2e-.../sources/1022fd24-...
{"default_currency": "USD", "updated_at": "2026-09-03T05:51:45.953116Z"}

-> 400
{"detail": "Account currency cannot be changed after creation; create a new account instead",
 "code": "currency_locked"}
```

错误：

| 状态码 | code | 条件 |
|---|---|---|
| 404 | `not_found` | 账本 / 账户不可见 |
| 409 | `stale_update` | 版本戳不一致 |
| 400 | `currency_locked` | 请求体里出现了 `default_currency`（决策 §14.50） |
| 400 | `validation_error` | `type` 不在四个值里；`name` 空 |

副作用：`UPDATE finance_sources`（含 `updated_by`、`updated_at`；`archived` 从 `false` 变 `true` 时同时写 `archived_at = now()`，反向变化时置 `null`）。

归档后该账户不能再记账、不能作为导入目标（决策 §3），历史交易全部保留并**允许修改**（决策 §14.40 的 01-12：只禁止新建），余额照常计算但**不计入**净资产（决策 §14.50）——所以前端在归档前要提示"该账户余额（¥452.35）将从净资产中移除"。

### 5.24 `DELETE /api/v1/ledgers/{id}/sources/{sid}`

鉴权：成员。决策 §3（"有交易的账户不能删除，只能归档"）。

```text
DELETE /api/v1/ledgers/8f0f7b2e-.../sources/5b6c7d8e-...
-> 204
```

错误：

| 状态码 | code | 条件 |
|---|---|---|
| 404 | `not_found` | 账本 / 账户不可见 |
| 409 | `source_has_transactions` | 该账户下有任意一条交易；`detail` 给出条数并提示改用归档 |

副作用：`DELETE finance_sources`。删除前的判定是同事务里的 `SELECT EXISTS(SELECT 1 FROM transactions WHERE source_id = :sid)`，并对账户行加 `FOR UPDATE`，避免"检查通过之后别人刚好插入一条交易"的竞态；数据库侧 `transactions.source_id` 的外键是 `ON DELETE RESTRICT`，作为最后一道防线。

### 5.25 `GET /api/v1/ledgers/{id}/transactions`

鉴权：成员。决策 §4（参数表）、§8（折算）、§14.46（`import_batch_id` 筛选）、§14.49（金额区间按基准币种比较）、§14.52 A14（`summary`）。

参数与决策 §4 一字对应：

| 参数 | 类型 | 可多值 | 默认 | 行为 |
|---|---|---|---|---|
| `q` | str | 否 | — | `merchant ILIKE :pattern OR note ILIKE :pattern`，其中 pattern 是 `%q%`（决策 §4："ILIKE 足够，不做全文索引"）。先 `strip()`，空串等于不传 |
| `kind` | str | **是** | — | `expense` \| `income` \| `refund` \| `transfer`；多值为 `IN`，如 `?kind=expense&kind=refund` |
| `category_l1` | str | 否 | — | 必须是合法一级 code，否则 400 `category_invalid` |
| `category_l2` | str | 否 | — | 必须是合法二级 code；同时给了 `category_l1` 时必须属于它 |
| `source_id` | UUID | **是** | — | 多值为 `IN`；每个都必须属于本账本，否则 404 `not_found` |
| `from` | date | 否 | — | `occurred_at >= from`。`from` 是 Python 关键字，处理函数签名里写 `date_from: date = Query(None, alias="from")` |
| `to` | date | 否 | — | `occurred_at <= to`（含当天） |
| `currency` | str | 否 | — | `^[A-Za-z]{3}$`，可重复，`.upper()` 后作 `IN` 匹配**原币种**，如 `?currency=CNY&currency=SGD`（决策 §14.49、§14.60；2026-09-16 用户决定改多选） |
| `min_amount` | Decimal | 否 | — | 折算到账本基准币种后取绝对值 `>= min_amount`（决策 §14.49）；必须 ≥ 0 |
| `max_amount` | Decimal | 否 | — | 同上 `<= max_amount`；给了两个且 `min > max` → 422 |
| `import_batch_id` | UUID | 否 | — | 只看这一批导入建出来的交易（决策 §14.46 的 04-D-7）；批次必须属于本账本，否则 404 |
| `limit` | int | 否 | 50 | 1..200（决策 §14.44 的 03-14） |
| `offset` | int | 否 | 0 | ≥ 0 |

**金额区间的口径**（决策 §14.49，推翻了原来的"按原币绝对值比较"）：`min_amount` / `max_amount` 比的是**按发生日汇率折算成账本基准币种之后的绝对值**。理由是一个多币种账本里"大于 1000"这句话只有折算之后才有意义——否则 1000 JPY 和 1000 SGD 会被同一个阈值切开。

实现顺序（读取时计算、不落库，决策 §8）：

```text
1. 先在 SQL 里应用其他所有条件（q / kind / 分类 / 账户 / 日期 / 币种 / import_batch_id）
2. 对结果集做一次 fx.convert_many（§6.3），逐行算出 amount_base
3. 在应用层按 abs(amount_base) 过滤金额区间
4. 过滤后的行数就是 total；再按 limit / offset 切片；summary 在**过滤后的全集**上算
```

代价：给了金额区间时，第 2 步要折算的是"其他条件过滤后的全部行"而不是一页。这在亲友规模（一个账本几千到几万条）下完全可以接受，而且汇率命中缓存后没有额外的上游请求。没给金额区间时走快路径，只折算当前页。

排序固定 `occurred_at DESC, created_at DESC`（与现状一致，`backend/app/api/transactions.py:215`）；`id` 作为第三排序键保证分页稳定。

响应：

```json
GET /api/v1/ledgers/8f0f7b2e-.../transactions?kind=expense&kind=refund&from=2026-09-01&to=2026-09-30&limit=2
-> 200
{
  "items": [
    {
      "id": "f59f243d-3246-49ab-adb5-60761e061571",
      "ledger_id": "8f0f7b2e-2a20-4c39-9c0f-2a9d5a1b6c31",
      "source_id": "1022fd24-78a1-4c09-9de9-1cd7fbb0877f",
      "kind": "expense",
      "amount": "-45.5000",
      "currency": "EUR",
      "occurred_at": "2026-09-01",
      "category_l1": "groceries",
      "category_l2": "fresh_food",
      "merchant": "Carrefour",
      "note": "周末采购",
      "counterparty": null,
      "transfer_role": null,
      "transfer_subtype": null,
      "transfer_pair_id": null,
      "refund_of": null,
      "refunded_total": "15.0000",
      "refundable": "30.5000",
      "import_batch_id": null,
      "amount_base": "-377.5700",
      "rate_used": "8.29824176",
      "rate_date": "2026-09-01",
      "created_by": "4ee1c8fa-...",
      "updated_by": "4ee1c8fa-...",
      "created_at": "2026-09-01T18:20:00.000000Z",
      "updated_at": "2026-09-01T18:20:00.000000Z"
    },
    {
      "id": "aa11bb22-cc33-4d44-8e55-ff6677889900",
      "ledger_id": "8f0f7b2e-2a20-4c39-9c0f-2a9d5a1b6c31",
      "source_id": "1022fd24-78a1-4c09-9de9-1cd7fbb0877f",
      "kind": "refund",
      "amount": "10.0000",
      "currency": "EUR",
      "occurred_at": "2026-09-04",
      "category_l1": "groceries",
      "category_l2": "fresh_food",
      "merchant": "Carrefour",
      "note": "退了一盒草莓",
      "counterparty": null,
      "transfer_role": null,
      "transfer_subtype": null,
      "transfer_pair_id": null,
      "refund_of": "f59f243d-3246-49ab-adb5-60761e061571",
      "import_batch_id": null,
      "amount_base": "82.9800",
      "rate_used": "8.29800000",
      "rate_date": "2026-09-04",
      "created_by": "4ee1c8fa-...",
      "updated_by": "4ee1c8fa-...",
      "created_at": "2026-09-04T09:00:00.000000Z",
      "updated_at": "2026-09-04T09:00:00.000000Z"
    }
  ],
  "total": 37,
  "summary": {
    "base_currency": "CNY",
    "expense": "8421.6600",
    "income": "0.0000",
    "net": "-8338.6800",
    "count": 37,
    "rate_missing_count": 0
  }
}
```

这份 `summary` 与请求里的筛选条件是自洽的：请求写的是 `?kind=expense&kind=refund`，收入行根本不在结果集里，所以 `income` 必然是 `0.0000`；这 37 行里退款折算后合计 `82.9800`，于是 `net = 0 - 8421.66 + 82.98 = -8338.68`。换句话说 `summary` 永远只统计**当前筛选命中的行**，不会去看筛选之外的数据。

`summary`（决策 §14.52 A14）：

| 字段 | 定义 |
|---|---|
| `base_currency` | 账本基准币种，三个金额都是它 |
| `expense` | 全部筛选结果里 `kind='expense'` 的 `amount_base` 绝对值之和，**正数**；退款不在这里 |
| `income` | `kind='income'` 的 `amount_base` 之和，正数 |
| `net` | `income - expense + 退款`，其中"退款"是全部筛选结果里 `kind='refund'` 的 `amount_base` 之和（正数）；即"这批筛选结果对钱包的净影响"。**转账不计入**（单腿两腿都不算，决策 §14.52 A14）。三个数都只在**筛选命中的行**上算，所以 `?kind=expense` 这种筛选下 `income` 就是 `0.0000` |
| `count` | 与 `total` 相同，放在这里是为了让前端只读一个对象就能画汇总条 |
| `rate_missing_count` | 因为汇率取不到而没能计入的行数，正常是 0 |

（同步 2026-09-12）实现上 `summary` 先按 `(kind, currency, occurred_at)` 分组求小计，再对每个小计折算求和（同一天同币种的行共用同一个汇率，结果与逐行折算相同，只在第 4 位小数的舍入上可能差 0.0001）。

（同步 2026-09-12）`count` 与 `total` 是否总是相等，取决于有没有给金额区间：给了 `min_amount` / `max_amount` 时，取不到汇率的行没有 `amount_base`，没法参与"折算后比较"，所以根本不进过滤后的结果集——此时 `total`（也就是 `count`）只统计**能折算的行**，取不到汇率而被排除的行数单独由 `rate_missing_count` 给出，两者不重叠。没给金额区间时不需要折算就能判断是否命中筛选，取不到汇率的行照常留在结果集里（只是 `amount_base` 等三个字段为 `null`，见 §5.25 响应行字段说明），所以这时 `count == total` 包含全部命中的行，`rate_missing_count` 统计的是这些行里汇率缺失的数量。

`summary` 算的是**全部筛选结果**，不是当前页——翻页时这一栏不变，这正是它的用途（决策 §14.52 A14：列表顶部显示"支出 / 收入 / 净额"）。按日分组和每日小计由前端在当前页数据上做，服务端不管。

两腿转账在列表里仍然是**两行**返回（决策 §14.52 B15：接口按行返回，合并成一行显示由前端按 `transfer_pair_id` 做；按账户筛选时任一腿命中就显示整对，也由前端处理）。

响应行的字段说明：

| 字段 | 何时有值 |
|---|---|
| `kind` | 总是；四选一（决策 §1） |
| `amount` | 总是；符号由 kind 决定（expense 负、income/refund 正、transfer 出负入正，决策 §10） |
| `category_l1` / `category_l2` | `kind != 'transfer'` 时 `category_l1` 必有值，`category_l2` 可为 null；`kind == 'transfer'` 时两者都是 null |
| `counterparty` | 只可能出现在 `transfer_pair_id IS NULL` 的单腿转账上（决策 §1.2 的 CHECK）。列表标题按它显示"对方：老婆"，两腿则显示"A → B"（决策 §14.52 B16） |
| `transfer_role` / `transfer_subtype` | `kind == 'transfer'` 时必有值，否则都是 null |
| `transfer_pair_id` | 两腿转账才有；单腿转账为 null |
| `refund_of` | 只可能出现在 `kind == 'refund'` 的行上；原单被删后被置 NULL（决策 §1.1 的 `ON DELETE SET NULL`） |
| `refunded_total` / `refundable` | **可选字段，只在 `kind == 'expense'` 的行上出现**。`refunded_total` = 指向该行的所有 refund 的 `amount` 之和（正数）；`refundable` = `ABS(amount) - refunded_total`，可以为负（累计退款超过原单，决策 §1.1 允许）。用一条 `LEFT JOIN … GROUP BY refund_of` 一次算完本页，不做 N+1。前端选退款原单时直接显示这两个数（决策 §1.1），并且**不禁选**已退完的原单，只给超额警告（决策 §14.52 B10） |
| `amount_base` / `rate_used` / `rate_date` | 折算到账本基准币种，用 `occurred_at` 当天（或回退后的最近交易日）汇率（决策 §8）。币种相同时 `amount_base == amount`、`rate_used == "1.00000000"`、`rate_date == occurred_at`。汇率完全取不到时三者为 `null`，行照常返回 |
| `import_batch_id` | 由导入提交产生的交易带批次 id，手工记的为 null。它同时是 `?import_batch_id=` 筛选的依据（决策 §14.46） |

错误：

| 状态码 | code | 条件 |
|---|---|---|
| 404 | `not_found` | 账本不可见；`source_id` 里有不属于本账本的 id；`import_batch_id` 不属于本账本 |
| 400 | `category_invalid` | `category_l1` / `category_l2` 不合法或不匹配 |
| 422 | `validation_error` | 日期格式错、`limit` 越界、`min_amount > max_amount` 等（现状把日期格式错报成 400，目标统一为 422） |

**退款原单选择器复用这个端点**（决策 §14.11）：记账表单和导入 review 表格里的"关联原单"选择器都直接调 `GET /ledgers/{id}/transactions`，带 `?kind=expense&source_id=…&from=<90 天前>&q=<用户输入>`，用响应里 expense 行自带的 `refunded_total` / `refundable` 显示"已退 / 可退"，并按 `refundable > 0` 在前端做"还有可退余额"的筛选（决策 §14.52 A20）。**不另设退款候选接口**——候选就是一次普通的交易查询，多一个端点只会多一份要维护的筛选逻辑。

**"筛空了怎么办"由前端处理**（决策 §14.52 A15）：结果为 0 时前端对最多 2 个筛选条件各发一次"去掉这一条"的查询，用返回的 `total` 显示"去掉『九月』会有 128 笔"。服务端不为此加任何参数。

副作用：只读。查询次数固定：1 条 count（或金额区间下的一次全量折算）、1 条分页查询、1 条退款汇总、1 次批量汇率（`fx.convert_many`，§6.3），与页大小无关。

### 5.26 `POST /api/v1/ledgers/{id}/transactions`

鉴权：成员。决策 §1（四种 kind）、§1.1（退款）、§1.2（**单腿**转账）、§14.51（写操作记录）。

**这个端点只能建单条交易。** 两腿转账必须走 §5.30。

| 字段 | 类型 | 必填 | 校验 |
|---|---|---|---|
| `source_id` | UUID | 是 | 必须属于本账本且 `archived = false` |
| `kind` | str | 是 | `expense` \| `income` \| `refund` \| `transfer` |
| `amount` | Decimal | 是 | 4 位小数；符号必须与 kind 匹配（见下）；绝对值 > 0 |
| `currency` | str | 是 | `^[A-Za-z]{3}$`，`.upper()`；`kind='transfer'` 的**单腿**必须等于账户的 `default_currency`（决策 §14.52 A11） |
| `occurred_at` | date | 是 | `YYYY-MM-DD`；不允许晚于今天 + 1 天（决策 §14.44 的 03-13，防手滑打错年份） |
| `category_l1` | str | 见下 | 非 transfer 必填；transfer 必须省略或为 null |
| `category_l2` | str \| null | 否 | 必须属于 `category_l1` |
| `merchant` | str \| null | 否 | ≤ 200（决策 §1.4）；`kind='transfer'` 时必须为空（决策 §14.52 B16：转账不设商户） |
| `note` | str \| null | 否 | ≤ 500（决策 §1.4，由现状的 `description` 改名） |
| `refund_of` | UUID \| null | 否 | 只允许 `kind == 'refund'`；见下 |
| `transfer_role` | str | transfer 必填 | `out` \| `in`；必须与 `amount` 符号一致 |
| `transfer_subtype` | str | transfer 必填 | `plain` \| `repayment`；**只在这一腿是转入腿时**校验账户类型：`repayment` + `transfer_role='in'` 时账户必须是 `credit`（决策 §14.52 A11）。`transfer_role='out'` 的单腿 `repayment` 放行 |
| `counterparty` | str \| null | 否 | ≤ 100；只允许单腿转账填（决策 §1.2） |

符号规则（与数据库 CHECK 一致，决策 §10）：

| kind | 允许的符号 | `transfer_role` |
|---|---|---|
| `expense` | `amount < 0` | 必须为 null |
| `income` | `amount > 0` | 必须为 null |
| `refund` | `amount > 0` | 必须为 null |
| `transfer` + `role=out` | `amount < 0` | `out` |
| `transfer` + `role=in` | `amount > 0` | `in` |

`refund_of` 的校验（决策 §1.1）：

1. 目标交易存在且 `ledger_id` 与本账本相同 —— 否则 400 `refund_target_invalid`（用 400 而不是 404，因为这是请求体里的引用错误）。
2. 目标 `kind == 'expense'` —— 否则 400 `refund_target_invalid`。
3. **不要求**同账户（决策 §1.1 说"同账户预填但可改"，是前端的默认值，不是服务端约束；退回账户默认与原单相同也是前端行为，决策 §14.52 A20）。
4. 不校验币种是否一致，也不校验累计退款是否超过原单金额（决策 §1.1："超过原单金额时前端警告但允许保存"）。
5. 请求里没给 `category_l1` 且给了合法 `refund_of` 时，服务端从原单复制 `category_l1` / `category_l2`（决策 §1.1"关联后分类自动沿用原单"）；给了就以请求里的为准。

支出示例：

```json
POST /api/v1/ledgers/8f0f7b2e-.../transactions
X-Client: web
{
  "source_id": "1022fd24-78a1-4c09-9de9-1cd7fbb0877f",
  "kind": "expense",
  "amount": "-45.50",
  "currency": "eur",
  "occurred_at": "2026-09-01",
  "category_l1": "groceries",
  "category_l2": "fresh_food",
  "merchant": "Carrefour",
  "note": "周末采购"
}

-> 201
{"id": "f59f243d-...", "ledger_id": "8f0f7b2e-...", "source_id": "1022fd24-...", "kind": "expense",
 "amount": "-45.5000", "currency": "EUR", "occurred_at": "2026-09-01",
 "category_l1": "groceries", "category_l2": "fresh_food", "merchant": "Carrefour", "note": "周末采购",
 "counterparty": null, "transfer_role": null, "transfer_subtype": null, "transfer_pair_id": null,
 "refund_of": null, "refunded_total": "0.0000", "refundable": "45.5000", "import_batch_id": null,
 "amount_base": "-377.5700", "rate_used": "8.29824176", "rate_date": "2026-09-01",
 "created_by": "4ee1c8fa-...", "updated_by": "4ee1c8fa-...",
 "created_at": "2026-09-01T18:20:00.000000Z", "updated_at": "2026-09-01T18:20:00.000000Z"}
```

退款示例（不给分类，沿用原单）：

```json
POST /api/v1/ledgers/8f0f7b2e-.../transactions
{"source_id": "1022fd24-...", "kind": "refund", "amount": "10.00", "currency": "EUR",
 "occurred_at": "2026-09-04", "merchant": "Carrefour", "note": "退了一盒草莓",
 "refund_of": "f59f243d-3246-49ab-adb5-60761e061571"}

-> 201   （响应里 category_l1 = "groceries"、category_l2 = "fresh_food"）
```

单腿转账示例（老婆给我转钱，对方账户不在应用里，决策 §1.2）：

```json
POST /api/v1/ledgers/8f0f7b2e-.../transactions
{"source_id": "34fa63d8-...", "kind": "transfer", "amount": "500.00", "currency": "CNY",
 "occurred_at": "2026-09-05", "transfer_role": "in", "transfer_subtype": "plain",
 "counterparty": "老婆", "note": "生活费"}

-> 201
{"id": "9a8b7c6d-...", "kind": "transfer", "amount": "500.0000", "currency": "CNY",
 "category_l1": null, "category_l2": null, "counterparty": "老婆", "merchant": null,
 "transfer_role": "in", "transfer_subtype": "plain", "transfer_pair_id": null, …}
```

单腿转账计入账户余额，但**不计入**收入/支出统计（决策 §1.2）。表单默认建议把外部转入记成 `income`，这是前端的默认值选择（[`./04-frontend.md`](./04-frontend.md)），服务端不干预。单腿的币种必须等于账户币种（决策 §14.52 A11）——单腿没有对腿可以承担另一个币种，写成别的币种只会让余额口径变复杂。

A11 的"还款转入账户限定信用卡"只约束**转入腿**：从储蓄卡账单导入的还款是一条 `transfer` / `out` / `repayment` 的单腿（决策 §6 的 skill 规则就是这样输出的），它的账户本来就不是信用卡，对腿（信用卡那边）不在这次请求里，服务端无从校验，所以 `transfer_role='out'` 的 `repayment` 一律放行。只有 `transfer_role='in'` 的那一腿才要求账户是 `credit`。

错误：

| 状态码 | code | 条件 |
|---|---|---|
| 404 | `not_found` | 账本不可见；`source_id` 不属于本账本 |
| 409 | `source_archived` | 目标账户已归档（决策 §3） |
| 400 | `category_invalid` | 分类 code 不存在、二级不属于一级；或 transfer 却带了分类 |
| 400 | `category_kind_mismatch` | 收支侧与 kind 不匹配（如 income 用了支出分类） |
| 400 | `refund_target_invalid` | `refund_of` 不在本账本 / 不是 expense / 非 refund 却给了它 |
| 400 | `repayment_target_not_credit` | `transfer_subtype='repayment'` 且 `transfer_role='in'`，但账户不是 `credit`（决策 §14.52 A11） |
| 400 | `validation_error` | 金额符号与 kind 或 transfer_role 冲突；金额为 0；transfer 缺 `transfer_role` / `transfer_subtype`；非 transfer 却给了它们；`counterparty` 用在非转账上；转账带了 `merchant`；单腿转账币种 ≠ 账户币种；币种不支持；`occurred_at` 晚于今天 + 1 天 |

副作用（一个事务）：`INSERT transactions`（`ledger_id` 来自路径，`created_by` / `updated_by` = 当前用户，`transfer_pair_id` 恒为 NULL）+ `INSERT transaction_events`（`event='created'`，`client` 取自 `X-Client`，决策 §14.51）。给了 `refund_of` 时不额外写 `refund_linked` 事件——创建时的关联已经在 `created` 的 `changes` 里。折算字段是响应时算出来的，**不落库**（决策 §8）。可能触发 0 或 1 次 Frankfurter 调用（缓存未命中时）。

### 5.27 `GET /api/v1/ledgers/{id}/transactions/{tid}`

鉴权：成员。决策 §14.46（04-D-6：支出带 `refunds[]`、退款把 `refund_of` 展开）、§14.51（`events[]`）、§14.52 A24（显示所用汇率）、A25（退款详情列出同原单的其它退款）。

基础字段与 §5.25 的单个 item 完全一致（含 `amount_base` / `rate_used` / `rate_date`——这就是详情页"按 2026-09-01 汇率 8.29824176 折算"那一行的数据来源，决策 §14.52 A24），另外多四组东西。

**一、支出行带 `refunds[]`**（决策 §14.46）：

```json
GET /api/v1/ledgers/8f0f7b2e-.../transactions/f59f243d-3246-49ab-adb5-60761e061571
-> 200
{
  "id": "f59f243d-...", "kind": "expense", "amount": "-45.5000", "currency": "EUR",
  "occurred_at": "2026-09-01", "merchant": "Carrefour",
  "amount_base": "-377.5700", "rate_used": "8.29824176", "rate_date": "2026-09-01",
  "refunded_total": "15.0000",
  "refundable": "30.5000",
  "refunds": [
    {"id": "aa11bb22-...", "occurred_at": "2026-09-04", "amount": "10.0000",
     "currency": "EUR", "note": "退了一盒草莓", "source_id": "1022fd24-..."},
    {"id": "bb22cc33-...", "occurred_at": "2026-09-12", "amount": "5.0000",
     "currency": "EUR", "note": "又退了一份", "source_id": "1022fd24-..."}
  ],
  "refund_of": null,
  "pair": null,
  "events": [ /* 见下 */ ],
  …
}
```

`refunds[]` 只在 `kind == 'expense'` 的行上出现（其余 kind 是空数组），按 `occurred_at ASC` 排；每笔给日期、金额、币种、备注、退回账户五个字段（决策 §14.46 明确"每笔退款的日期、金额、备注"，账户是画界面时顺手要的）。部分退款就是多条（决策 §1.1）。

**二、退款行把 `refund_of` 展开成原单摘要**（决策 §14.46）：

```json
GET /api/v1/ledgers/8f0f7b2e-.../transactions/aa11bb22-cc33-4d44-8e55-ff6677889900
-> 200
{
  "id": "aa11bb22-...", "kind": "refund", "amount": "10.0000", "currency": "EUR",
  "occurred_at": "2026-09-04", "merchant": "Carrefour",
  "refund_of": "f59f243d-3246-49ab-adb5-60761e061571",
  "refund_of_detail": {
    "id": "f59f243d-...",
    "occurred_at": "2026-09-01",
    "merchant": "Carrefour",
    "amount": "-45.5000",
    "currency": "EUR",
    "source_id": "1022fd24-...",
    "category_l1": "groceries",
    "category_l2": "fresh_food",
    "refunded_total": "15.0000",
    "refundable": "30.5000",
    "other_refunds": [
      {"id": "bb22cc33-...", "occurred_at": "2026-09-12", "amount": "5.0000",
       "currency": "EUR", "note": "又退了一份", "source_id": "1022fd24-..."}
    ]
  },
  "refunds": [],
  "events": [ /* 见下 */ ],
  …
}
```

- `refund_of` 仍然是那个裸 UUID（保持与列表一致），`refund_of_detail` 是它的展开：日期、商户、金额、账户、分类、**已退 / 可退**（决策 §14.46 逐字要求）。
- `other_refunds`（决策 §14.52 A25）：指向**同一张原单**的其它退款行，**不含当前这条**，按日期升序，字段与 `refunds[]` 同形（含 `source_id`，同步 2026-09-12：实现复用同一模型）。用途是"这单我已经退过两次了吗"——部分退款很容易重复登记。原单只被退过这一次时它是空数组。
- 原单被删除后 `refund_of` 是 `null`（`ON DELETE SET NULL`，决策 §1.1），此时 `refund_of_detail` 也是 `null`，前端显示"原单已删除"。
- 非 refund 行上 `refund_of_detail` 恒为 `null`。

**三、两腿转账带 `pair`**（与上一版一致）：

```json
{
  "id": "1111aaaa-...", "kind": "transfer", "amount": "-100.0000", "currency": "USD",
  "transfer_role": "out", "transfer_subtype": "plain",
  "transfer_pair_id": "77777777-8888-4999-aaaa-bbbbccccdddd",
  "pair": {
    "pair_id": "77777777-8888-4999-aaaa-bbbbccccdddd",
    "out": {"transaction_id": "1111aaaa-...", "source_id": "34fa63d8-...", "amount": "-100.0000", "currency": "USD"},
    "in":  {"transaction_id": "2222bbbb-...", "source_id": "1022fd24-...", "amount": "720.0000", "currency": "CNY"}
  },
  …
}
```

非转账、或单腿转账时 `pair` 为 `null`。注意这个 `pair` 是个**精简引用**：`out` / `in` 各只有 `transaction_id`（不是 `id`）、`source_id`、`amount`、`currency` 四个字段，`pair` 上也没有 `occurred_at` / `subtype` / `note`。它和 §5.30 / §5.31 响应里那个带完整两条交易的转账对象**不是同一个形状**，前端要用两个不同的类型（[`./04-frontend.md`](./04-frontend.md) §3.3 的 `TransactionPairRef` 与 `TransferPair`）。

单腿转账（`transfer_pair_id` 为 null）上，详情页提供"关联为转账对腿"（§5.33）；两腿上提供"拆开"（§5.34）。

**四、`events[]` 操作记录**（决策 §14.51）：

```json
{
  "events": [
    {"id": "e9e9...", "event": "paired", "at": "2026-09-10T08:31:00.000000Z",
     "actor_id": "77aa1122-...", "client": "web",
     "changes": {"transfer_pair_id": {"before": null, "after": "77777777-..."},
                 "counterparty": {"before": "工资卡", "after": null}},
     "import_batch_id": null},
    {"id": "e8e8...", "event": "updated", "at": "2026-09-09T08:00:00.000000Z",
     "actor_id": "4ee1c8fa-...", "client": "web",
     "changes": {"amount": {"before": "-45.5000", "after": "-42.0000"}},
     "import_batch_id": null},
    {"id": "e7e7...", "event": "imported", "at": "2026-09-09T07:20:31.000000Z",
     "actor_id": "4ee1c8fa-...", "client": "web", "changes": null,
     "import_batch_id": "d1e2f3a4-..."}
  ]
}
```

| 字段 | 说明 |
|---|---|
| `event` | `created` \| `updated` \| `imported` \| `paired` \| `unpaired` \| `refund_linked` \| `refund_unlinked`（决策 §14.51 的七种，不多不少） |
| `at` | 事件时刻（naive UTC 存储、输出带 `Z`，§4.5）；数组按 **`at` 倒序**（最新在前） |
| `actor_id` | 操作者 user id；前端用成员列表映射成名字（§5.13） |
| `changes` | `{字段: {"before": …, "after": …}}`，只记真正变了的字段；`created` / `imported` 可以为 `null` |
| `client` | 请求头 `X-Client` 的值（§4.7），没带就是 `null`。界面显示"在 web 上"，没有值就只显示时间与人 |
| `import_batch_id` | `imported` 事件指向那一批；其余事件为 `null`。点它可以跳到 `?import_batch_id=` 的交易列表（§5.25） |

`events` 是**只追加**的：任何接口都不能改或删单条事件，交易被删时它的事件由外键级联删除（决策 §14.51），撤销导入删交易同理。事件数量正常只有个位数，所以直接全量返回，不分页。

错误：404 `not_found`（不存在、属于别的账本、账本不可见）。副作用：只读（1 条交易 + 1 条退款汇总 + 最多 1 条对腿 + 1 条事件查询 + 1 次汇率折算）。

### 5.28 `PATCH /api/v1/ledgers/{id}/transactions/{tid}`

鉴权：成员。带乐观并发（§4.4）。**只能用于单条交易**（含单腿转账）。决策 §14.3（kind 边界）、§14.51（写操作记录）。

请求体：§5.26 的全部字段都可选，外加必填的 `updated_at`。不可改的是 `id`、`ledger_id`、`transfer_pair_id`、`import_batch_id`、`created_by`、`created_at`。改 `source_id` 是允许的（记错账户很常见），但新账户同样不能是归档账户；归档账户上的**历史**交易允许修改（决策 §14.40 的 01-12）。

改 `kind` 在 `expense` / `income` / `refund` **三者之间**是允许的（比如把误记为 income 的行改成 refund），但必须在同一个请求里把相关字段一起改对：目标 kind 的符号、分类、transfer 字段都要满足 §5.26 的规则；服务端是拿"改完之后的整行"去校验的，不是只看请求里出现的字段。

**硬规则：`kind` 不能跨越 `transfer` / 非 `transfer` 的边界**（决策 §14.3，与 [`./01-domain-and-flows.md`](./01-domain-and-flows.md) §2.3 和 [`./04-frontend.md`](./04-frontend.md) §4.7 的编辑页规则一致）。这条必须**单独判**，不能指望"整行校验"兜住：一条单腿转账（`transfer_pair_id IS NULL`，走的正是本端点）只要在同一个请求里清掉 `transfer_role` / `transfer_subtype`、补上 `category_l1`、把金额改成负数，§10 的每一条 CHECK 就都满足了，整行校验根本挡不住它变成 `expense`。所以服务端在应用改动之前先比一次：

```text
crosses_transfer_boundary = (row.kind == 'transfer') != (new_kind == 'transfer')
if crosses_transfer_boundary:
    raise ApiError(400, "kind_change_not_allowed",
                   "Cannot change kind between transfer and non-transfer; delete and re-enter instead")
```

允许与禁止的完整矩阵：

| 从 → 到 | 允许？ | 说明 |
|---|---|---|
| `expense` ⇄ `income` ⇄ `refund`（任意方向） | ✓ | 服务端按目标 kind 重新校验符号与分类；分类的收支侧不对就是 400 `category_kind_mismatch` |
| 非 `transfer` → `transfer` | ✗ | 400 `kind_change_not_allowed` |
| `transfer` → 非 `transfer` | ✗ | 400 `kind_change_not_allowed` |
| `transfer` → `transfer` | ✓ | 单腿转账可以改 `transfer_subtype`、金额、日期、账户、备注；两腿的腿走 §5.31，本端点直接 409 `use_transfer_endpoint` |

理由（决策 §1.2）：转账牵扯对腿、`transfer_pair_id`、`transfer_subtype`，"改 kind"没有一个语义清楚的定义。要改就删掉重记。

```json
PATCH /api/v1/ledgers/8f0f7b2e-.../transactions/f59f243d-3246-49ab-adb5-60761e061571
X-Client: web
{"amount": "-42.00", "category_l2": "toiletries", "note": null,
 "updated_at": "2026-09-01T18:20:00.000000Z"}

-> 200
{"id": "f59f243d-...", "amount": "-42.0000", "category_l1": "groceries", "category_l2": "toiletries",
 "note": null, "updated_by": "77aa1122-...", "updated_at": "2026-09-09T06:00:00.000000Z", …}
```

显式 `null` 的语义：可空字段（`category_l2`、`merchant`、`note`、`counterparty`、`refund_of`）传 `null` 表示清空；非空字段（`amount`、`currency`、`occurred_at`、`kind`、`source_id`）传 `null` 是 422，不再像现状那样被静默跳过。

**两腿转账的保护**（决策 §1.2）：若这条交易的 `transfer_pair_id` 非空，直接返回

```json
409
{"detail": "This leg belongs to a paired transfer; use PATCH /ledgers/{id}/transactions/transfer/{pair_id}",
 "code": "use_transfer_endpoint"}
```

错误：

| 状态码 | code | 条件 |
|---|---|---|
| 404 | `not_found` | 交易不可见 |
| 409 | `stale_update` | 版本戳不一致 |
| 409 | `use_transfer_endpoint` | 该行 `transfer_pair_id` 非空 |
| 409 | `source_archived` | 改到一个已归档账户 |
| 400 | `kind_change_not_allowed` | 请求会让 `kind` 跨越 `transfer` / 非 `transfer` 的边界（决策 §14.3） |
| 400 | `repayment_target_not_credit` | 改完之后是 `repayment` **且这条是转入腿**（`transfer_role='in'`），但账户不是信用卡（决策 §14.52 A11）；`transfer_role='out'` 的单腿 `repayment` 不判定 |
| 400 | `category_invalid` / `category_kind_mismatch` / `refund_target_invalid` | 同 §5.26，按"改完之后的整行"判定 |
| 400 | `validation_error` | 符号与 kind 冲突等 |

副作用（一个事务）：`UPDATE transactions`（含 `updated_by`、`updated_at`）+ `INSERT transaction_events`（决策 §14.51）。事件的选取规则：

- 只改了普通字段 → 一条 `updated`，`changes` 里列出所有真正变了的字段（值用 API 的序列化形式，见 §4.5）。
- `refund_of` 从 null 变成某个 id → 追加一条 `refund_linked`；从有值变成 null → `refund_unlinked`。两者与 `updated` 可以在同一个请求里各写一条（一次 PATCH 最多产生两条事件）。
- 什么都没真的变（请求里的值与库里相同）→ 仍然更新 `updated_at`，但**不写**事件（不给操作记录制造噪音）。

如果这条 expense 被别的 refund 引用着，改它的金额不会连带改退款行，只是 `refundable` 变了。

### 5.29 `DELETE /api/v1/ledgers/{id}/transactions/{tid}`

鉴权：成员。**只能用于单条交易**（含单腿转账）。

```text
DELETE /api/v1/ledgers/8f0f7b2e-.../transactions/f59f243d-3246-49ab-adb5-60761e061571
-> 204
```

错误：

| 状态码 | code | 条件 |
|---|---|---|
| 404 | `not_found` | 交易不可见（重复删除也是 404） |
| 409 | `use_transfer_endpoint` | 该行 `transfer_pair_id` 非空——两腿必须一起删（§5.32） |

副作用：`DELETE transactions`。连带：

- 它的 `transaction_events` 由外键 `ON DELETE CASCADE` 一起删（决策 §14.51：事件不留孤儿，也不为已删交易保留历史）。
- 指向它的 refund 行的 `refund_of` 由数据库置 NULL（决策 §1.1 的 `ON DELETE SET NULL`），退款行本身保留；这些退款行**不会**因此得到一条 `refund_unlinked` 事件——数据库层的置空拿不到操作者，硬要补事件就得在应用层先查一遍再删，不值得。前端在退款详情里看到 `refund_of_detail` 为 `null` 就显示"原单已删除"（§5.27）。

这与现状"删一腿会把同 `transfer_pair_id` 的行全删掉"（`backend/app/api/transactions.py:447-459`）是**行为变更**：目标设计里单条删除永远只删一行。

### 5.30 `POST /api/v1/ledgers/{id}/transactions/transfer`

鉴权：成员。决策 §1.2（两腿转账、跨币种、共用 `transfer_pair_id`）、§14.52 A11（表单规则）。

| 字段 | 类型 | 必填 | 校验 |
|---|---|---|---|
| `from_source_id` | UUID | 是 | 属于本账本、未归档 |
| `to_source_id` | UUID | 是 | 属于本账本、未归档；**不能等于** `from_source_id`，否则 400 `same_source`；`subtype='repayment'` 时**必须是 `credit` 类型**，否则 400 `repayment_target_not_credit`（决策 §14.52 A11） |
| `amount_out` | Decimal | 是 | > 0（服务端存成负数）；4 位小数 |
| `currency_out` | str | 否 | `^[A-Za-z]{3}$`；省略则取 `from_source` 的 `default_currency` |
| `amount_in` | Decimal | 否 | > 0；**不要求等于** `amount_out`（跨币种，决策 §1.2）。两腿币种相同时可以省略，服务端取 `amount_out`（决策 §14.52 A11："同币种两腿只填一个金额"） |
| `currency_in` | str | 否 | `^[A-Za-z]{3}$`；省略则取 `to_source` 的 `default_currency` |
| `occurred_at` | date | 是 | 两腿共用同一天 |
| `subtype` | str | 是 | `plain` \| `repayment`（决策 §1.2；`repayment` = 信用卡还款） |
| `note` | str \| null | 否 | ≤ 500，两腿都写同样的值 |

请求里**没有** `counterparty`：有对腿就不填对方文本（决策 §1.2 的 CHECK `transfer_pair_id IS NULL OR counterparty IS NULL`）。也**没有** `merchant`：转账不设商户（决策 §14.52 B16）。手续费另记一笔 `expense`（分类 `other` / `fees`，决策 §1.2），本接口不代劳。

跨币种时汇率只是**只读参考**（决策 §14.52 A10）：服务端不接受也不需要客户端传汇率，两腿各存自己的金额与币种，界面上显示的"隐含汇率"是前端拿两个金额算出来的展示值，改它就是改另一腿的金额。

```json
POST /api/v1/ledgers/8f0f7b2e-.../transactions/transfer
X-Client: web
{
  "from_source_id": "34fa63d8-5776-4775-982b-4d58deb0ace9",
  "to_source_id": "1022fd24-78a1-4c09-9de9-1cd7fbb0877f",
  "amount_out": "100.00",
  "currency_out": "USD",
  "amount_in": "720.00",
  "currency_in": "CNY",
  "occurred_at": "2026-09-06",
  "subtype": "plain",
  "note": "换汇到人民币账户"
}

-> 201
{
  "pair_id": "77777777-8888-4999-aaaa-bbbbccccdddd",
  "occurred_at": "2026-09-06",
  "subtype": "plain",
  "note": "换汇到人民币账户",
  "updated_at": "2026-09-06T12:00:00.000000Z",
  "out": {
    "id": "1111aaaa-2222-4bbb-8ccc-3333dddd4444",
    "source_id": "34fa63d8-5776-4775-982b-4d58deb0ace9",
    "kind": "transfer", "occurred_at": "2026-09-06",
    "transfer_role": "out", "transfer_subtype": "plain",
    "amount": "-100.0000", "currency": "USD", "counterparty": null,
    "amount_base": "-724.5000", "rate_used": "7.24500000", "rate_date": "2026-09-05",
    "transfer_pair_id": "77777777-8888-4999-aaaa-bbbbccccdddd",
    "note": "换汇到人民币账户",
    "created_at": "2026-09-06T12:00:00.000000Z", "updated_at": "2026-09-06T12:00:00.000000Z"
  },
  "in": {
    "id": "2222bbbb-3333-4ccc-8ddd-4444eeee5555",
    "source_id": "1022fd24-78a1-4c09-9de9-1cd7fbb0877f",
    "kind": "transfer", "occurred_at": "2026-09-06",
    "transfer_role": "in", "transfer_subtype": "plain",
    "amount": "720.0000", "currency": "CNY", "counterparty": null,
    "amount_base": "720.0000", "rate_used": "1.00000000", "rate_date": "2026-09-06",
    "transfer_pair_id": "77777777-8888-4999-aaaa-bbbbccccdddd",
    "note": "换汇到人民币账户",
    "created_at": "2026-09-06T12:00:00.000000Z", "updated_at": "2026-09-06T12:00:00.000000Z"
  }
}
```

（同步 2026-09-12）顶层 `updated_at` 取两腿 `updated_at` 中**较大**的那个，与 §5.31 的口径一致；本例两腿相等所以就是这个值。

错误：

| 状态码 | code | 条件 |
|---|---|---|
| 404 | `not_found` | 账本不可见；某个 `source_id` 不属于本账本 |
| 409 | `source_archived` | 任一账户已归档 |
| 400 | `same_source` | `to_source_id == from_source_id`（转出转入是同一个账户） |
| 400 | `repayment_target_not_credit` | `subtype='repayment'` 但转入账户不是 `credit`（决策 §14.52 A11） |
| 400 | `validation_error` | 金额 ≤ 0；币种不支持；`subtype` 不在枚举内；省略了 `amount_in` 但两腿币种不同 |

副作用（**一个事务**）：生成一个新的 `pair_id`（服务端生成，客户端不能指定），插入两行 `transactions`，`kind='transfer'`、`transfer_pair_id = pair_id`、`transfer_role` 分别为 `out` / `in`、`transfer_subtype = subtype`、`category_l1/l2` 与 `merchant` 与 `counterparty` 全为 NULL，再给两条各写一条 `transaction_events(event='created')`（决策 §14.51）。数据库唯一约束 `UNIQUE (transfer_pair_id, transfer_role)`（决策 §10）保证一个 pair 最多两腿。任一腿失败整个事务回滚——这正是现状 H-01"前端发两次 POST、第二次失败要靠客户端补偿删除"的问题所修复的地方。

### 5.30a `GET /api/v1/ledgers/{id}/transactions/transfer/{pair_id}`（同步 2026-09-12）

鉴权：成员。第五阶段前端实现时补上：[04 §1.2](./04-frontend.md#12-路由表) 的两腿详情 / 编辑路由只带 `pair_id`（深链接、刷新、分享都只有它），而两腿详情之前只能经由某一条腿的 §5.27 详情里的 `pair` 引用再读两次，页面拿不到腿 id 时无路可走。响应形状与 §5.30 **逐字段一致**（顶层取转出腿，`updated_at` 取两腿较大者）。

| 状态 | code | 何时 |
|---|---|---|
| 200 | — | 正常 |
| 404 | `not_found` | 账本不可见；`pair_id` 不在本账本 |
| 409 | `transfer_pair_incomplete` | 该 pair 下不是恰好两条腿 |

### 5.31 `PATCH /api/v1/ledgers/{id}/transactions/transfer/{pair_id}`

鉴权：成员。决策 §1.2（"有 `transfer_pair_id` 的两腿只能通过…一起修改"）。带乐观并发。

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `updated_at` | datetime | 是 | 取两腿 `updated_at` 中**较大**的那个（响应里的 `updated_at` 字段就是这个值）；服务端对两腿都比对（决策 §14.40 的 01-11） |
| `from_source_id` | UUID | 否 | 换转出账户 |
| `to_source_id` | UUID | 否 | 换转入账户 |
| `amount_out` | Decimal | 否 | > 0 |
| `currency_out` | str | 否 | — |
| `amount_in` | Decimal | 否 | > 0 |
| `currency_in` | str | 否 | — |
| `occurred_at` | date | 否 | **同写两腿**（决策 §14.53a） |
| `subtype` | str | 否 | **同写两腿**（决策 §14.53a）；改成 `repayment` 时转入账户必须是 `credit` |
| `note` | str \| null | 否 | **同写两腿**（决策 §14.53a） |

不能改的：`pair_id` 本身、`kind`（转账不能改成别的 kind——要改请先删除再重记）、单腿的 `transfer_role`。要把两腿拆成两条单腿请用 §5.34。

**`occurred_at` / `subtype` / `note` 这三个字段同写两腿**（决策 §14.53a）：本端点是把一对转账当一个对象改，改完之后两腿这三列一定相等。它们在响应顶层也各出现一次——**顶层取的是转出腿的值**（决策 §14.53a 统一口径；本端点改完两腿相等，所以取哪一腿都一样，写死取转出腿是为了和 §5.33 配对出来的那种"两腿日期本来就不同"的情况用同一条规则）。其余字段（金额、币种、账户）本来就是每腿一份，只改被点名的那一腿。

```json
PATCH /api/v1/ledgers/8f0f7b2e-.../transactions/transfer/77777777-8888-4999-aaaa-bbbbccccdddd
{"amount_in": "715.00", "note": "换汇（按实际到账改）",
 "updated_at": "2026-09-06T12:00:00.000000Z"}

-> 200
{"pair_id": "77777777-...", "occurred_at": "2026-09-06", "subtype": "plain",
 "note": "换汇（按实际到账改）",
 "out": {"id": "1111aaaa-...", "amount": "-100.0000", "currency": "USD", …},
 "in":  {"id": "2222bbbb-...", "amount": "715.0000", "currency": "CNY", …},
 "updated_at": "2026-09-09T06:30:00.000000Z"}
```

错误：

| 状态码 | code | 条件 |
|---|---|---|
| 404 | `not_found` | 账本不可见；该账本下没有这个 `pair_id` |
| 409 | `transfer_pair_incomplete` | 该 `pair_id` 下不是恰好两腿（数据损坏保护） |
| 409 | `stale_update` | 两腿中任意一腿的 `updated_at` 比请求里的新 |
| 409 | `source_archived` | 换到已归档账户 |
| 400 | `same_source` | 改完之后两腿指向同一个账户 |
| 400 | `repayment_target_not_credit` | 改完之后 `repayment` 的转入账户不是信用卡 |
| 400 | `validation_error` | 金额 ≤ 0；币种不支持 |

副作用（一个事务）：`SELECT … WHERE transfer_pair_id = :pair_id FOR UPDATE`（锁住两行）→ 两条 `UPDATE transactions` → 给**每一腿**各写一条 `transaction_events(event='updated')`（决策 §14.51；只写真正变了的字段，两腿都没变就不写）。

### 5.32 `DELETE /api/v1/ledgers/{id}/transactions/transfer/{pair_id}`

鉴权：成员。决策 §1.2。

```text
DELETE /api/v1/ledgers/8f0f7b2e-.../transactions/transfer/77777777-8888-4999-aaaa-bbbbccccdddd
-> 204
```

错误：

| 状态码 | code | 条件 |
|---|---|---|
| 404 | `not_found` | 账本不可见；该账本下没有这个 `pair_id`（重复删除也是 404） |

`transfer_pair_incomplete` 在这里**不报错**：只剩一腿也照删不误，删除本来就是要把这个 pair 清干净。

副作用（一个事务）：`DELETE FROM transactions WHERE ledger_id = :id AND transfer_pair_id = :pair_id`，两腿的 `transaction_events` 随外键级联删除。

### 5.33 `POST /api/v1/ledgers/{id}/transactions/{tid}/pair`

鉴权：成员。决策 §14.34（两条单腿转账可以配对成一笔转账；"交易详情页提供『关联为转账对腿』"）。

把 `{tid}` 这条**单腿**转账和另一条单腿转账绑成一笔两腿转账：两条共用一个新生成的 `transfer_pair_id`，各自的 `counterparty` 文本被清空（有对腿就不填对方文本，决策 §1.2 的 CHECK）。

| 字段 | 类型 | 必填 | 校验 |
|---|---|---|---|
| `other_transaction_id` | UUID | 是 | 要配对的另一条交易，见下面六条 |

校验（任何一条不过都是 400 `pair_invalid`，`detail` 说明是哪一条）：

```text
1. 两条都存在且 ledger_id 都等于路径里的账本      （否则 404 not_found / 400 pair_invalid）
2. 两条 kind 都是 'transfer'
3. 两条的 transfer_pair_id 都是 NULL             （已经成对的不能再配，先 §5.34 拆开）
4. 两条的 transfer_role 相反                     （一条 out 一条 in）
5. 两条的 source_id 不同                         （同一个账户内部转不成账）
6. other_transaction_id != tid                   （不能和自己配对）
```

**不校验**金额相等、币种相同、日期相同（决策 §1.2：两腿转账支持跨币种、金额不要求相等；导入里的 ±3 天窗口只是**寻找候选**的规则，不是配对的硬约束，决策 §14.34）。前端在两条差得离谱时给个提示即可。

**也不校验两腿的 `transfer_subtype` 是否相同**（决策 §14.53a）。同一笔信用卡还款在两份账单里本来就常常写成两种子类型——储蓄卡账单只知道"转出一笔钱"写 `plain`，信用卡账单知道这是还款写 `repayment`——把它硬卡成 400 会让这类配对永远触发不了，而这恰恰是配对功能最主要的用途。

**配对成功时服务端把两腿统一成同一个子类型**（决策 §14.53a），规则只有一条：

```text
任一腿的 transfer_subtype == 'repayment'  且  转入腿(role='in')的账户 type == 'credit'
    -> 整对写成 'repayment'
否则
    -> 整对写成 'plain'
```

"转入腿账户是信用卡"这个附加条件是为了和 §4.2 的 `repayment_target_not_credit` 不打架：往一个非信用卡账户里转钱不叫还款，哪怕某一腿的原始值写着 `repayment`，配对之后也要按 `plain` 存。**这里不会返回 `repayment_target_not_credit`**——子类型是服务端算出来的，算不出 `repayment` 就退回 `plain`，不拿它拒绝用户的配对请求。

两腿在**同一个事务**里被改成这同一个值；子类型真的变了的那一腿（可能是一腿，也可能两腿都变）除了 `paired` 事件外**再各写一条 `transaction_events(event='updated')`**，`changes` 记 `transfer_subtype` 的前后值（决策 §14.51、§14.53a）。

**两腿的 `occurred_at` 允许不同**（决策 §14.53a）：配对出来的一对保留各自的日期（刷卡日与入账日差一两天是常态），服务端不去对齐它们。响应里每一腿都带自己的 `occurred_at`，顶层那个是转出腿的值。

```json
POST /api/v1/ledgers/8f0f7b2e-.../transactions/9a8b7c6d-.../pair
X-Client: web
{"other_transaction_id": "5c4d3e2f-1111-4222-8333-444455556666"}

-> 200
{
  "pair_id": "88888888-9999-4aaa-bbbb-ccccddddeeee",
  "occurred_at": "2026-09-05",
  "subtype": "repayment",
  "note": "还信用卡",
  "updated_at": "2026-09-10T08:31:00.000000Z",
  "out": {
    "id": "5c4d3e2f-...",
    "source_id": "34fa63d8-...",
    "kind": "transfer", "occurred_at": "2026-09-05",
    "transfer_role": "out", "transfer_subtype": "repayment",
    "amount": "-3000.0000", "currency": "CNY", "counterparty": null,
    "amount_base": "-3000.0000", "rate_used": "1.00000000", "rate_date": "2026-09-05",
    "transfer_pair_id": "88888888-9999-4aaa-bbbb-ccccddddeeee",
    "note": "还信用卡",
    "created_at": "2026-09-05T21:04:00.000000Z", "updated_at": "2026-09-10T08:31:00.000000Z"
  },
  "in": {
    "id": "9a8b7c6d-...",
    "source_id": "5b6c7d8e-...",
    "kind": "transfer", "occurred_at": "2026-09-06",
    "transfer_role": "in", "transfer_subtype": "repayment",
    "amount": "3000.0000", "currency": "CNY", "counterparty": null,
    "amount_base": "3000.0000", "rate_used": "1.00000000", "rate_date": "2026-09-06",
    "transfer_pair_id": "88888888-9999-4aaa-bbbb-ccccddddeeee",
    "note": "AUTOPAY",
    "created_at": "2026-09-06T07:15:00.000000Z", "updated_at": "2026-09-10T08:31:00.000000Z"
  }
}
```

这个例子正好演示了上面两条规则：转出腿来自储蓄卡账单、原本是 `plain`，转入腿来自信用卡账单、原本是 `repayment`，而转入腿的账户 `5b6c7d8e`（招商 信用卡）是 `credit` 类型，所以整对统一成 `repayment`，转出腿那条另外多一条 `updated` 事件记下 `plain → repayment`。两腿日期一个 9-5 一个 9-6，配对后**各自保留**（决策 §14.53a）。

响应形状与 §5.30 的两腿转账对象**逐字段一致**（同步 2026-09-12：含顶层 `updated_at`，取两腿中较大者，与 §5.31 一致）：顶层 `pair_id` + `occurred_at` + `subtype` + `note` + `updated_at` + `out` + `in`，每一腿都是同一套 16 个字段（`id`、`source_id`、`kind`、`occurred_at`、`transfer_role`、`transfer_subtype`、`amount`、`currency`、`counterparty`、`amount_base`、`rate_used`、`rate_date`、`transfer_pair_id`、`note`、`created_at`、`updated_at`），04 的 `TransferPair` 类型按这一份定义、两个端点共用（决策 §14.53f）。差别只在**取值**：§5.30 建出来的两腿 `occurred_at` 与 `note` 必然相同，而本端点配对出来的两腿可能各不相同（决策 §14.53a），所以界面得按腿显示哪一腿是 9-5、哪一腿是 9-6。顶层的 `occurred_at` / `subtype` / `note` **取转出腿的值**（决策 §14.53a；不是取 `{tid}` 这一条——`{tid}` 可能是任意一腿，取转出腿才能保证同一对转账在任何入口下顶层摘要都一样）。`subtype` 经过上面的统一之后两腿必然相同；`occurred_at` 与 `note` 两腿仍可能各不相同，各腿的真值在各自的对象里，顶层这两个只是给界面显示用的摘要。

错误：

| 状态码 | code | 条件 |
|---|---|---|
| 404 | `not_found` | 账本不可见；`{tid}` 或 `other_transaction_id` 不在本账本 |
| 400 | `pair_invalid` | 上面六条校验中的任意一条不过（`detail` 指明原因） |
| 409 | `stale_update` | 不适用——本端点**不做**乐观并发：它只改 `transfer_pair_id`、`transfer_subtype`、`counterparty` 三列，不碰金额日期账户；并发下两个人同时配对同一条，第二个会因为第 3 条校验（对方已非单腿）得到 400 `pair_invalid` |

副作用（一个事务）：对两行 `SELECT … FOR UPDATE` → 生成新的 `pair_id` → 按上面的规则算出统一后的 `transfer_subtype` → 两条 `UPDATE transactions SET transfer_pair_id = :pair_id, transfer_subtype = :subtype, counterparty = NULL, updated_by, updated_at` → 给两条各写一条 `transaction_events(event='paired')`，`changes` 里记 `transfer_pair_id` 与 `counterparty` 的前后值（决策 §14.51）；子类型真的变了的腿**再各写一条 `event='updated'`**，`changes` 记 `transfer_subtype` 的前后值（决策 §14.53a）。

导入 review 里勾了"关联为一笔转账"的行**不走这个端点**：那是在 commit 时一次性完成的（§5.43），走的是同一段代码路径。这个端点是给"导入之后才发现该配对"和"手工记了两条单腿"准备的（决策 §14.34："两种关联在导入之后都可以在交易页修改或解除"）。

### 5.34 `POST /api/v1/ledgers/{id}/transactions/transfer/{pair_id}/unpair`

鉴权：成员。决策 §14.34（"『拆开』（两腿各自变回单腿）"）。

把一笔两腿转账拆成两条独立的单腿转账：`transfer_pair_id` 置 NULL，两条交易都保留（金额、日期、账户、subtype 都不动）。

无请求体。

```json
POST /api/v1/ledgers/8f0f7b2e-.../transactions/transfer/77777777-8888-4999-aaaa-bbbbccccdddd/unpair
X-Client: web

-> 200
{
  "pair_id": "77777777-8888-4999-aaaa-bbbbccccdddd",
  "unpaired": [
    {"id": "1111aaaa-...", "source_id": "34fa63d8-...", "kind": "transfer",
     "transfer_role": "out", "transfer_subtype": "plain", "amount": "-100.0000",
     "currency": "USD", "transfer_pair_id": null, "counterparty": null,
     "updated_at": "2026-09-10T09:00:00.000000Z"},
    {"id": "2222bbbb-...", "source_id": "1022fd24-...", "kind": "transfer",
     "transfer_role": "in", "transfer_subtype": "plain", "amount": "720.0000",
     "currency": "CNY", "transfer_pair_id": null, "counterparty": null,
     "updated_at": "2026-09-10T09:00:00.000000Z"}
  ]
}
```

拆开之后：

- 两条都变成单腿转账，各自计入自己账户的余额（口径不变，决策 §1.2），仍然不计入收支统计。
- `counterparty` **不会**被自动填上对方账户的名字——拆开的语义是"这两笔其实没关系"，猜一个对手文本只会制造假数据。用户想写就自己去 §5.28 填。
- 两条从此可以各自用 §5.28 / §5.29 修改和删除（不再返回 `use_transfer_endpoint`）。
- 跨币种的两腿拆开后各自保留自己的币种与金额，不做任何折算或调平。

错误：

| 状态码 | code | 条件 |
|---|---|---|
| 404 | `not_found` | 账本不可见；该账本下没有这个 `pair_id` |
| 409 | `unpair_invalid` | 该 `pair_id` 下不是恰好两腿（只剩一腿的损坏数据：这时应该直接删掉那一腿或手工修数据，而不是拆） |

副作用（一个事务）：`SELECT … WHERE transfer_pair_id = :pair_id FOR UPDATE` → 两条 `UPDATE transactions SET transfer_pair_id = NULL, updated_by, updated_at` → 给两条各写一条 `transaction_events(event='unpaired')`（决策 §14.51）。

### 5.35 `GET /api/v1/ledgers/{id}/stats/summary`

鉴权：成员。决策 §7（按月、按一级分类、可下钻二级、退款按退款日期冲减、转账不计入、按账本基准币种折算）。

| query 参数 | 类型 | 默认 | 校验 |
|---|---|---|---|
| `month` | str | 当前 UTC 月 | `^\d{4}-(0[1-9]\|1[0-2])$` |

```json
GET /api/v1/ledgers/8f0f7b2e-.../stats/summary?month=2026-09
-> 200
{
  "month": "2026-09",
  "base_currency": "CNY",
  "expense_total": "8421.6600",
  "income_total": "23500.0000",
  "net": "15078.3400",
  "expense": [
    {
      "code": "food", "name_zh": "餐饮", "name_en": "Food & Dining",
      "amount": "2310.5000", "share": 0.2743, "count": 41,
      "children": [
        {"code": "lunch", "name_zh": "午餐", "name_en": "Lunch", "amount": "980.0000", "count": 22},
        {"code": "dinner", "name_zh": "晚餐", "name_en": "Dinner", "amount": "1130.5000", "count": 17},
        {"code": null, "name_zh": "未细分", "name_en": "Unspecified", "amount": "200.0000", "count": 2}
      ]
    },
    {
      "code": "groceries", "name_zh": "生活购物", "name_en": "Groceries & Household",
      "amount": "1204.1200", "share": 0.1430, "count": 12,
      "children": [
        {"code": "fresh_food", "name_zh": "买菜", "name_en": "Fresh Food", "amount": "1204.1200", "count": 12}
      ]
    }
  ],
  "income": [
    {
      "code": "salary", "name_zh": "工资", "name_en": "Salary",
      "amount": "23500.0000", "share": 1.0, "count": 1,
      "children": [
        {"code": "base_salary", "name_zh": "基本工资", "name_en": "Base Salary", "amount": "23500.0000", "count": 1}
      ]
    }
  ],
  "refund_total": "82.9800",
  "rate_missing_count": 0
}
```

口径（全部来自决策 §7、§1、§8）：

- 只统计 `occurred_at` 落在该月的行；`kind = 'transfer'` 的行**完全不计入**（单腿两腿都一样）。
- `expense` 的金额是**正数**（把 `amount` 取绝对值后汇总），前端不用再处理符号。
- `refund` 按**退款日期**（它自己的 `occurred_at`）冲减它自己的 `category_l1` / `category_l2` —— 也就是说 9 月退了 8 月的支出，减的是 9 月这个分类的数，8 月的数不动（决策 §1.1）。冲减可能让某个分类变成负数，照实返回。
- `refund_total` 是当月退款总额（正数），单独给出来供界面说明"其中已冲减退款 ¥82.98"。
- 每一行的金额都是 `amount_base`（按该行 `occurred_at` 的汇率折算，决策 §8），求和在应用层做（先批量折算再 `sum`），不是在 SQL 里对原币求和。
- `children` 里 `code: null` 的那条表示"有一级没二级"的部分。
- 金额为 0 的一级分类不出现在数组里；数组按 `amount` 降序。
- `share` = 该一级 / 对应的 total，浮点数保留 4 位；total 为 0 时全部为 `0`。
- `rate_missing_count`：因为汇率取不到而被跳过的行数，正常是 0；不为 0 时前端要提示"部分交易未计入"。

错误：

| 状态码 | code | 条件 |
|---|---|---|
| 404 | `not_found` | 账本不可见 |
| 422 | `validation_error` | `month` 格式不对 |

副作用：只读。一条按 `(kind, category_l1, category_l2, currency, occurred_at)` 分组的聚合查询 + 一次 `fx.convert_many`。

### 5.36 `GET /api/v1/ledgers/{id}/stats/trend`

鉴权：成员。决策 §7 与 §14.52 B20：**最近 12 个月只回支出**（首页那张图只放支出，收入不放——屏幕放不下，两条线也没人真的对比着看）。

| query 参数 | 类型 | 默认 | 校验 |
|---|---|---|---|
| `months` | int | 12 | 1..36 |
| `end` | str | 当前 UTC 月 | `YYYY-MM`；序列的最后一个月 |

```json
GET /api/v1/ledgers/8f0f7b2e-.../stats/trend?months=12
-> 200
{
  "base_currency": "CNY",
  "months": [
    {"month": "2025-10", "expense": "7210.0000"},
    {"month": "2025-11", "expense": "9930.2000"},
    {"month": "2025-12", "expense": "14022.7000"},
    {"month": "2026-01", "expense": "6880.0000"},
    {"month": "2026-02", "expense": "7150.5000"},
    {"month": "2026-03", "expense": "8004.0000"},
    {"month": "2026-04", "expense": "9120.4000"},
    {"month": "2026-05", "expense": "8890.0000"},
    {"month": "2026-06", "expense": "10420.0000"},
    {"month": "2026-07", "expense": "12500.9000"},
    {"month": "2026-08", "expense": "7742.1000"},
    {"month": "2026-09", "expense": "8421.6600"}
  ],
  "rate_missing_count": 0
}
```

口径与 §5.35 一致：`expense` 为**正数**、退款按退款月冲减 expense、转账不计入、全部折算到账本基准币种（决策 §7、§8）。**没有 `income` / `net` 两个字段**（决策 §14.52 B20）——需要看收入就去 §5.35 的月度汇总。**没有交易的月份也要出现**（`expense` 是 `"0.0000"`），前端画折线不用补洞。

不提供月均 / 峰值等派生数字（决策 §14.52 A21：那属于"报表"页，本版不做）；前端要显示"最高的一个月"就自己在这 12 个数上取最大值。

错误：404 `not_found`；422 `validation_error`（`months` 越界、`end` 格式错）。副作用：只读，一条按 `(月份, kind, currency, occurred_at)` 分组的聚合 + 一次批量折算。

### 5.37 `POST /api/v1/ledgers/{id}/imports`

鉴权：成员。决策 §5（标准 CSV、同步校验、状态机、限制）、§14.30（版本硬校验）、§14.47（只收 CSV）。

**这是一个同步端点**：请求返回时校验已经做完，批次和全部草稿行一起给出来。没有 202、没有后台任务、没有进度轮询、没有"正在解析"——应用不调任何大模型，它要做的只是读一份纯文本 CSV 并逐行校验（决策 §14.25）。

两种请求体，走同一套校验（决策 §5："上传文件或在应用内文本框直接粘贴 CSV 文本，两者走同一校验"）：

**A. 上传文件**——`multipart/form-data`：

| 字段 | 类型 | 必填 | 校验 |
|---|---|---|---|
| `file` | 文件 | 是 | ≤ `MAX_UPLOAD_MB`（2 MB）；内容必须是 UTF-8（允许 BOM）文本；文件名只用于展示 |
| `source_id` | 文本（UUID） | 是 | 目标账户，属于本账本、未归档（决策 §5"一份文件对应一个目标账户，上传时由用户选"） |

**B. 粘贴文本**——`application/json`：

| 字段 | 类型 | 必填 | 校验 |
|---|---|---|---|
| `source_id` | UUID | 是 | 同上 |
| `text` | str | 是 | 直接粘进来的 CSV 文本；UTF-8 编码后 ≤ `MAX_UPLOAD_MB` |

处理顺序（全部同步，任何一步失败都**不建批次**）：

```text
1. get_ledger_member                                              -> 404 not_found
2. ratelimit.check("import", user_id, 10/hour)                    -> 429 import_rate_limited
3. source 属于本账本且未归档                                      -> 404 not_found / 409 source_archived
4. 读取请求体，累计字节数，超过上限立即中断                       -> 413 file_too_large
5. UTF-8（允许 BOM）解码（先于版本检查）                          -> 400 import_format_invalid
6. 首行必须是 "# version: <日期串>"，缺这一行是结构错误           -> 400 import_format_invalid（缺行）
   版本行在、但版本串 != CATEGORY_VERSION                         -> 400 skill_outdated（不符）
7. 第二行必须是 11 列固定表头，逐列逐字相等                       -> 400 import_format_invalid
8. 逐行拆 CSV，列数不对的行按行号收集                             -> 400 import_format_invalid
9. 数据行数 > IMPORT_MAX_ROWS(2000)                               -> 400 rows_exceed_limit
10. 行级校验（不丢行、只改值并写 hint）+ 自动标记
11. 一个事务：INSERT import_batches(status='ready') + INSERT import_rows × N
12. 201，响应体 = 批次 + 全部草稿行
```

第 6 步内部的两分很关键（决策 §14.53d）：**版本行存在但对不上是 `skill_outdated`，版本行根本没有是 `import_format_invalid`**。理由是这两种情况该给的提示不一样——前者用户手上确实有一份 skill，只是旧了，修法是"去导入指南页重新装一次"；后者说明这份文件压根不是 skill 产出的标准 CSV（自己拿 Excel 另存的、从别处复制的），修法是"让你的 ChatGPT / Claude 按标准格式重新导出一份"。同理，第 5 步的解码失败排在版本检查**前面**：字符都读不出来时无从判断有没有版本行（决策 §14.30、§5、§14.53d）。

```json
POST /api/v1/ledgers/8f0f7b2e-.../imports
Content-Type: multipart/form-data; boundary=----X
（file=2026-08-cmb-credit.csv, source_id=5b6c7d8e-...）

-> 201
{
  "batch": {
    "id": "d1e2f3a4-5566-4778-899a-bbccddeeff00",
    "ledger_id": "8f0f7b2e-2a20-4c39-9c0f-2a9d5a1b6c31",
    "source_id": "5b6c7d8e-...",
    "source_name": "招商 信用卡",
    "source": "csv",
    "filename": "2026-08-cmb-credit.csv",
    "size_bytes": 18432,
    "skill_version": "2026-09-10",
    "status": "ready",
    "row_count": 128,
    "net_amount": "-4210.5500",
    "base_currency": "CNY",
    "flags_summary": {"duplicate": 3, "refund_candidate": 1, "transfer_candidate": 2, "needs_review": 7},
    "row_status_summary": {"pending": 128, "edited": 0, "skipped": 0},
    "uncategorized_count": 5,
    "warnings": [],
    "created_by": "4ee1c8fa-...",
    "created_at": "2026-09-09T07:00:00.000000Z",
    "updated_at": "2026-09-09T07:00:00.000000Z",
    "committed_at": null
  },
  "rows": [ /* 全部 128 条草稿行，字段与 §5.40 的 item 完全一致，按 row_no 升序 */ ]
}
```

粘贴文本的请求：

```json
POST /api/v1/ledgers/8f0f7b2e-.../imports
Content-Type: application/json
{"source_id": "5b6c7d8e-...", "text": "# version: 2026-09-10\ndate,amount,currency,kind,transfer_role,transfer_subtype,merchant,note,category_l1,category_l2,source_ref\n2026-08-03,-128.50,CNY,expense,,,全家便利店,,food,snacks_drinks,\n"}

-> 201
{"batch": {"source": "paste", "filename": null, "size_bytes": 214, "row_count": 1, …}, "rows": [ … ]}
```

**批次对象的字段**。前一半**逐列对应 [`./02-database.md`](./02-database.md) §1.7 的 `import_batches` DDL，字段名与列名一字不差**（决策 §14.53e：批次列名以 02 §1.7 为准，03 的响应与 05 的描述用同一套名字，不另起别名）：

| 字段 | 来源 | 说明 |
|---|---|---|
| `id` / `ledger_id` / `source_id` / `created_by` | 列 | 原样下发；`created_by` 只回 UUID，前端用成员列表映射成上传人（决策 §14.43 的 03-4） |
| `source` | 列 | `csv`（上传文件）或 `paste`（粘贴文本）。**没有第三种取值**（决策 §14.47） |
| `filename` | 列 | 上传时的原文件名（≤200 字、过滤控制字符），粘贴时为 `null`。**文件本身不保存**（决策 §14.28），这里只留个名字给历史列表看 |
| `size_bytes` | 列 | 上传文件或粘贴文本的 UTF-8 字节数 |
| `skill_version` | 列 | 文件首行声明的版本；能建出批次就一定等于 `CATEGORY_VERSION` |
| `status` | 列 | 只有 `ready` 与 `committed` 两个值（决策 §5） |
| `row_count` | 列 | 校验后落库的草稿行数（含 skipped） |
| `warnings` | 列 | 整批级别的警告数组（不针对某一行的提示，例如"第 1 行之外还有一行注释，已忽略"）；没有警告时是空数组。**行级**说明写在各行的 `hint` 上，不进这里 |
| `created_at` / `updated_at` / `committed_at` | 列 | 上传时刻 / 草稿最后一次编辑时刻 / 提交时刻（未提交为 `null`） |
| `source_name` | 派生 | 目标账户名（`finance_sources.name`），批次列表要显示目标账户（决策 §14.52 A17），省得前端再查一次 |
| `net_amount` | 派生 | 这一批全部非 skipped 行折算到基准币种后的净额（收入 - 支出，转账不计入），供批次列表显示（决策 §14.52 A17） |
| `base_currency` | 派生 | `net_amount` 用的账本基准币种 |
| `flags_summary` | 派生 | 四种标记各有多少行——批次列表上的"标记数"就是这四个数（决策 §14.52 A17）；只有这四种，没有「合并重复」那一种（决策 §14.31） |
| `row_status_summary` | 派生 | `pending` / `edited` / `skipped` 三种行状态各多少行（决策 §14.52 B13：没有"已确认"这种状态） |
| `uncategorized_count` | 派生 | `category_l1 IS NULL` 且 `kind != 'transfer'` 的行数——提交前必须补齐的那些（决策 §1.3） |

**派生字段不是列**：它们每次查询现算（一条按 `batch_id` 的聚合 + 一次 `fx.convert_many`），库里不存冗余计数（[`./02-database.md`](./02-database.md) §1.7 把 `committed_transaction_count` 那类列删掉的理由）。

**结构错误的响应**（400，按行号列出，不建批次，决策 §5、§14.52 B2）：

```json
-> 400
{
  "detail": "CSV structure is invalid: 3 problem(s)",
  "code": "import_format_invalid",
  "errors": [
    {"line": 2, "message": "表头第 5 列应为 transfer_role，实际为 counterparty"},
    {"line": 14, "message": "该行有 10 列，应为 11 列"},
    {"line": 87, "message": "该行有 12 列，应为 11 列"}
  ]
}
```

缺 `# version:` 行走的是同一个 code（决策 §14.53d），只是 `errors` 里只有一条：

```json
-> 400
{
  "detail": "CSV structure is invalid: missing '# version:' line",
  "code": "import_format_invalid",
  "errors": [
    {"line": 1, "message": "第 1 行应为 \"# version: <日期串>\"，请用导入指南页的 skill 重新导出"}
  ]
}
```

`errors` 是错误体在**这一个 code 上**的扩展字段（§4.1 的 `detail` / `code` 两个键仍在，前端仍可以只按 code 显示文案）。`line` 是文件里的物理行号（1 起，`# version:` 行是第 1 行、表头是第 2 行），方便用户在自己的编辑器里跳过去。界面上这份清单要能一键复制（决策 §14.52 A18）。

**行级问题不在这里**（决策 §14.52 B2）：日期格式错、金额不是数字、kind 不认识、分类 code 不存在——这些**不退回文件**，而是照常建批次、把值改成能用的、给该行打 `needs_review` 并写 `hint`，由用户在 review 表格里处理（决策 §5，规则逐条见 [`./05-import-and-llm.md`](./05-import-and-llm.md) §2）。

**版本不符的响应**（400，决策 §14.30）：

```json
-> 400
{
  "detail": "Import file was produced by an outdated skill (file: 2026-08-20, current: 2026-09-10)",
  "code": "skill_outdated",
  "current_version": "2026-09-10",
  "file_version": "2026-08-20",
  "guide_url": "/import/guide"
}
```

这个响应体**只在版本行存在且对不上时**出现，所以 `file_version` 一定是个非空版本串；缺版本行的那种情况在上面已经被 `import_format_invalid` 拦掉了（决策 §14.53d）。**不允许带警告继续**（决策 §14.30 明确"不再是警告"）：分类表变了意味着旧 skill 可能产出已经不存在的 code，与其事后一行行修，不如让用户花十秒重装一次 skill。`guide_url` 指向应用内的导入指南页（§5.7），前端把它渲染成一个按钮。

错误：

| 状态码 | code | 条件 |
|---|---|---|
| 404 | `not_found` | 账本不可见；`source_id` 不属于本账本 |
| 409 | `source_archived` | 目标账户已归档（决策 §3） |
| 400 | `skill_outdated` | `# version:` 行存在、但版本串与 `CATEGORY_VERSION` 不一致（决策 §14.30、§14.53d） |
| 400 | `import_format_invalid` | 编码不可读、缺 `# version:` 行、表头不符、某行列数不对（`errors` 按行号列出，决策 §14.53d） |
| 400 | `rows_exceed_limit` | 数据行数超过 `IMPORT_MAX_ROWS`（2000） |
| 413 | `file_too_large` | 超过 `MAX_UPLOAD_MB`（2 MB） |
| 429 | `import_rate_limited` | 每用户每小时超过 `RATE_LIMIT_IMPORTS_PER_HOUR`（10）批 |

副作用（一个事务）：`INSERT import_batches`（`status='ready'`）+ N 条 `INSERT import_rows`。**不写任何文件**（决策 §14.28：后端没有文件系统状态）、不调 LLM；汇率只为算 `net_amount` 走一次 `fx.convert_many`（§6.3）——命中 `exchange_rates` 缓存时零次上游请求，未命中时每个币种最多一次。

状态机（决策 §5，全文只有这两个状态）：

```text
                POST /imports（同步校验通过）
   (不存在) ---------------------------------> [ready]
       ^                                          |    |
       |                                          |    | POST /commit（一个事务建全部交易）
       |  DELETE（丢弃：删草稿行与批次）             |    v
       +------------------------------------------+  [committed]
       ^                                                 |
       |  DELETE（撤销：先删这批建的交易，再删草稿行与批次）  |
       +-------------------------------------------------+

允许的转移：(不存在)→ready，ready→committed，ready→(删除)，committed→(删除)
禁止：committed→ready（撤销是删除，不是回退，决策 §14.22）
校验不通过时根本不产生批次，所以没有 failed 状态，也没有 retry。
```

### 5.38 `GET /api/v1/ledgers/{id}/imports`

鉴权：成员。批次历史，按 `created_at DESC`。决策 §14.52 A17（列表显示净额、标记数、目标账户、上传人）。

| query 参数 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `status` | str | — | 可多值：`ready` \| `committed`（只有这两个值） |
| `limit` / `offset` | int | 50 / 0 | §4.3 |

```json
GET /api/v1/ledgers/8f0f7b2e-.../imports?status=ready
-> 200
{
  "items": [
    {"id": "d1e2f3a4-...", "ledger_id": "8f0f7b2e-...", "source_id": "5b6c7d8e-...",
     "source_name": "招商 信用卡", "source": "csv",
     "filename": "2026-08-cmb-credit.csv", "size_bytes": 18432,
     "skill_version": "2026-09-10", "status": "ready", "row_count": 128,
     "net_amount": "-4210.5500", "base_currency": "CNY",
     "flags_summary": {"duplicate": 3, "refund_candidate": 1, "transfer_candidate": 2, "needs_review": 7},
     "row_status_summary": {"pending": 128, "edited": 0, "skipped": 0},
     "uncategorized_count": 5, "warnings": [],
     "created_by": "4ee1c8fa-...",
     "created_at": "2026-09-09T07:00:00.000000Z", "updated_at": "2026-09-09T07:01:12.000000Z",
     "committed_at": null}
  ],
  "total": 1
}
```

列表项与 §5.37 / §5.39 的批次对象**同形状**，字段名同样以 [`./02-database.md`](./02-database.md) §1.7 的列名为准（决策 §14.53e）。决策 §14.52 A17 要在列表上显示的四样东西各对应哪个字段：

| A17 要显示的 | 字段 | 说明 |
|---|---|---|
| 净额 | `net_amount`（+ `base_currency`） | 折算到账本基准币种的净额（收入 - 支出，转账不计入），字符串 4 位小数 |
| 标记数 | `flags_summary` | `{duplicate, refund_candidate, transfer_candidate, needs_review}` 四个计数；列表上显示成四个小徽标，全为 0 时不显示 |
| 目标账户 | `source_id` + `source_name` | 名字直接下发，前端不用再查账户列表 |
| 上传人 | `created_by` | 只回 UUID，前端用成员列表（§5.13）映射成显示名（决策 §14.43 的 03-4） |

有了这四个，前端画列表不用为每一行再查一遍详情。

**没有"已撤销"状态**（决策 §14.52 B1、§14.22）：撤销就是删除，撤销过的批次不在列表里，也没有"撤销原因"这种字段。

错误：404 `not_found`；422 `validation_error`（`status` 不在枚举内）。副作用：只读。

### 5.39 `GET /api/v1/ledgers/{id}/imports/{bid}`

鉴权：成员。

```json
GET /api/v1/ledgers/8f0f7b2e-.../imports/d1e2f3a4-5566-4778-899a-bbccddeeff00
-> 200
{
  "id": "d1e2f3a4-5566-4778-899a-bbccddeeff00",
  "ledger_id": "8f0f7b2e-...",
  "source_id": "5b6c7d8e-...",
  "source_name": "招商 信用卡",
  "source": "csv",
  "filename": "2026-08-cmb-credit.csv",
  "size_bytes": 18432,
  "skill_version": "2026-09-10",
  "status": "ready",
  "row_count": 128,
  "net_amount": "-4210.5500",
  "base_currency": "CNY",
  "flags_summary": {"duplicate": 3, "refund_candidate": 1, "transfer_candidate": 2, "needs_review": 7},
  "row_status_summary": {"pending": 121, "edited": 5, "skipped": 2},
  "uncategorized_count": 5,
  "warnings": [],
  "created_by": "4ee1c8fa-...",
  "created_at": "2026-09-09T07:00:00.000000Z",
  "updated_at": "2026-09-09T07:12:00.000000Z",
  "committed_at": null
}
```

字段与 §5.37 的批次对象完全一致（列名以 [`./02-database.md`](./02-database.md) §1.7 为准，决策 §14.53e），这里不再重复解释。

这个端点**不是轮询目标**（没有进度可轮询）：它的用途是 review 页刷新时重新拿一次汇总数字（用户改了几行之后 `row_status_summary` 与 `uncategorized_count` 会变），以及提交后拿 `committed_at`。

**不存在的字段**（相对上一版目标设计，全部随决策 §14.25 删除）：`progress`、`error`、`model`、走没走视觉路径的标志、页面图数组、模型原始响应、`mime_type`（只收 CSV，类型是定死的）。

错误：404 `not_found`。副作用：只读。

### 5.40 `GET /api/v1/ledgers/{id}/imports/{bid}/rows`

鉴权：成员。决策 §5（草稿行、review 表格）、§14.52 A4（review 内筛选）。

| query 参数 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `status` | str | — | 可多值：`pending` \| `edited` \| `skipped` |
| `flag` | str | — | 可多值：`duplicate` \| `refund_candidate` \| `transfer_candidate` \| `needs_review`；命中任意一个即返回（review 里"有标记"这个筛选就是不带值地传全部四个，或者用下面的 `flagged`） |
| `flagged` | bool | — | `true` 只返回 `flags` 非空的行——review 表格顶部"全部 / 待归类 / 有标记"三个快捷筛选里的第三个（决策 §14.52 A4） |
| `uncategorized` | bool | — | `true` 只返回 `category_l1 IS NULL` 且 `kind != 'transfer'` 的行（"待归类"筛选） |
| `limit` / `offset` | int | 100 / 0 | 上限 **500**（review 表格一次要看很多行，决策 §14.44 的 03-14） |

排序：`row_no ASC`（原文件里的顺序，稳定；列名由决策 §14.5 统一为 `row_no`，**从 1 起**，见 [`./02-database.md`](./02-database.md) §1.8 的 `ck_import_rows_row_no`）。

```json
GET /api/v1/ledgers/8f0f7b2e-.../imports/d1e2f3a4-.../rows?limit=2
-> 200
{
  "items": [
    {
      "id": "e5f6a7b8-...",
      "batch_id": "d1e2f3a4-5566-4778-899a-bbccddeeff00",
      "row_no": 1,
      "status": "pending",
      "date": "2026-08-03",
      "amount": "-128.5000",
      "currency": "CNY",
      "kind": "expense",
      "merchant": "全家便利店",
      "note": "FAMILYMART 3521",
      "category_l1": "food",
      "category_l2": "snacks_drinks",
      "source_ref": "p1:l14",
      "flags": [],
      "matched_transaction_id": null,
      "counterpart_source_id": null,
      "counterparty": null,
      "transfer_role": null,
      "transfer_subtype": null,
      "hint": null,
      "transaction_id": null
    },
    {
      "id": "f6a7b8c9-...",
      "batch_id": "d1e2f3a4-5566-4778-899a-bbccddeeff00",
      "row_no": 2,
      "status": "pending",
      "date": "2026-08-05",
      "amount": "3000.0000",
      "currency": "CNY",
      "kind": "transfer",
      "merchant": null,
      "note": "AUTOPAY",
      "category_l1": null,
      "category_l2": null,
      "source_ref": "p1:l22",
      "flags": ["transfer_candidate"],
      "matched_transaction_id": "3c3c3c3c-4d4d-4e4e-8f8f-909090909090",
      "counterpart_source_id": "34fa63d8-5776-4775-982b-4d58deb0ace9",
      "counterparty": null,
      "transfer_role": "in",
      "transfer_subtype": "repayment",
      "hint": "在「招商 储蓄卡」上找到 8 月 5 日同额转出，已默认勾选「关联为一笔转账」",
      "transaction_id": null
    }
  ],
  "total": 128
}
```

**不存在的字段**（随决策 §14.25 删除）：`confidence`（没有模型给分了）、`page_no`（应用拿不到原始账单，也就没有页面缩略图）、`raw_*`（不另存原始值，改动写进 `hint`，决策 §14.28）。**转账配对这件事上，草稿行只有 `matched_transaction_id` 一个载体**（决策 §14.53b）：勾没勾"关联为一笔转账"就看它——非空 = 勾上了，`PATCH {"matched_transaction_id": null}` = 取消勾选。没有第二个"是否已确认"的布尔列，也没有装候选列表的数组列；候选列表既不落库也不单独建接口。

**转账候选不止一条时**（决策 §14.53b）：服务端**不预填** `matched_transaction_id`（留 `null`），仍然**同时打 `transfer_candidate` 与 `needs_review`**（与本节 flags 表、05 §3.3 的 `flag_transfer_candidates` 一致），`hint` 写"找到 N 条可以配对的转账，请选一条"。用户要选的时候，前端复用交易列表接口筛（`GET /ledgers/{id}/transactions?kind=transfer&…`：单腿、方向相反、其他账户、±3 天、同币种同金额），选中之后 `PATCH .../rows/{rid} {"matched_transaction_id": …}`——与退款候选选择器同一套做法（决策 §14.11，见 §5.25 末尾）。

**没找到对腿时不猜对手账户**（决策 §14.53c）：`counterpart_source_id` 留 `null`，由用户在 review 里显式选一个账户（提交时按两腿建，§5.43），或者只填 `counterparty` 文本 / 什么都不填（提交时按单腿建）。服务端不做"看着像是转给某某账户"这种推断。

三个字段值得单独说明：

| 字段 | 何时有值 | 说明 |
|---|---|---|
| `matched_transaction_id` | 打了 `refund_candidate` 的行上预填；打了 `transfer_candidate` 的行**只在候选唯一时**预填，多候选时留 `null`（决策 §14.53b） | 退款行上它是**原支出**的 id（提交时写进 `transactions.refund_of`，决策 §14.7）；转账行上它是**可配对的那条单腿转账**的 id（提交时两条共用一个新的 `transfer_pair_id`，决策 §14.34）。两种用途共用一列，靠行的 `kind` 区分 |
| `counterpart_source_id` | 转账行上可能有值 | "对手账户也在本应用里"。它与 `matched_transaction_id` 的区别：前者是"对方账户"（提交时**新建**一条对腿），后者是"对方那条已经存在的交易"（提交时**关联**它）。两者同时有值时以 `matched_transaction_id` 为准——已经有现成的对腿就不该再造一条 |
| `counterparty` | 单腿转账行上可能有值，其余行一般为 `null` | 对手方的自由文本（例如 `"老婆"`、`"工资卡"`），决策 §14.10。校验阶段恒为 `null`（决策 §14.16：skill 不猜对手账户，标准 CSV 的 11 列里根本没有这一列），只有用户在 review 里 `PATCH .../rows/{rid}` 填写才会有值（§5.41，≤100 字）；提交时原样写进 `transactions.counterparty` |

`flags` 的含义（决策 §5、§14.31：**只有这四种**，服务端在建批次时一次性打完）：

| flag | 含义 |
|---|---|
| `duplicate` | 同账户、同日、同金额的交易已存在；或转账行的对方已经是某笔两腿转账的一半（决策 §14.34） |
| `refund_candidate` | 正数入账且按决策 §1.1 的规则找到**唯一**候选原单，`matched_transaction_id` 已预填 |
| `transfer_candidate` | 按决策 §1.2 / §14.34 的规则（对方账户上 ±3 天、同币种同金额、方向相反、仍是单腿）找到可配对的转账。**候选唯一**时 `matched_transaction_id` 已预填、review 里默认勾选"关联为一笔转账"；**候选不止一条**时不预填，只在 `hint` 里写"找到 N 条可以配对的转账，请选一条"，由用户自己挑（决策 §14.53b） |
| `needs_review` | 行级校验改过这一行的值（日期 / 金额 / 币种 / kind / 分类五类之一），或本批内存在完全相同的行（决策 §14.31：都保留、都打这个标，`hint` 写"本批内有相同的行（第 N 行）"） |

`hint` 是服务端写给 review 界面的一句中文提示（校验改了什么、为什么打这个标记），**只读**，不进 `transactions.note`（[`./02-database.md`](./02-database.md) §1.8）。每一处校验改动都写进它，不另存原始值（决策 §5、§14.28）。

错误：404 `not_found`；422 `validation_error`。副作用：只读。

### 5.41 `PATCH /api/v1/ledgers/{id}/imports/{bid}/rows/{rid}`

鉴权：成员。决策 §5（"review 表格：每行所有字段可改、可标跳过、可改 kind、可选分类、可关联退款原单、可选对手账户"）、§14.10（`counterparty`）、§14.34（转账配对）。

**只有批次处于 `ready` 时才能改**（决策 §5）。

可改字段（全部可选；`updated_at` 不参与——草稿行不做乐观并发，最后写的赢）：

| 字段 | 类型 | 校验 |
|---|---|---|
| `status` | str | `pending` \| `edited` \| `skipped`。用户改了任何内容服务端自动置 `edited`；显式传 `skipped` = 这行不导入。**没有"已确认"这种状态**（决策 §14.52 B13） |
| `date` | date \| null | `YYYY-MM-DD` |
| `amount` | Decimal \| null | 4 位小数，符号规则同 §5.26 |
| `currency` | str \| null | `^[A-Za-z]{3}$` |
| `kind` | str \| null | 四选一 |
| `merchant` | str \| null | ≤ 200；`kind='transfer'` 时必须为空（决策 §14.52 B16） |
| `note` | str \| null | ≤ 500 |
| `category_l1` | str \| null | 合法一级 code，收支侧与 kind 匹配 |
| `category_l2` | str \| null | 属于 `category_l1` |
| `matched_transaction_id` | UUID \| null | `kind='refund'` 时是退款原单（校验同 §5.26 的 `refund_of`）；`kind='transfer'` 时是要配对的那条**单腿**转账（校验同 §5.33 的六条，不满足就是 400 `pair_invalid`）；其余 kind 上只能是 `null`（决策 §14.10、§14.34） |
| `counterpart_source_id` | UUID \| null | 只在 `kind='transfer'` 时允许非 null。**必须是本账本的未归档账户，否则 404 `not_found`**（决策 §14.53c——一个当前用户不能拿来记账的账户 id 与"不存在"没有区别，§3.3）；还必须不等于批次的 `source_id`（自己转给自己），否则 400 `same_source`（两腿必须落在不同账户上，用注册表里这个专属 code，不落在通用的 `validation_error` 上）。服务端**不会**自动填这一列（决策 §14.53c） |
| `counterparty` | str \| null | ≤ 100 字，`strip()` 后空串按 `null` 存（决策 §14.10）。只在 `kind='transfer'` 时有意义；给了 `matched_transaction_id` 或 `counterpart_source_id` 时它会被忽略（提交时建的是两腿，§5.43） |
| `transfer_role` | str \| null | `out` \| `in`；`kind='transfer'` 时必须非 null（决定这一腿的方向与金额符号） |
| `transfer_subtype` | str \| null | `plain` \| `repayment`；`kind='transfer'` 时必须非 null |

**`source_id` 不在可改字段里**（决策 §14.52 A5）：一份文件对应一个目标账户（决策 §5），普通行改不了账户；转账行要指对方账户用 `counterpart_source_id`。

`row_no`、`source_ref`、`flags`、`hint`、`transaction_id` 都是**只读**的：前三个是校验过程的产物，改了没有意义。

草稿行的校验比正式交易**宽松**：允许 `date` / `amount` / `category_l1` 暂时为 `null`（skill 拿不准就留空，决策 §1.3），这些空值到 commit 时才拦（§5.43）。但只要给了值就必须合法。

```json
PATCH /api/v1/ledgers/8f0f7b2e-.../imports/d1e2f3a4-.../rows/e5f6a7b8-...
{"category_l1": "food", "category_l2": "lunch", "merchant": "全家"}

-> 200
{"id": "e5f6a7b8-...", "batch_id": "d1e2f3a4-...", "row_no": 1, "status": "edited",
 "date": "2026-08-03", "amount": "-128.5000", "currency": "CNY", "kind": "expense",
 "merchant": "全家", "note": "FAMILYMART 3521", "category_l1": "food", "category_l2": "lunch",
 "source_ref": "p1:l14", "flags": [], "matched_transaction_id": null,
 "counterpart_source_id": null, "counterparty": null,
 "transfer_role": null, "transfer_subtype": null, "hint": null, "transaction_id": null}
```

取消自动预填的转账配对（用户觉得这两笔其实没关系）：

```json
PATCH .../rows/f6a7b8c9-...
{"matched_transaction_id": null}
-> 200   （flags 里的 transfer_candidate 保留——标记记录的是"当时找到过候选"这个事实，
          真正决定提交时怎么建的是 matched_transaction_id 这个值）
```

标记跳过：

```json
PATCH .../rows/f6a7b8c9-...
{"status": "skipped"}
-> 200   （status 变为 "skipped"，其余字段不变）
```

状态转换：

```text
 [pending] --改任意内容--> [edited] --改任意内容--> [edited]
     |                        |
     | {"status":"skipped"}   | {"status":"skipped"}
     v                        v
 [skipped] --{"status":"pending"} 或 改任意内容--> [edited]

 commit 时：pending / edited 建交易；skipped 不建
```

错误：

| 状态码 | code | 条件 |
|---|---|---|
| 404 | `not_found` | 账本 / 批次 / 行不可见；`counterpart_source_id` 不是本账本的未归档账户（决策 §14.53c） |
| 409 | `batch_not_ready` | 批次不是 `ready`（已提交的批次不能再改行） |
| 400 | `category_invalid` / `category_kind_mismatch` | 分类不合法 |
| 400 | `refund_target_invalid` | refund 行的 `matched_transaction_id` 不合法 |
| 400 | `pair_invalid` | transfer 行的 `matched_transaction_id` 不满足配对条件（§5.33 的六条；**其中不含"子类型必须相同"**，决策 §14.53a） |
| 400 | `same_source` | `counterpart_source_id` 等于批次的目标账户（两腿会落在同一个账户上） |
| 400 | `validation_error` | `counterpart_source_id` 用在非 transfer 行上；转账行带了 `merchant`；符号与 kind 冲突 |

副作用：`UPDATE import_rows`。不碰 `transactions`，也不写 `transaction_events`（草稿还不是交易）。

### 5.42 `PATCH /api/v1/ledgers/{id}/imports/{bid}/rows`

鉴权：成员。决策 §14.52 A4（review 里的批量设分类 / 批量跳过）。

对一组草稿行应用**同一份**改动。用途就两个：把筛出来的"待归类"行一次性设成同一个分类，以及把选中的行一次性标跳过。

| 字段 | 类型 | 必填 | 校验 |
|---|---|---|---|
| `row_ids` | UUID[] | 是 | 1..500 个，必须都属于本批次；有一个不属于就整体 404，不部分执行 |
| `patch` | object | 是 | 与 §5.41 的可改字段相同的一份改动，应用到每一行，**但不收** `matched_transaction_id` / `counterpart_source_id` / `counterparty`（逐行关联不能批量套用，带了任一即 422；决策 §14.55，2026-09-16 同步） |

```json
PATCH /api/v1/ledgers/8f0f7b2e-.../imports/d1e2f3a4-.../rows
{
  "row_ids": ["e5f6a7b8-...", "a1b2c3d4-...", "b2c3d4e5-..."],
  "patch": {"category_l1": "food", "category_l2": "lunch"}
}

-> 200
{"updated": 3, "rows": [ /* 三条改完之后的完整行，字段同 §5.40 */ ]}
```

批量跳过：

```json
PATCH /api/v1/ledgers/8f0f7b2e-.../imports/d1e2f3a4-.../rows
{"row_ids": ["f6a7b8c9-...", "c3d4e5f6-..."], "patch": {"status": "skipped"}}

-> 200
{"updated": 2, "rows": [ … ]}
```

**要么全成要么全不成**：整个批量在一个事务里跑，任何一行校验不过就 400 并回滚（`detail` 指出是哪一行的哪个字段）。这条很重要——用户选了 40 行点"设为餐饮"，如果其中 3 行是收入行（分类收支侧不匹配），部分成功会留下一个说不清的中间状态。

`patch` 里能放什么受同一份规则约束——包括 `counterpart_source_id` 那条「必须是本账本的未归档账户，否则 404 `not_found`」（决策 §14.53c）。所以有些字段放进批量没意义也不被禁止（比如 `amount`：40 行改成同一个金额，理论上可以，实际没人这么干）。前端只暴露"设分类"和"跳过"两个入口（[`./04-frontend.md`](./04-frontend.md) §4.10）。

错误：

| 状态码 | code | 条件 |
|---|---|---|
| 404 | `not_found` | 账本 / 批次不可见；`row_ids` 里有不属于本批次的 id；`patch` 里的 `counterpart_source_id` 不是本账本的未归档账户（决策 §14.53c，与 §5.41 同一条规则） |
| 409 | `batch_not_ready` | 批次不是 `ready` |
| 400 | `category_invalid` / `category_kind_mismatch` / `refund_target_invalid` / `pair_invalid` / `validation_error` | 任意一行不满足 §5.41 的校验；`detail` 带上是哪一行（`row_no`） |
| 422 | `validation_error` | `row_ids` 为空或超过 500 个 |

副作用：一个事务里的 N 条 `UPDATE import_rows`。

### 5.43 `POST /api/v1/ledgers/{id}/imports/{bid}/commit`

鉴权：成员。决策 §5（"一个数据库事务内建所有交易（两腿还款一起建），每条交易记 `import_batch_id`；成功后批次 `committed`"）、§14.18（无请求体）、§14.51（写操作记录）。

**无请求体**（决策 §14.18：不做乐观锁校验，重复提交靠 409 `batch_already_committed` 保护）。

```json
POST /api/v1/ledgers/8f0f7b2e-.../imports/d1e2f3a4-.../commit
X-Client: web

-> 200
{
  "batch_id": "d1e2f3a4-5566-4778-899a-bbccddeeff00",
  "status": "committed",
  "created_transactions": 121,
  "created_transfer_pairs": 2,
  "paired_existing_transfers": 1,
  "linked_refunds": 3,
  "skipped_rows": 7,
  "committed_at": "2026-09-09T07:20:31.000000Z"
}
```

提交前的全量校验（任何一条不过就整体拒绝，一条都不建）：

```text
1. 批次 status == 'ready'                                       -> 409 batch_not_ready
   （status == 'committed' 直接 409 batch_already_committed，这就是幂等保护）
2. 目标账户仍未归档                                             -> 409 source_archived
3. 至少有一条非 skipped 的行                                    -> 409 rows_all_skipped
   （整批都被标 skipped 时一条交易也建不出来，与其建一个空批次
     不如直接拒绝并提示用户改回来或丢弃这批，见 05 §4.3）
4. 对每一条非 skipped 的行：
   a. date 非空、amount 非空且不为 0、currency 非空、kind 非空  -> 409 batch_not_ready
   b. kind != 'transfer' 时 category_l1 非空                    -> 409 rows_uncategorized
      （决策 §1.3："提交前必须补一级分类"；detail 里给出还差几行）
   c. 符号 / 分类 / refund / 配对 / 对手账户，同 §5.26、§5.33   -> 400 对应 code
      （`repayment` 只在转入腿上要求账户是 credit，见 §5.26：
        储蓄卡账单里的 transfer/out/repayment 行照建，不会卡在这里；
        配对也不要求两腿子类型相同，服务端统一，见 §14.53a；
        但 counterpart_source_id 这一路是新建两腿、不是配对，
        转入腿账户不是 credit 而行的子类型是 repayment 时照样 400）
      对手账户不是本账本的未归档账户                            -> 404 not_found（§14.53c）
5. 全部通过后开事务
```

事务里的写入：

- `kind` 为 `expense` / `income` / `refund` 的行 → 一条 `transactions`，`source_id` = 批次的目标账户，`import_batch_id` = 批次 id，`created_by` / `updated_by` = 当前用户，`refund_of` = 行的 `matched_transaction_id`（行 `kind='refund'` 且它非空就写，不看是服务端预填还是用户改选，决策 §14.7）。
- `kind='transfer'` 且 `matched_transaction_id` 非空 → **与已有的那条单腿转账配对**（决策 §14.34）：新建本行这一腿，生成一个新的 `transfer_pair_id`，把它同时写到新行和那条已有交易上，并把**已有那条的 `counterparty` 清空**；给已有那条也写一条 `transaction_events(event='paired')`。计入响应的 `paired_existing_transfers`。
  配对时**按 §5.33 的规则把两腿统一成同一个 `transfer_subtype`**（决策 §14.53a：任一腿是 `repayment` 且转入腿账户是 `credit` → 整对 `repayment`，否则整对 `plain`）——走的就是 §5.33 那一段代码，配对不要求两腿原本的子类型相同（储蓄卡账单写 `plain`、信用卡账单写 `repayment` 的同一笔还款是常态）。子类型真的变了的腿再各写一条 `transaction_events(event='updated')`，`changes` 记 `transfer_subtype` 的前后值。两腿的 `occurred_at` **不对齐**，各留各的日期（决策 §14.53a）。
- `kind='transfer'`、`matched_transaction_id` 为空且 `counterpart_source_id` 非空 → **两腿一起建**：生成一个 `pair_id`，目标账户那一腿按行的金额符号定 role，对手账户那一腿金额取反、币种相同、日期相同，两腿写**行自带的**那个 `transfer_subtype` 和同一个 `import_batch_id`（决策 §5"两腿还款一起建"）。这一路**不走 §14.53a 的统一规则**——§14.53a 只管**配对**两条已经存在的交易；这里两腿都是新建的，等同于 §5.30 的建对，所以行的子类型是 `repayment` 而转入腿（对手账户那一腿或本行这一腿，看金额符号）的账户不是 `credit` 时，按 §5.26 / §5.30 返回 400 `repayment_target_not_credit`，不做静默降级。`counterpart_source_id` 必须是本账本的未归档账户（决策 §14.53c，§5.41 已经拦过一道）。计入 `created_transfer_pairs`。
- `kind='transfer'` 且两个都为空 → 一条单腿转账（`transfer_pair_id` 为 NULL），行的 `counterparty` 文本原样写进 `transactions.counterparty`（决策 §14.10）。
- 每建一条交易就写一条 `transaction_events(event='imported', import_batch_id=<批次>, client=<X-Client>)`（决策 §14.51）。
- 每写一条就把 `import_rows.transaction_id` 回填（两腿的行回填目标账户那一腿的 id）。
- 最后 `UPDATE import_batches SET status='committed', committed_at=now()`。

**批内重复的行都会各建一条交易**（决策 §14.31：不合并）——它们只是被打了 `needs_review` 提醒用户看一眼，用户不改就是照建。

原子性与幂等：整个过程在**一个** SQLAlchemy 事务里，任何异常都 `rollback`，批次留在 `ready`，草稿行不变，用户改完再提交即可。开头对批次行加 `SELECT ... FOR UPDATE`，所以两个人同时点提交只有一个能进；第二个看到的已经是 `committed`，返回 409 `batch_already_committed`。

错误：

| 状态码 | code | 条件 |
|---|---|---|
| 404 | `not_found` | 账本 / 批次不可见；某行的 `counterpart_source_id` 已不是本账本的未归档账户（在 review 之后被归档或删除，决策 §14.53c） |
| 409 | `batch_not_ready` | 批次不是 `ready`；或有行缺 date / amount / currency / kind |
| 409 | `batch_already_committed` | 重复提交（决策 §14.18） |
| 409 | `rows_uncategorized` | 有非 transfer 行缺 `category_l1` |
| 409 | `rows_all_skipped` | 所有行都被标 `skipped`，一条交易也建不出来 |
| 409 | `source_archived` | 批次的目标账户在校验之后被归档了 |
| 400 | `category_invalid` / `category_kind_mismatch` / `refund_target_invalid` / `pair_invalid` / `repayment_target_not_credit` / `validation_error` | 行内容非法（正常情况下 §5.41 已经拦住了，这里是最后一道） |

副作用：N 条 `INSERT transactions` + N 条 `INSERT transaction_events` + N 条 `UPDATE import_rows` + 最多几条 `UPDATE transactions`（配对已有单腿）+ 1 条 `UPDATE import_batches`。不调汇率、不调任何外部服务。

### 5.44 `DELETE /api/v1/ledgers/{id}/imports/{bid}`

鉴权：成员（**member 也可以撤销导入**，决策 §14.52 B9）。决策 §5 与 §14.22 明确的**两种语义**：

| 批次状态 | 语义 | 做什么 |
|---|---|---|
| `ready` | **丢弃** | 删 `import_rows` → 删 `import_batches`。没有任何交易被建过，所以没有别的影响；也没有文件要删（决策 §14.28：后端不保存上传的文件） |
| `committed` | **撤销 = 整批删除** | 先 `DELETE FROM transactions WHERE import_batch_id = :bid`（决策 §5"删除这批建的所有交易，不限时限"；它们的 `transaction_events` 随外键级联删），再删草稿行、批次。**不保留已撤销的批次、不引入 `reverted` 状态**（决策 §14.22） |

调用方必须先带 `?dry_run=1` 问一次影响面，界面上确认后再真删（决策 §5"撤销前确认并显示条数"、§14.52 B24）：

```json
DELETE /api/v1/ledgers/8f0f7b2e-.../imports/d1e2f3a4-...?dry_run=1
-> 200
{
  "batch_id": "d1e2f3a4-...",
  "mode": "revert",
  "would_delete_transactions": 123,
  "orphaned_refunds": 2,
  "refunds_in_batch": 4,
  "deleted": false
}
```

`dry_run` 的两个计数说的是**两个相反方向**的事，界面上必须分开措辞（决策 §14.52 B24 明确点名了这一点）：

| 字段 | 含义 | 界面措辞 |
|---|---|---|
| `orphaned_refunds` | **批外**的退款行，指向的原支出在这一批里，撤销后它们的 `refund_of` 会被数据库置 NULL（决策 §1.1 的 `ON DELETE SET NULL`）、退款行本身保留（决策 §14.43 的 03-9） | "有 2 笔**在别处记的退款**将失去它们的原单" |
| `refunds_in_batch` | **批内**的退款行数：它们会被一起删掉，于是它们各自指向的原支出（可能在批外）恢复出可退额度 | "本批含 4 笔退款，删除后对应原单的可退金额会恢复" |

真删：

```json
DELETE /api/v1/ledgers/8f0f7b2e-.../imports/d1e2f3a4-...
X-Client: web

-> 200
{"batch_id": "d1e2f3a4-...", "mode": "revert", "deleted_transactions": 123,
 "orphaned_refunds": 2, "refunds_in_batch": 4, "deleted": true}
```

丢弃态的响应：

```json
{"batch_id": "d1e2f3a4-...", "mode": "discard", "deleted_transactions": 0,
 "orphaned_refunds": 0, "refunds_in_batch": 0, "deleted": true}
```

**这是唯一不返回 204 的删除类端点**（决策 §14.43 的 03-6：删除类端点统一 204，撤销导入例外，因为要回撤销条数）。

错误：

| 状态码 | code | 条件 |
|---|---|---|
| 404 | `not_found` | 账本 / 批次不可见（重复删除也是 404） |

副作用：见上表，一个事务。撤销之后这批交易在交易列表里彻底消失，`?import_batch_id=` 也查不到任何东西——因为批次本身已经不存在了。

### 5.45 `GET /api/v1/rates/currencies`

鉴权：无（保留现状）。

```json
GET /api/v1/rates/currencies
-> 200
{"currencies": {"USD": "United States Dollar", "EUR": "Euro", "GBP": "British Pound", "CNY": "Chinese Renminbi Yuan"}}
```

行为与现状一致（进程级永久缓存，`backend/app/services/rates.py:15`），唯一改动是错误体带 code：

| 状态码 | code | 条件 |
|---|---|---|
| 503 | `fx_unavailable` | 上游失败且进程内还没有缓存 |

副作用：进程生命周期内最多一次上游 `GET {EXCHANGE_RATE_API_URL}/currencies`。

### 5.46 `GET /api/v1/rates/latest`

鉴权：无（保留现状）。

| query 参数 | 类型 | 默认 | 校验 |
|---|---|---|---|
| `base` | str | `USD` | `^[A-Za-z]{3}$` |
| `symbols` | str | `EUR,GBP,CNY` | 逗号分隔，逐项 `strip()`，丢弃空项；至少要剩一项，否则 422 |

```json
GET /api/v1/rates/latest?base=usd&symbols=eur,%20cny
-> 200
{"base": "USD", "date": "2026-09-08", "rates": {"EUR": "0.92000000", "CNY": "7.24500000"}}
```

与现状的差别：`date` 是**上游返回的汇率日期**，不再是服务器的 `date.today()`（修复 `../current-design/06-known-issues.md` H-02 的第 4、5 点）；结果同时写入 `exchange_rates` 缓存表。

错误：

| 状态码 | code | 条件 |
|---|---|---|
| 503 | `fx_unavailable` | 上游不可达或返回错误（含未知币种导致的 404） |
| 422 | `validation_error` | `base` 不是 3 字母、`symbols` 全空 |

副作用：0 或 1 次上游调用（缓存命中则 0 次）；命中未命中都可能 `INSERT exchange_rates`。

### 5.47 `POST /api/v1/rates/convert`

鉴权：无（保留现状）。

| 字段 | 类型 | 必填 | 校验 |
|---|---|---|---|
| `amount` | Decimal | 是 | `> 0` |
| `from_currency` | str | 是 | `^[A-Za-z]{3}$` |
| `to_currency` | str | 是 | `^[A-Za-z]{3}$` |
| `on` | date | 否 | 默认最新；给了就用那天（回退规则见 §6.2） |

```json
POST /api/v1/rates/convert
{"amount": "100", "from_currency": "usd", "to_currency": "cny"}

-> 200
{"amount": "100", "from_currency": "USD", "to_currency": "CNY",
 "converted_amount": "724.5000", "rate": "7.24500000", "date": "2026-09-08"}
```

与现状的差别：内部改调 `services/fx.py`，只发**一次**上游请求（现状跨币种发两次，`../current-design/03-backend-api.md` §5.4 路径 A），`rate` 统一 8 位小数，`date` 是汇率日期。

错误：

| 状态码 | code | 条件 |
|---|---|---|
| 503 | `fx_unavailable` | 汇率取不到 |
| 422 | `validation_error` | `amount <= 0`、币种格式错 |

副作用：0 或 1 次上游调用，可能写缓存表。

> 这两个 `/rates` 端点前端目前不用（只用 `/rates/currencies` 填币种下拉，`frontend/src/api/rates.ts:13-16`），保留是因为决策 §11 写了"现有 rates 接口保留"，并且它们在调试汇率问题时很有用。

---

## 6. 汇率服务

### 6.1 与现状的关系

现状有**两套互相矛盾的公式**（`../current-design/03-backend-api.md` §5.4，以及 `../current-design/06-known-issues.md` H-02）：

- 路径 A（`POST` / `GET {id}` / `PATCH` 单条交易），`backend/app/api/transactions.py:20-46`：先 `convert_amount(amount, T, B)`（内部 `from=T&to=B`，`converted = amount × rate`，量化 4 位，`backend/app/services/rates.py:127-139`），再**第二次**发同样的请求只为拿 `conversion_rate`（不量化）。
- 路径 B（`GET /transactions` 列表），`backend/app/api/transactions.py:217-255`：一次批量请求，方向相反（`from=B&to=[页内币种]`），于是 `converted = amount / rate`（4 位）、`conversion_rate = 1 / rate`（6 位）。

结果是同一条交易在"创建响应"和"列表"里显示的换算金额末位不同、汇率精度不同；而且两条路径都用 `/latest`（当天汇率），上游返回的 `date` 被丢弃（`backend/app/services/rates.py:89-93`），`conversion_date` 填的是服务器 `date.today()`。

目标（决策 §8）把这一切收敛成 `services/fx.py` 里的一个函数族：**读取时计算、不落算好的结果；交易与统计用发生日汇率，账户余额用最新汇率；无行情日回退到最近一个已公布交易日。** 汇率本身缓存在 `exchange_rates` 表里。

**这张表在现状里不存在，必须新建**：迁移 `backend/migrations/versions/5ca7fe6e37db_remove_exchange_rates_table_use_real_.py:24-25` 已经把它删掉了，现状每次响应都现拉 Frankfurter。目标结构由决策 §14.1 定死，DDL 见 [`./02-database.md`](./02-database.md)：

```text
exchange_rates(
  date       DATE       NOT NULL,
  base       CHAR(3)    NOT NULL,
  symbol     CHAR(3)    NOT NULL,   -- 目标币种；统一叫 symbol，不叫 quote（决策 §14.1）
  rate       NUMERIC(18,8) NOT NULL,-- 1 base = rate symbol
  fetched_at TIMESTAMP  NOT NULL,
  PRIMARY KEY (date, base, symbol)
)
```

列名用 `symbol` 是为了和现有 `/rates/latest?symbols=` 参数（§5.46）同源；本文与 [`./01-domain-and-flows.md`](./01-domain-and-flows.md) §1.13 用同一套列名（决策 §14.1）。换算时缺哪一天就向 Frankfurter 取哪一天并落库；"最新汇率" = 最近一个已公布日的行，同一 `(base, symbol)` 一小时内不重复请求。写入一律是**按主键 upsert、保留全部历史行**，永远不做整表刷新或按时间清理（决策 §14.1）——历史汇率一经公布不再变，缓存的意义正是让"按发生日折算"不必反复走外网；表越老命中率越高。

顺带修掉的两个现状问题：`tenacity` 的重试装饰器（`backend/app/services/rates.py:18-23` 和 `:56-61`）因为异常在函数内部就被换成了 `HTTPException` 而从未生效（`../current-design/06-known-issues.md` M-04）——新实现里 HTTP 客户端只负责抛 `httpx` 异常，转换成 `ApiError` 的动作放在调用层，重试才会真的发生；`EXCHANGE_RATE_API_URL` 的默认值也改成 `https://api.frankfurter.dev/v1`（H-03）。

### 6.2 函数签名与回退算法

```python
def convert(amount: Decimal, currency: str, to_currency: str, on: date
            ) -> tuple[Decimal, Decimal, date]:
    """把 amount（currency 计价）折算到 to_currency，用 on 这一天的汇率。
    返回 (amount_base, rate_used, rate_date)：
      amount_base = (amount * rate_used).quantize(Decimal("0.0001"))   # ROUND_HALF_UP
      rate_used   = 1 currency 值多少 to_currency，量化到 8 位小数
      rate_date   = 实际使用的汇率日期（可能早于 on）
    currency == to_currency 时直接返回 (amount, Decimal("1"), on)，不查任何东西。
    取不到汇率时抛 ApiError(503, "fx_unavailable", …)；调用方决定是吞成 null 还是往上报。"""

def latest_rate(currency: str, to_currency: str) -> tuple[Decimal, date]:
    """最新可用汇率。等价于 convert(1, currency, to_currency, today) 的后两个返回值，
    但走的是"最新"分支：先看 exchange_rates 里 date 最大的一行，
    如果它比今天早超过 FX_STALE_DAYS(=4) 天就去上游拉一次 /latest。"""
```

回退算法（决策 §8"无行情日（周末、节假日、当天尚未公布）回退到最近一个已公布的交易日"）：

```text
convert(amount, C, B, on):
  1. C == B                       -> (amount, 1, on)
  2. 查缓存：
       SELECT rate, date FROM exchange_rates
        WHERE base = C AND symbol = B AND date <= on
        ORDER BY date DESC LIMIT 1
     命中且 (on - date) <= FX_MAX_BACKFILL_DAYS(=10)   -> 用它
  3. 未命中 / 太旧：向上游请求区间
       GET {EXCHANGE_RATE_API_URL}/{start}..{on}?from=C&to=B
       其中 start = on - 10 天（Frankfurter 的区间端点只返回有行情的日期，
       所以"回退到最近交易日"就是取返回结果里 <= on 的最大日期）
     把返回的每一天都写进 exchange_rates（幂等，主键 (date, base, symbol)）
  4. 区间里仍然一天都没有（比如 on 早于该币种上线日）：
       再试一次 GET /latest?from=C&to=B，用最新汇率并把 rate_date 设为它的日期
  5. 还是没有                      -> ApiError(503, fx_unavailable)
```

要点：

- `on` 是**未来日期**（用户把交易日期填成了明天）时，第 2 步的 `date <= on` 自然会取到今天的汇率，不需要特判。
- 回退窗口 `FX_MAX_BACKFILL_DAYS = 10` 天足以覆盖春节这样的长假；写成模块常量而不是配置项，因为它是算法参数不是部署参数。
- 汇率的方向统一定义为"1 单位 `currency` 值多少 `to_currency`"，所有地方只用这一个方向，不再出现现状那种一处乘、一处除的分歧。
- 量化：`amount_base` 用 4 位小数 `ROUND_HALF_UP`（与 `Numeric(18,4)` 对齐），`rate_used` 用 8 位小数。现状用的是默认的 `ROUND_HALF_EVEN`，改成 `HALF_UP` 是因为它更符合人对"四舍五入"的直觉，且与前端展示一致。

### 6.3 批量转换（避免 N+1）

`GET /transactions`（一页最多 200 行）、`stats/summary`、`stats/trend`（一年的行）都要给很多行折算。逐行调 `convert` 会产生 N 次数据库查询甚至 N 次上游请求。`convert_many` 的做法：

```python
def convert_many(items, to_currency):
    # items: [(amount, currency, on), ...]
    需要的币种 = {c for _, c, _ in items if c != to_currency}
    if not 需要的币种: return [(a, 1, d) for a, _, d in items]
    start, end = min(on for …), max(on for …)

    # 1 条 SQL 把区间内所有相关汇率一次查出来
    rows = SELECT base, symbol, date, rate FROM exchange_rates
            WHERE symbol = :to AND base IN :需要的币种
              AND date BETWEEN :start - 10天 AND :end
    表 = {(base, date): rate}

    # 找出还缺哪些 (币种, 日期)；按币种分组，每个币种最多一次区间请求
    for 币种 in 缺失的币种:
        GET /{start-10天}..{end}?from=币种&to=to_currency   # 一次拿回整段
        写入 exchange_rates 并更新表

    # 逐条在内存里做"<= on 的最大日期"查找（每个币种的日期列表排好序后二分）
    return [算好的三元组 …]
```

代价上界：**每个出现过的币种最多一次上游请求**，与行数无关。缓存热了之后是 0 次上游 + 1 条 SQL。

`stats` 里被跳过的行（汇率实在取不到）计入响应的 `rate_missing_count`（§5.35），而不是让整个统计接口 503。

### 6.4 各处用哪个函数

| 场景 | 函数 | 日期 | 决策 |
|---|---|---|---|
| 交易行的 `amount_base` / `rate_used` / `rate_date` | `convert` / `convert_many` | 该行 `occurred_at` | §8 |
| 交易列表的 `min_amount` / `max_amount` 过滤与 `summary` | `convert_many` | 每行自己的 `occurred_at` | §14.49、§14.52 A14 |
| 账户列表的 `assets` / `liabilities` / `net_worth` | `latest_rate`（在各账户 `balance_base` 之上求和） | 最新 | §14.50 |
| `stats/summary`、`stats/trend` | `convert_many` | 每行自己的 `occurred_at` | §8 |
| 账户 `balance_base` | `latest_rate` | 最新 | §8 |
| `POST /rates/convert` | `convert` | 请求里的 `on`，省略则最新 | — |
| `GET /rates/latest` | `latest_rate` | 最新 | — |

"交易一经发生汇率不再变"（决策 §8）的直接后果：同一条交易今天看和明年看，`amount_base` 完全一样——这正是现状做不到的（H-02 的第 2 条影响）。

---
## 7. 交易操作记录（`transaction_events`）

决策 §14.51：每一条交易都有一份"谁在什么时候把它怎么了"的时间线，交易详情页（§5.27）把它显示出来。这一节说明它怎么写、写什么、谁来写。

> 上一版目标设计的 §7 是"后台任务模型"（`BackgroundTasks` + 线程池 + 状态轮询 + 启动恢复），随决策 §14.25「应用不接入 LLM、导入改为同步校验」整节作废：现在的导入在请求里就做完了（§5.37），后端**没有任何后台任务、没有线程池约束、没有需要重启后收拾的中间状态**。

### 7.1 表与字段

结构见 [`./02-database.md`](./02-database.md)；接口这一侧关心的是这几列：

| 列 | 说明 |
|---|---|
| `id` | 事件 id |
| `ledger_id` | 冗余存一份，方便按账本查与级联删 |
| `transaction_id` | 指向交易；外键 `ON DELETE CASCADE`（交易没了事件也没了，决策 §14.51） |
| `actor_id` | 操作者 user id（导入提交时是点提交的那个人） |
| `at` | 事件时刻，naive UTC（§4.5） |
| `event` | 七种之一：`created` / `updated` / `imported` / `paired` / `unpaired` / `refund_linked` / `refund_unlinked` |
| `changes` | JSON：`{字段: {"before": …, "after": …}}`，只记真正变了的字段，值用 API 的序列化形式（§4.5）。`created` / `imported` 可以是 `null` |
| `import_batch_id` | 只有 `imported` 事件有值 |
| `client` | 请求头 `X-Client` 的值（§4.7），没带就是 `null` |

**只追加、不修改、不删除**（决策 §14.51）：没有任何接口能改一条事件，也没有"清空历史"的操作。

### 7.2 谁写、写什么

| 触发点 | 事件 | changes 里有什么 |
|---|---|---|
| `POST /transactions`（§5.26） | `created` | 可以为 `null`（整行都是新的） |
| `PATCH /transactions/{tid}`（§5.28） | `updated` | 所有真正变了的字段；一个字段都没真变就**不写** |
| 同上，`refund_of` 从 null 变成有值 | `refund_linked` | `{"refund_of": {"before": null, "after": "<id>"}}` |
| 同上，`refund_of` 从有值变成 null | `refund_unlinked` | 反过来 |
| `POST /transactions/transfer`（§5.30） | 两条腿各一条 `created` | `null` |
| `PATCH /transactions/transfer/{pair_id}`（§5.31） | 两条腿各一条 `updated` | 各自变了的字段 |
| `POST .../transactions/{tid}/pair`（§5.33） | 两条各一条 `paired`；子类型被统一改动的腿**再各一条 `updated`**（决策 §14.53a） | `paired` 记 `transfer_pair_id` 与 `counterparty` 的前后值；`updated` 记 `transfer_subtype` 的前后值 |
| `POST .../transfer/{pair_id}/unpair`（§5.34） | 两条各一条 `unpaired` | `transfer_pair_id` 的前后值 |
| `POST .../imports/{bid}/commit`（§5.43） | 每条新建的交易一条 `imported`；被配对上的那条已有交易一条 `paired`（子类型被统一改动时再加一条 `updated`） | `imported` 为 `null`；`paired` / `updated` 同上 |

**不写事件的地方**（有意为之）：

- `DELETE /transactions/{tid}`、`DELETE .../transfer/{pair_id}`、`DELETE .../imports/{bid}`（撤销）：交易都没了，给它写事件没有意义——事件跟着交易一起级联删除（决策 §14.51）。本设计**不做**"谁删了什么"的审计日志，那是另一件事（本版不做，见 `## 待决`）。
- 原单被删导致退款行的 `refund_of` 被数据库置 NULL（§5.29）：这是外键动作，应用层拿不到操作者，硬要补事件就得先查一遍再删。前端在详情页显示"原单已删除"即可。
- 草稿行的任何改动（§5.41、§5.42）：草稿还不是交易。

### 7.3 写事件的代码约束

1. **同一个事务**。`services/events.record()` 只往当前 Session 里 `add()`，由调用方的事务统一提交。交易写成功而事件写失败（或反过来）是不允许出现的状态。
2. **不阻塞主流程**。事件是一条 `INSERT`，不查外部服务、不做汇率折算；`changes` 里存的是已经序列化好的字符串，不存 Decimal / date 对象。
3. **值用 API 的形状**。`amount` 存 `"-45.5000"` 而不是 `-45.5`，`occurred_at` 存 `"2026-09-01"`——前端拿到 `changes` 直接就能显示，不用再猜类型（§4.5）。
4. **不存敏感内容**。`changes` 里只会出现交易自己的字段，不会出现令牌、口令、请求头（`client` 是唯一的例外，且它在写库前已经被 §4.7 的规则清洗过）。
5. **数量有界**。正常一条交易只有几条事件；`GET /transactions/{tid}` 直接全量返回，不分页（§5.27）。

### 7.4 时序（一次导入提交）

```text
客户端                    API 进程                                 DB
  |  POST /imports        |                                         |
  |  （CSV，multipart）   | 读文本 → 校验 → 打标记                  |
  |                       |------ INSERT batch + 128 rows --------->|
  |<-- 201 batch + rows --|                                         |
  |  PATCH .../rows/{rid} | 用户在 review 里改了 5 行               |
  |----------------------->------ UPDATE import_rows -------------->|
  |  PATCH .../rows       | 批量把 12 行设成「餐饮」                |
  |----------------------->------ UPDATE import_rows × 12 --------->|
  |  POST .../commit      | 一个事务：                              |
  |----------------------->  INSERT transactions × 121 ------------>|
  |                       |  INSERT transaction_events × 121 ------>|
  |                       |  UPDATE 已有单腿（配对 + 统一子类型）-->|
  |                       |  INSERT events(paired ×2, updated ×1) ->|
  |                       |  UPDATE import_rows.transaction_id ---->|
  |                       |  UPDATE import_batches → committed ---->|
  |<-- 200 CommitResult --|                                         |
```

全程同步，没有一次上游调用（分类表在进程内、汇率只在读取时用）。

---

## 8. 限流

### 8.1 实现方式

进程内令牌桶（`core/ratelimit.py`，决策 §14.43 的 03-8）：一个 `dict[(bucket, key)] -> (tokens: float, last_refill: float)`，加一把 `threading.Lock`（处理函数跑在线程池里，必须加锁）。每次 `check` 先按经过的时间补充令牌（`tokens += 秒数 * capacity / refill_seconds`，上限 `capacity`），够就扣 1，不够就抛 429。

登录、注册、加入账本、导入四处**共用这一个组件**（决策 §14.43），区别只在 bucket 名、key 的取法和 `Limit` 的两个参数。选它的理由：决策要的几处阈值都很小、单实例部署（一个 uvicorn 进程，`infra/Dockerfile.api:78`），不值得引入 Redis。

**局限（必须写在运维文档里）**：

- 多进程 / 多容器时每个进程各有一套桶，实际阈值是"进程数 × 阈值"。将来要加 `--workers` 或水平扩容，必须先把这个模块换成 Redis 实现（接口不变，`check` / `reset` 两个函数）。这一点对 `POST /ledgers/join` 的**全局** 1 QPS 尤其要紧——它的正确性依赖"只有一个进程"。
- 进程重启后所有计数清零（决策 §14.43 明确接受"重启清零、单实例"）。对亲友规模的应用可接受。
- 内存无限增长的风险：`key` 是用户 id 或 IP，用一个 `OrderedDict` 上限 10000 条做 LRU 淘汰，淘汰掉的键相当于重新开始计数。全局桶只有一个 key，不受影响。

429 响应带 `Retry-After` 头（秒），体是标准错误体：

```json
429
Retry-After: 2
{"detail": "Too many join attempts; try again in 2s", "code": "invite_rate_limited"}
```

### 8.2 各限流点

| bucket | 键 | 阈值 | code | 成功后 reset | 决策 |
|---|---|---|---|---|---|
| `login` | 客户端 IP | `RATE_LIMIT_LOGIN_PER_MINUTE` = 10 / 分钟 | `login_rate_limited` | 是 | §9 |
| `register` | 客户端 IP | `RATE_LIMIT_REGISTER_PER_HOUR` = 5 / 小时 | `register_rate_limited` | 否 | §14.43 的 03-8 |
| `join` | 固定串 `"global"`（**全局，不按用户**） | 1 QPS，突发 3（`Limit(capacity=3, refill_seconds=3)`） | `invite_rate_limited` | 否 | §2、§14.35 |
| `import` | 用户 id | `RATE_LIMIT_IMPORTS_PER_HOUR` = 10 / 小时 | `import_rate_limited` | 否（配额就是配额） | §9 |

四处的全部说明：

- **登录**：同一个 IP 每分钟 10 次，登录成功后清零，所以正常用户永远碰不到。
- **注册**：同一个 IP 每小时 5 次（决策 §14.43）。注册开着的时候它是唯一的无鉴权写接口，值得单独限。不清零。
- **加入账本**：整个端点全局 1 QPS，突发 3（决策 §14.35，推翻了原来的"同一用户 15 分钟 5 次"）。**不按用户、不按 IP 计数**，因为 6 位码的爆破是全局问题：谁在试都一样。被限流的请求在第一步就被挡回，**不消耗邀请码**（§5.19）。
- **导入**：每用户每小时 10 批（决策 §9）。现在导入是同步的，一批就是一次请求，这个桶同时也起到"别让人拿 2 MB 的文本刷服务端"的作用。

IP 的取法：`X-Forwarded-For` 的第一段（Caddy 会设），取不到则 `request.client.host`。要让它可信，uvicorn 必须加 `--proxy-headers --forwarded-allow-ips=*`（现状没加，`infra/Dockerfile.api:78`）——这是本设计对 infra 的一个要求（决策 §14.44 的 03-15）。

**没有 LLM 相关的限流点**（应用不接入 LLM，决策 §14.25）：上一版给"测试连接"用的那个桶与它的 429 code 一并删除。

---

## 9. 安全

### 9.1 没有第三方密钥要保管

上一版这里讲的是"用户的模型 api key 怎么加密存"。随决策 §14.25，应用**不保存任何第三方凭据**：没有模型设置表、没有加密密钥、没有 Fernet、没有出站到第三方模型服务的请求。整个服务里唯一的密钥是 `SECRET_KEY`（JWT 签名），唯一的出站请求是 Frankfurter（汇率，无凭据）。

这消掉的风险面值得记一笔：密钥轮换、解密失败的降级、日志里漏出 `sk-…`、密文列的备份策略——这些问题现在都不存在了。

### 9.2 日志脱敏

- 任何日志、任何异常信息里都不得出现 Bearer 令牌、口令。统一用一个 `logging.Filter`，对消息做正则替换：`Bearer\s+[A-Za-z0-9._\-]+` → `Bearer ***`。
- **账单内容是用户隐私**：上传或粘贴进来的 CSV 文本、以及从中解析出的商户名与备注，不写日志、不进错误信息。`import_format_invalid` 的 `errors[]` 里只放行号与"该行有 10 列，应为 11 列"这种结构描述，**不回显原始行的内容**（§5.37）——否则一份错误响应就把账单摘要抄了一遍，还可能被截图分享。
- `DEBUG` 在生产必须是 `False`（`infra/.env.example:32` 已经是），否则 Starlette 的调试页会把堆栈和局部变量吐给客户端。

### 9.3 上传内容的处理

- **不落盘**（决策 §14.28）：上传的文件在内存里读完、校验完、写进 `import_rows` 就丢弃，磁盘上不留任何东西。后端没有文件系统状态，也就没有上传目录、没有上传卷、没有目录清理、没有孤儿文件、没有目录穿越的攻击面。`import_batches` 只记文件名与字节数（决策 §5）。
- **大小**：`MAX_UPLOAD_MB`（2）。不要等读完再判断——边读边累加字节数，超过就中断并返回 413 `file_too_large`。Caddy 侧也应该配 `request_body max_size 4MB`（现状没配任何限制，`../current-design/06-known-issues.md` M-10），让超大请求在反代就被挡掉。
- **类型**：只收纯文本 CSV（决策 §14.47）。判定不看客户端给的 `Content-Type` 也不看扩展名，而是直接按 UTF-8（允许 BOM）解码：解不开就是 400 `import_format_invalid`。二进制文件（PDF、图片、xlsx）会在这一步被自然挡下——它们本来就该交给用户自己的 ChatGPT / Claude 去读（决策 §5）。
- **文件名**：只存进数据库列用于展示，绝不参与任何路径拼接（反正也没有路径了）。存前做长度截断（200 字符）和控制字符过滤。
- **行数**：`IMPORT_MAX_ROWS`（2000）。CSV 解析本身按流式逐行做，超过上限立即停止并返回 400 `rows_exceed_limit`，不把 200 万行读进内存。

### 9.4 导入文件是不可信输入

标准 CSV 是**用户的聊天工具生成、用户自己上传**的，服务端必须当成完全不可信的数据（哪怕它长得很规范）。防线：

1. **逐字段校验，不认识就置空或打标记**（决策 §5）：`date` 必须能解析成日期、`amount` 必须能解析成 Decimal、`currency` 必须是三位字母且在支持列表、`kind` 必须四选一、`category_l1` / `category_l2` 不在常量表里就**置空**（待归类）——不报错、不丢行，改动写进 `hint`。
2. **CSV 注入**（公式注入）：`merchant` / `note` / `source_ref` 里可能出现 `=cmd|…`、`+HYPERLINK(…)` 这类以 `=` `+` `-` `@` 开头的串。服务端**原样存**（它们就是文本），但本应用**不导出 CSV**（决策 §14.52 A1 明确本版不做导出），所以没有把它们喂回 Excel 的路径；前端一律当纯文本渲染，不做任何 HTML 插值。
3. **金额与日期的最终裁决权在服务端**：符号由 `kind` 强制（§5.26 的符号规则），文件里给的符号不匹配就按 kind 纠正并给该行打 `needs_review`。
4. **草稿不是交易**：文件里的任何东西都只会变成 `import_rows` 里的草稿；要等用户在 review 表格里过一遍并点提交（§5.43）才会写 `transactions`。即使一份文件从头到尾是伪造的，最坏结果也只是一批需要用户手工删掉的草稿行。
5. **提交时再跑一遍与手工记账完全相同的校验**（§5.43 第 4 步），不给导入开后门。
6. **不执行任何东西**：没有 `eval`、没有公式求值、没有外部引用跟随，CSV 就是被 `csv.reader` 读一遍的文本。

### 9.5 其他

- 非成员访问账本一律 404，不泄露账本是否存在（§3.3）。
- 邀请码是 6 位数字（10^6 个），靠**端点级全局 1 QPS** 的限流 + 10 分钟有效期 + 一次性使用（用掉即删）来防爆破（决策 §2、§14.29、§14.35）。1 QPS 意味着把码空间试一遍要 11 天，而任何一个码只活 10 分钟。
- 注册开关 `REGISTRATION_OPEN=false` 时 `POST /auth/register` 返回 403 `registration_closed`，且**不**因为邮箱是否已存在而给出不同响应（不泄露谁注册过）。`GET /config`（§5.6）会把这个开关公开出去——这是有意的，它不含任何用户信息。
- 密码规则只有"≥ 8 且 ≤ 72 字节"（决策 §9 不做找回密码，所以也别把规则搞复杂让人记不住）；管理员用 `backend/scripts/reset_password.py` 重置。
- CORS 保持现状（`backend/app/main.py:18-24`），生产里前端与 API 同源，`ALLOWED_ORIGINS` 只留真实域名。
- `X-Client`（§4.7）是**自称**，任何人都能伪造。它只用于展示，绝不参与鉴权、授权或限流。

---

## 10. 测试计划

现状的测试套件有 36 个用例，其中一大半是"读源码字符串做断言"（`../current-design/03-backend-api.md` §9.2、`../current-design/06-known-issues.md` M-15），没有一个通过 HTTP 碰过资金账户或交易接口。目标是把它们全部替换成行为测试。

### 10.1 基础设施

- `conftest.py` 提供：`db_session`（事务包裹、每个用例回滚）、`client`（`TestClient` + `get_db` 覆盖）、`user_factory` / `ledger_factory` / `source_factory` / `transaction_factory` / `import_csv`（拼一份合法的标准 CSV 文本，可按参数注入各种坏值）、`auth_headers(user)`。
- **所有**出站 HTTP 都用 `httpx.MockTransport` 桩掉，测试进程绝不联网：只剩一个 `fake_frankfurter` fixture（按 `/latest`、`/{start}..{end}` 返回固定汇率）。**没有假 LLM 服务器了**（应用不调模型，决策 §14.25），上一版的 `make_fake_llm` 与它的九个场景一并删除。
- `ratelimit` 在每个用例前自动清空（`autouse` fixture 调 `ratelimit.reset_all()`），否则用例之间会互相干扰——尤其是 `join` 的**全局**桶，一个用例用掉的令牌会直接影响下一个。
- 固定 `SECRET_KEY`、`REGISTRATION_OPEN`、`MAX_UPLOAD_MB` 等环境变量，不再让本机 `backend/.env` 影响结果（现状 `test_config.py` 就栽在这上面）。

### 10.2 按接口的关键用例

| 端点 | 必须覆盖的用例 |
|---|---|
| `POST /auth/register` | 成功建用户 + 默认账本 + owner 成员（查库确认三张表）；重复邮箱 409 `email_exists`；`REGISTRATION_OPEN=false` → 403；口令 7 字节 → 422；口令 73 字节 → 422（不是 500）；第 6 次 → 429 `register_rate_limited` |
| `POST /auth/login` | 成功签发；错口令 401 `invalid_credentials`；未知邮箱同样 401 且响应完全一致；第 11 次 → 429 |
| `GET/PATCH /me` | **auth 路由下的 `me` 两条别名都不存在（404）**（决策 §14.42）；改 `language`；`{"language": null}` 恢复跟随系统；改 `display_name`、传 `null` 清空；请求体带 `default_source_id` 这类未知字段 → 422 `validation_error`（请求模型拒绝未知字段，决策 §14.42 不做兼容）；改不支持的币种 → 400 |
| `GET /categories` | 22 个一级；每个二级的 parent 正确；**每个一级的 `desc_zh` / `desc_en` 都非空、每个二级的都是 `null`**（决策 §14.21）；`version` 与 `CATEGORY_VERSION` 一致；`If-None-Match` 命中 → 304 |
| `GET /config` | 匿名可读；`REGISTRATION_OPEN` 两种取值各一次，返回值跟着变 |
| `GET /import-format` | 匿名可读；`version` == `CATEGORY_VERSION`；`file.header` 与 05 章的 11 列逐字相同；**`sample_csv` 拿去 `POST /imports` 能直接建出批次**（这一条同时守住了"文档与实现不漂移"） |
| `POST /ledgers` | 第 11 本 → 409 `ledger_limit_reached` |
| `GET /ledgers/{id}` | `counts` 三个数与库里一致；列表接口 `GET /ledgers` **没有** `counts` 也没有净资产（决策 §14.52 A16） |
| `PATCH /ledgers/{id}` | member 调 → 403 `not_owner`；旧 `updated_at` → 409 `stale_update`；改基准币种后统计口径跟着变、且历史交易的 `amount_base` 仍按各自发生日汇率算（决策 §14.52 B8） |
| `DELETE /ledgers/{id}` | `confirm_name` 不符 → 400；成功后账户 / 交易 / 批次 / 事件全被级联删 |
| 成员与邀请 | owner 生成码 → member 用码加入 → 第二次用同一个码 400 `invite_invalid`（**不是** `invite_used`，码已删，决策 §14.29）；过期码 400；生成新码时本账本的过期码被删掉；`DELETE /invites/{code}` 后该码不能再用；非 owner 调 DELETE → 403；自己用自己的码 409 `already_member`；满 10 人 409 |
| `POST /ledgers/join` 限流 | 连发 5 次（不同用户、不同码）→ 第 4 次起 429 `invite_rate_limited` 且带 `Retry-After`（全局桶，与用户无关，决策 §14.35）；**被限流的那次不消耗邀请码**：等待后用同一个码仍能成功加入 |
| `transfer-ownership` / `leave` | owner 转让后失去 owner 权限；owner 直接 `/leave` → 409 `owner_must_transfer`；member `/leave` 后该账本变 404 |
| `GET /sources` | `balance` = `opening_balance` + Σ 交易折算到账户币种（含单腿转账、含一笔异币种交易按发生日汇率折算，决策 §14.2）；`balance_base` 用最新汇率；**`assets` / `liabilities` / `net_worth` 三个数正确，且归档账户不计入**（决策 §14.50）；信用卡余额为负计进 `liabilities`；汇率桩失败时三个合计与 `balance_base` 都是 null 但仍 200 |
| `POST /sources` | `type=savings` → 422（四选一，决策 §14.48）；`opening_balance` 负数存得下（信用卡欠款，§14.52 A13） |
| `PATCH /sources/{sid}` | 带 `default_currency`（哪怕值不变）→ 400 `currency_locked`（决策 §14.50）；`archived: true` 之后 `archived_at` 非空、取消归档后回到 `null`；归档账户上的历史交易仍可 PATCH（决策 §14.40 的 01-12），但新建交易 → 409 `source_archived` |
| `DELETE /sources/{sid}` | 无交易 → 204；有交易 → 409 `source_has_transactions` |
| `POST /transactions` | 四种 kind 各建一条；符号与 kind 不匹配 → 400；transfer 带分类 → 400；transfer 带 `merchant` → 400（决策 §14.52 B16）；单腿转账币种 ≠ 账户币种 → 400（A11）；`repayment` + `transfer_role='in'` 落在非信用卡账户 → 400 `repayment_target_not_credit`，同一条改成 `transfer_role='out'`（储蓄卡那一腿）→ 201；expense 用收入分类 → 400 `category_kind_mismatch`；`refund_of` 指向 income → 400；不给分类的 refund 沿用原单分类；归档账户 → 409；`occurred_at` = 今天+2 天 → 422；**每建一条就多一条 `transaction_events(created)`，`client` 取自 `X-Client`** |
| `GET /transactions` | 决策 §4 的每个参数**逐个**有用例 + 一个组合用例；`import_batch_id` 筛选只返回那一批（决策 §14.46）；`currency` 筛原币；**`min_amount` / `max_amount` 按基准币种折算后比较**——一笔 1000 JPY（≈50 CNY）在 `min_amount=100` 下**不**出现，而一笔 20 EUR（≈166 CNY）出现（决策 §14.49）；`summary` 的三个数与全量结果一致且**翻页不变**、转账不计入 `net`（§14.52 A14）；`{items,total}` 的 total 是过滤后的；排序稳定；`refunded_total` / `refundable` 只出现在 expense 行且数值正确；跨账本的 `source_id` → 404 |
| `GET /transactions/{tid}` | expense 详情带 `refunds[]`（两笔部分退款都在、按日期升序）；refund 详情的 `refund_of_detail` 有原单摘要与已退 / 可退，`other_refunds` 列出同原单的另一笔且**不含自己**（决策 §14.52 A25）；原单删除后 `refund_of_detail` 为 null；两腿的 `pair` 有对腿、单腿为 null；`events[]` 按时间倒序且包含 created / updated；`rate_used` / `rate_date` 非空（决策 §14.52 A24） |
| `PATCH /transactions/{tid}` | 旧 `updated_at` → 409；`expense` → `refund` 整行重校验通过；`expense` → `transfer`（同时补齐 `transfer_role` / `transfer_subtype` 并清掉分类，即所有 CHECK 都能满足的那种请求）→ 400 `kind_change_not_allowed`；单腿 `transfer` → `expense` 同样 400；对两腿中的一腿 → 409 `use_transfer_endpoint`；**改 `refund_of` 会多出一条 `refund_linked` / `refund_unlinked` 事件；什么都没真变时不写事件** |
| `DELETE /transactions/{tid}` | 单条删除只删一行；**它的 `transaction_events` 一起没了**；删被 refund 引用的 expense 后退款行还在且 `refund_of` 为 null；对两腿中的一腿 → 409 `use_transfer_endpoint` |
| `POST /transactions/transfer` | 建出两行、同 `pair_id`、符号相反、跨币种金额不等也 OK；同币种省略 `amount_in` 时两腿金额相同（决策 §14.52 A11）；`repayment` 转入非信用卡 → 400；同一账户 → 400 `same_source`；归档账户 → 409；第二腿插入失败时第一腿也不存在（用 `mock` 让第二次 flush 抛异常，验证回滚） |
| `PATCH/DELETE /transactions/transfer/{pair_id}` | 两腿一起改 / 一起删；不存在的 `pair_id` → 404；只剩一腿时 PATCH → 409 `transfer_pair_incomplete`、DELETE → 204 |
| `POST .../{tid}/pair` | 两条方向相反的单腿 → 共用新 `pair_id`、两边 `counterparty` 都被清空、各多一条 `paired` 事件；跨币种、金额不等也允许；对已成对的一条 → 400 `pair_invalid`；同方向 → 400；同账户 → 400；和自己 → 400；非 transfer → 400；跨账本 → 404；**一腿 `plain` 一腿 `repayment` 且转入腿账户是 `credit` → 两腿都变 `repayment`、变了的那腿多一条 `updated` 事件（`changes.transfer_subtype`）；转入腿账户不是 `credit` 时两腿都变 `plain` 且不返回 `repayment_target_not_credit`；两腿 `occurred_at` 不同 → 各自保留、顶层取转出腿**（决策 §14.53a） |
| `POST .../transfer/{pair_id}/unpair` | 两腿都变回 `transfer_pair_id = null` 且都还在；各多一条 `unpaired` 事件；拆开后两条各自可 PATCH / DELETE（不再 409）；只剩一腿的 pair → 409 `unpair_invalid` |
| `stats/summary` | 转账不计入；退款按退款日期冲减对应分类（跨月的用例：8 月支出、9 月退款，验证 8 月不变、9 月减）；某分类被冲成负数照实返回（决策 §14.44 的 03-10）；多币种按发生日汇率折算；`share` 之和约等于 1 |
| `stats/trend` | **只有 `expense` 字段，没有 `income` / `net`**（决策 §14.52 B20）；空月份补 `"0.0000"`；`months=12` 返回 12 个元素且时间连续 |
| `POST /imports`（成功路径） | 上传合法 CSV → **201**（不是 202）且响应里同时有 `batch` 与全部 `rows`；粘贴 `text` 走同一套校验、结果与上传逐字相同（只有 `source` 与 `filename` 不同）；`status` 直接是 `ready`；`flags_summary` 四种标记计数正确；`net_amount` 与手算一致 |
| `POST /imports`（拒绝路径） | 缺 `# version:` 行 → 400 `import_format_invalid` 且 `errors` 恰好一条、`errors[0].line == 1`（决策 §14.53d）；版本写成 `2026-08-20` → 400 `skill_outdated` 且带 `current_version` 与 `guide_url`（决策 §14.30）；表头少一列 → 400 `import_format_invalid` 且 `errors[0].line == 2`；某行 10 列 → 400 且 `errors` 指出那一行的行号；2001 行 → 400 `rows_exceed_limit`；3 MB → 413；上传一个 PDF → 400 `import_format_invalid`（解码失败）；归档账户 → 409；第 11 批 → 429。**每一种拒绝之后库里都没有新批次** |
| 导入的行级校验 | 日期写成 `08/03/2026` → 行仍在、`needs_review`、`hint` 说明；`amount` 写成 `abc` → 行仍在并 `needs_review`；`currency` 写成 `XX` → 改成账户币种并写 `hint`；`kind` 写成 `spend` → 按符号推断并 `needs_review`；分类 code 瞎编 → 该字段置空、行进"待归类"；**一条都没丢**（决策 §5、§14.52 B2） |
| 导入的自动标记 | 同账户同日同额已有交易 → `duplicate`；唯一候选原单 → `refund_candidate` + 预填 `matched_transaction_id`；对方账户上 ±3 天同额反向单腿 → `transfer_candidate` + 预填；对方已是两腿的一半 → `duplicate`（决策 §14.34）；**批内两行完全相同 → 两行都保留、都 `needs_review`、`hint` 互相指出行号**（决策 §14.31，断言**没有**合并、`flags` 里也没有第五种取值） |
| `PATCH .../rows/{rid}` | 改分类 → `status` 自动变 `edited`；`skipped` 往返；把 `matched_transaction_id` 置 null 取消配对；给非 transfer 行设 `counterpart_source_id` → 400；批次已 committed → 409 `batch_not_ready` |
| `PATCH .../rows`（批量） | 12 行一次设成同一分类 → `updated == 12`；其中夹一条收入行 → **整体 400 且一行都没改**（事务性）；`row_ids` 里混入别的批次的行 → 404；`{"status":"skipped"}` 批量跳过 |
| `POST .../commit` | 全部行建成交易且都带 `import_batch_id`；每条交易有一条 `imported` 事件且 `import_batch_id` 指回批次；含 `counterpart_source_id` 的还款行建出两腿；含 `matched_transaction_id` 的转账行与**已有单腿**配对成功（已有那条的 `counterparty` 被清空、多一条 `paired` 事件，决策 §14.34）；`refund` 行写进 `refund_of`（决策 §14.7）；有行缺一级分类 → 409 `rows_uncategorized` 且一条交易都没建；全部 skipped → 409 `rows_all_skipped`；重复 commit → 409 `batch_already_committed`；中途异常整体回滚 |
| `DELETE /imports/{bid}` | `ready` → 丢弃（交易数不变）；`committed` → 撤销（这批交易全没了、事件也没了、别的交易不受影响、批次本身也不在列表里了，决策 §14.22）；`?dry_run=1` 不删只报数，且 `orphaned_refunds`（批外退款指向批内原单）与 `refunds_in_batch`（批内退款）**两个数各自正确、不混淆**（决策 §14.52 B24）；member 也能撤销（决策 §14.52 B9） |
| `/rates/*` | 汇率日期是上游日期不是今天；跨币种只发一次上游请求（用 `MockTransport` 计数） |
| 鉴权 | 每个账本端点各来一次"非成员"用例 → 404；owner-only 端点（改 / 删账本、移除成员、转让、生成邀请码、作废邀请码）来一次"member" → 403；无令牌 → 401 |

### 10.3 汇率与迁移

- `fx.convert` 的单元测试：同币种直接返回；命中缓存不发请求；周六的日期回退到周五（桩件只在工作日返回行情）；超过 10 天回退窗口后走 `/latest`（决策 §14.44 的 03-12）；上游全挂 → `ApiError(503, fx_unavailable)`。
- **缓存是 upsert 且保留历史**（决策 §14.1）：同一天的行重复写不报错也不产生第二行；写入新日期不会删掉旧日期的行；断言表里同时留着 9 月 1 日与 9 月 8 日两天的 `(CNY, EUR)`。
- `fx.convert_many` 的请求计数测试：200 行、3 个币种 → 恰好 3 次上游请求（不是 200 次）。
- **Postgres 迁移测试**（决策 §13 要求）：一个 `pytest.mark.postgres` 的用例集，在 CI 里用 `docker run postgres:15` 起一个临时库，分别验证
  1. 空库 `alembic upgrade head` 成功，且 `alembic downgrade base` 也成功；
  2. 先把库恢复到旧 head `8a4f4d66d893` 并灌入一批旧数据（用户、账户、带 `transfer_pair_id` 的交易、标签），再 `upgrade head`，检查回填结果：每个用户有默认账本、`transactions.kind` 按决策 §13 的规则回填、`description` 变成 `note`、`transaction_tags` 已删除、`finance_sources.type` 里的 `savings` 全部变成 `checking`（决策 §14.48）、`users.default_source_id` 已 drop（决策 §14.42）、所有 CHECK 都满足；
  3. `upgrade head` 之后 `Base.metadata` 与实际库结构一致（用 `alembic check` 或 `compare_metadata`）。
- SQLite 上跑的常规测试要开 `PRAGMA foreign_keys=ON`（现状没开，导致级联删除在测试里静默不生效，`../current-design/03-backend-api.md` §4.16）。这一条现在更重要了：`transaction_events` 的级联删除、`refund_of` 的 `SET NULL` 都靠它。

### 10.4 标准导入文件的校验用例集

导入是本版改动最大的一块，值得单独有一组**表驱动**的用例：一个 `cases/` 目录放若干 `.csv` 小文件，每个文件配一份期望（HTTP 状态 + code + 逐行的 `flags` / `hint` / 最终字段值），用 `pytest.mark.parametrize` 一次跑完。

必须有的文件（与 [`./05-import-and-llm.md`](./05-import-and-llm.md) §2 的规则一一对应）：

| 文件 | 期望 |
|---|---|
| `ok_minimal.csv` | 一行支出，201，`flags == []`、`hint == null` |
| `ok_all_kinds.csv` | 四种 kind 各一行，201，符号与分类都过 |
| `ok_bom.csv` | 带 UTF-8 BOM，201（BOM 必须被吃掉，不能让第一行变成 `﻿# version:`） |
| `ok_crlf.csv` | Windows 换行，201 |
| `ok_quoted_comma.csv` | 商户名里有逗号且被引号包住，201 且商户名完整 |
| `bad_no_version.csv` | 400 `import_format_invalid`，`errors` 恰好一条且 `errors[0].line == 1`（决策 §14.53d） |
| `bad_old_version.csv` | 400 `skill_outdated`，`file_version == "2026-08-20"` |
| `bad_header_order.csv` | 表头列序被换过 → 400 `import_format_invalid`，`errors[0].line == 2` |
| `bad_header_extra.csv` | 多一列 `counterparty`（决策 §14.52 B3 点名的那种旧格式）→ 400 `import_format_invalid` |
| `bad_ragged.csv` | 第 14、87 行列数不对 → 400，`errors` 恰好两条且行号正确 |
| `bad_binary.pdf` | 400 `import_format_invalid`（解码失败） |
| `row_bad_date.csv` | 201；那一行 `needs_review`，`hint` 提到日期 |
| `row_bad_amount.csv` | 201；那一行 `needs_review` |
| `row_bad_currency.csv` | 201；`currency` 变成账户币种，`hint` 说明 |
| `row_bad_kind.csv` | 201；按金额符号推断，`needs_review` |
| `row_bad_category.csv` | 201；`category_l1` 置空，进 `uncategorized_count` |
| `row_dup_in_batch.csv` | 201；两行都在、都 `needs_review`、`hint` 互指行号（决策 §14.31） |
| `limit_2001_rows.csv` | 400 `rows_exceed_limit` |

这组用例同时守住"文档里的规则"和"实现"：改校验规则必须同时改 05 章、改这里的期望文件，三处对不上就红。

### 10.5 覆盖率目标与运行方式

```text
cd backend && poetry run pytest                       # 默认跳过 postgres 标记
cd backend && poetry run pytest -m postgres           # 需要 DATABASE_URL 指向临时 PG
cd backend && poetry run pytest --cov=app --cov-report=term-missing
```

`pytest-cov` 要加进 `pyproject.toml` 的 dev 依赖（现状 README 写了用法但依赖不在 lock 里）。硬性要求：`app/api/`、`app/services/`、`app/core/` 三个包的行覆盖率不低于 85%，且**每个错误 code 至少被一个用例触发过**（用一个收集所有 `ApiError.code` 的 fixture 在 session 结束时断言，防止 §4.2 的清单和实现漂移）。

---

## 待决

本章原有的 16 条待决**已全部处理**，逐条对照如下（决策记录里的裁定为准，正文已按裁定改写）：

| # | 原问题 | 结果 |
|---|---|---|
| 03-1 | auth 路由下的 `me` 别名与 `/me` 并存 | **已由决策 §14.42 裁定**：不做向后兼容，别名不注册，`/me` 是唯一入口（§5.3、§5.4） |
| 03-2 | 别名 PATCH 里的 `default_source_id` | **已由决策 §14.42 裁定**：直接移除，迁移里 drop 这一列；前端本地记住上次使用的账户 |
| 03-3 | 成员的显示名 | **已由决策 §14.40 裁定**：`users.display_name VARCHAR(40) NULL`，`PATCH /me` 可改，没填时前端显示邮箱前缀（§5.3、§5.13） |
| 03-4 | `created_by` / `updated_by` 是否展开 | **已由决策 §14.43 裁定**：只回用户 id，前端用成员列表映射（§5.13） |
| 03-5 | 时间戳是否带时区 | **已由决策 §14.26 裁定**：naive UTC 存储 + API 输出带 `Z`（§4.5） |
| 03-6 | 删除类端点的返回 | **已由决策 §14.43 裁定**：统一 204，撤销导入例外（回撤销条数，§5.44） |
| 03-7 | 批次是否返回模型原始响应 | **已作废**：应用不调 LLM，没有这一列（决策 §14.25） |
| 03-8 | 「测试连接」与 `register` 两个限流点 | **一半作废一半裁定**：测试连接随 §14.25 消失；`register` 由决策 §14.43 裁定为同 IP 每小时 5 次、进程内令牌桶（§8.2） |
| 03-9 | 撤销导入的孤儿退款 | **已由决策 §14.43 裁定并扩充**：`dry_run` 返回 `orphaned_refunds`；§14.52 B24 再加一个 `refunds_in_batch`，两个方向分开措辞（§5.44） |
| 03-10 | 分类被退款冲成负数 | **已由决策 §14.44 裁定**：照实返回负数（§5.35） |
| 03-11 | `exchange_rates` 表要重建 | **已由决策 §14.1 裁定**：新建 `(date, base, symbol, rate, fetched_at)`，upsert 保留历史（§6.1） |
| 03-12 | 汇率回退窗口 | **已由决策 §14.44 裁定**：`FX_MAX_BACKFILL_DAYS = 10`，超过用最新汇率（§6.2） |
| 03-13 | `occurred_at` 的最大未来日期 | **已由决策 §14.44 裁定**：最晚今天 + 1 天（§5.26） |
| 03-14 | `limit` 上限 | **已由决策 §14.44 裁定**：交易列表 200、草稿行 500（§4.3、§5.40） |
| 03-15 | uvicorn 的 `--proxy-headers` | **已由决策 §14.44 裁定**：部署命令加 `--proxy-headers --forwarded-allow-ips=*`（infra 改动，§8.2） |
| 03-16 | `CATEGORY_VERSION` 的格式 | **已由决策 §14.30 裁定**：日期串（如 `2026-09-10`），改分类表时手工递增并重新生成 skill；导入时硬校验（§5.7、§5.37） |

新的待决：**无**。本章不再自行拍板任何决策记录没覆盖的问题；实现中若遇到新问题，先回 [`00-decisions.md`](./00-decisions.md) 提，不在这里加。

（一个明确记下来的**非待决**：本设计**不做**删除类操作的审计日志。`transaction_events` 跟着交易一起被级联删除（§7.2），所以"谁删了哪笔"查不到。这不是遗漏，是决策 §14.51 只要求"交易的操作记录"、§14.22 明确"撤销就是删除、不留痕"的直接后果。将来真需要，应作为一个新决定提出，而不是在本章补一张表。）

## 另见

- [./README.md](./README.md) — 目标设计总览与文件索引
- [./00-decisions.md](./00-decisions.md) — 决策记录（唯一事实来源）
- [./01-domain-and-flows.md](./01-domain-and-flows.md) — 领域模型、状态机与端到端流程
- [./02-database.md](./02-database.md) — 目标表结构、约束、索引与迁移链（含 `transaction_events`）
- [./04-frontend.md](./04-frontend.md) — 前端页面、API 客户端与错误 code 的文案映射
- [./05-import-and-llm.md](./05-import-and-llm.md) — 标准导入 CSV 格式、skill 规范、校验规则与自动标记算法
- [./mockups/README.md](./mockups/README.md) — 定稿的 16 张屏幕稿与视觉 token（决策 §14.45）
- [../current-design/README.md](../current-design/README.md) — 现状总览
- [../current-design/03-backend-api.md](../current-design/03-backend-api.md) — 现状的接口、鉴权、汇率两条路径与测试
- [../current-design/02-database.md](../current-design/02-database.md) — 现状表结构与迁移链
- [../current-design/06-known-issues.md](../current-design/06-known-issues.md) — 本文修复的 H-01、H-02、H-03、H-06、H-07、H-08、M-04、M-15
