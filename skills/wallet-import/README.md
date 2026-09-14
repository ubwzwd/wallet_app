# wallet-import：账单整理 skill

把任意格式的账单（PDF 对账单、手机截图、Excel、支付宝 / 微信导出、网银复制的文本……）交给你自己的
ChatGPT 或 Claude，让它按这份 skill 整理成本应用能直接导入的标准 CSV。应用本身**不接入任何大模型**
——整理这一步完全在你自己的账号、自己的对话里完成，应用只负责校验和入账。

本目录的三份文件由 `scripts/gen_import_skill.py` 从 `backend/app/core/categories.py` 生成，
**不要手改**；分类表或规则有变化时改模板（`scripts/templates/`）再重新跑脚本。应用内「导入指南」
页（`/l/{ledgerId}/imports/guide`）展示的就是这三份文件的内容，来自 `GET /import-format`。

## 目录

| 文件 | 用途 |
|---|---|
| `SKILL.md` | Claude 版 skill 主文本 |
| `chatgpt-instructions.md` | ChatGPT 版指令文本 |
| `example.csv` | 标准 CSV 示例，可以直接拿去试导入 |

## 在 Claude 里装

**Claude.ai（网页 / 桌面）— 项目（Project）**

1. 打开或新建一个 Project。
2. 「Project knowledge」→「Add content」→ 上传 `SKILL.md`。
3. 在这个 Project 里开新对话，把账单文件拖进来，说"帮我整理成导入文件"。

**Claude Code**

1. 把 `SKILL.md` 放进你项目的 `.claude/skills/wallet-import/SKILL.md`（文件名与目录名需与
   frontmatter 里的 `name: wallet-import` 一致）。
2. 新开一次对话，账单丢进去，要求"用 wallet-import 整理成导入 CSV"。

**每次对话手动带上（不想装 skill 时）**

把 `SKILL.md` 的正文整段复制粘贴到对话开头，再把账单发给它。

## 在 ChatGPT 里装

**Custom GPT**

1. 创建一个新的 Custom GPT（Explore → Create a GPT → Configure）。
2. 把 `chatgpt-instructions.md` 里「指令正文」那一段（`---` 分隔线以下的部分）整段贴进
   Instructions 框。
3. 保存后，进这个 GPT 的对话，把账单发给它。

**Project**

1. 新建一个 Project，进「项目设置」→「Instructions」。
2. 同样把「指令正文」贴进去。
3. 在这个 Project 下的对话里发账单。

**不想建 Custom GPT / Project**

每次对话开头把「指令正文」贴一遍，再发账单。

## 拿到 CSV 之后

1. 打开应用，进入某个账本 →「导入」→ 选目标账户。
2. 上传它给你的 `.csv` 文件，或者把代码块里的内容整段粘贴进粘贴框（连 `# version:` 那一行一起）。
3. 在 review 表格里核对、补分类，确认无误后提交。

## 分类表更新了怎么办

应用如果提示 `skill_outdated`，说明分类表（连同这份 skill）出了新版本。回应用内的「导入指南」页
重新复制 / 下载一份最新的 `SKILL.md` 或指令文本，按上面步骤重新装一次，再让它重新整理这份账单。
