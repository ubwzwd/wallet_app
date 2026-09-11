# 设计稿（来自 Claude Design）

2026-09-10 从 Claude Design 项目「设计方案反馈」整体导出，未做修改；2026-09-11 按 [`CLAUDE-DESIGN-CHANGES.md`](./CLAUDE-DESIGN-CHANGES.md) 在 Claude Design 里修改后再次整体导出并覆盖（屏幕 01–03、05–15 更新，新增屏幕 17；token 与其余画板未变）。文件是 Claude Design 的画板格式（`.dc.html`，配套 `support.js` 供本地打开）。

**选定方向**：`04 柔和圆润 · 深化` → `Design Tokens v2 · 定稿`：Figtree（中文走系统字）+ IBM Plex Mono 数字，C2 密度（行高 56、圆角 18），N5 淡鼠尾草底，S4 交易色（砖红 / 深青 / 橄榄金 / 板岩蓝），X1 森林绿强调。取代了 04 章 §6 里的方向 A/B/C（决策 §14.45）。

| 文件 | 内容 |
|---|---|
| `tokens.json` | 从「Design Tokens v2 · 定稿」提取的 token（浅色 / 深色各 43 个颜色、字号阶、间距、圆角、阴影、控件尺寸、图标规格）。**这是前端 `frontend/src/theme/tokens.ts` 的来源。** |
| `Design Tokens v2 · 定稿.dc.html` | token 定稿画板：颜色表、字体、间距、图标集、Button / TextField / Badge / Chip / CategoryPicker 各状态 |
| `Ledger Design Tokens v1.dc.html` | token 第一版（已被 v2 取代，留作记录） |
| `04 柔和圆润 · 深化.dc.html` | 方向深化稿：字体三选、密度三选、组件形态、配色四选 |
| `风格样片 · 选项对照.dc.html`、`配色 · 三步走.dc.html` | 方向与配色的探索过程 |
| `屏幕 01 · 首页` … `屏幕 16 · 深色模式三屏`、`屏幕 17 · 登录与注册` | 17 张屏幕稿，对应 `design-brief.md` §2 的屏幕清单加 2026-09-11 补的登录 / 注册屏 |
| `REVIEW-2026-09-11.md` | 第一版屏幕稿与决策记录的对照审阅及裁定 |
| `REVIEW-2026-09-11b.md` | 第二版屏幕稿的复核：逐条对照 `CLAUDE-DESIGN-CHANGES.md` 的落地结果、全局规则违反项、新引入的问题，以及还要回 Claude Design 改的清单 |
| `CLAUDE-DESIGN-CHANGES.md` | 按裁定整理的、拿回 Claude Design 用的修改提示词 |

注意：画板里分类选项的"判据"文字是示意，正式文案以 `00-decisions.md` §1.3 的 `desc_zh` 为准。
