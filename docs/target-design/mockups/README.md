# 设计交付物存放处

来自 Claude Design 项目「设计方案反馈」的交付物放在这里（见 `../design-brief.md` §3）：

- `tokens.json` — 按 04 章 §6.3 的 token 名称，`light` / `dark` 两组
- `components.md` — 每个组件的尺寸、内边距、边框、字号与各状态的 token 引用
- `screens/NN-<name>-{m,d}.png` — 各屏 375 / 1440 两个宽度的导出图，编号对应 `design-brief.md` §2
- `implementation-notes.md` — 在 React Native 上要换写法的效果

放好后告诉 Claude Code，它会据此生成 `frontend/src/theme/tokens.ts`、组件库，并把 04 章 §6 更新为最终稿。
