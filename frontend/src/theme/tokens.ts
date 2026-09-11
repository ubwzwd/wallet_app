/* eslint-disable */
/**
 * GENERATED FILE — do not edit by hand.
 * Source: docs/target-design/mockups/tokens.json (version 2026-09-10).
 * Regenerate with `node scripts/gen-tokens.mjs`; `--check` verifies it is current.
 */

export const TOKENS_VERSION = "2026-09-10";
export const TOKENS_DIRECTION = "04 柔和圆润 · Figtree · C2 密度 · N5 淡鼠尾草底 · S4 交易色 · X1 森林绿强调";

export type ColorToken =
  | "bg.canvas"
  | "bg.surface"
  | "bg.raised"
  | "bg.subtle"
  | "bg.hover"
  | "bg.selected"
  | "fg.primary"
  | "fg.secondary"
  | "fg.muted"
  | "fg.inverse"
  | "border.default"
  | "border.strong"
  | "border.focus"
  | "accent.solid"
  | "accent.fg"
  | "accent.subtle"
  | "kind.expense"
  | "kind.expense.subtle"
  | "kind.income"
  | "kind.income.subtle"
  | "kind.refund"
  | "kind.refund.subtle"
  | "kind.transfer"
  | "kind.transfer.subtle"
  | "status.success.fg"
  | "status.success.bg"
  | "status.warning.fg"
  | "status.warning.bg"
  | "status.danger.fg"
  | "status.danger.bg"
  | "status.info.fg"
  | "status.info.bg"
  | "flag.duplicate"
  | "flag.needs_review"
  | "flag.uncategorized"
  | "chart.series[0]"
  | "chart.series[1]"
  | "chart.series[2]"
  | "chart.series[3]"
  | "chart.series[4]"
  | "chart.series[5]"
  | "chart.series[6]"
  | "chart.series[7]";

export type ColorScheme = 'light' | 'dark';
export type Palette = Readonly<Record<ColorToken, string>>;

export const lightColors: Palette = {
  "bg.canvas": "#F1F6F1",
  "bg.surface": "#FAFCFA",
  "bg.raised": "#FFFFFF",
  "bg.subtle": "#E9F0E9",
  "bg.hover": "#E3ECE4",
  "bg.selected": "#DDE9DF",
  "fg.primary": "#16201A",
  "fg.secondary": "#3E4A42",
  "fg.muted": "#5F6A62",
  "fg.inverse": "#F4F8F4",
  "border.default": "#E1EAE2",
  "border.strong": "#C4D1C6",
  "border.focus": "#2F4A38",
  "accent.solid": "#2F4A38",
  "accent.fg": "#FFFFFF",
  "accent.subtle": "#E4EDE5",
  "kind.expense": "#AC4335",
  "kind.expense.subtle": "#F3E7E2",
  "kind.income": "#0D6A66",
  "kind.income.subtle": "#E0EEEC",
  "kind.refund": "#7E6412",
  "kind.refund.subtle": "#F1EDDC",
  "kind.transfer": "#3A5E70",
  "kind.transfer.subtle": "#E4EDEE",
  "status.success.fg": "#1F6A46",
  "status.success.bg": "#E2EFE5",
  "status.warning.fg": "#6B540D",
  "status.warning.bg": "#F1EDDC",
  "status.danger.fg": "#8A3529",
  "status.danger.bg": "#F3E7E2",
  "status.info.fg": "#2C4B5B",
  "status.info.bg": "#E4EDEE",
  "flag.duplicate": "#4A3A70",
  "flag.needs_review": "#8A4816",
  "flag.uncategorized": "#454F48",
  "chart.series[0]": "#2F4A38",
  "chart.series[1]": "#0D6A66",
  "chart.series[2]": "#7E6412",
  "chart.series[3]": "#3A5E70",
  "chart.series[4]": "#AC4335",
  "chart.series[5]": "#4A3A70",
  "chart.series[6]": "#4E7A4A",
  "chart.series[7]": "#6B6252",
};

export const darkColors: Palette = {
  "bg.canvas": "#111614",
  "bg.surface": "#171D19",
  "bg.raised": "#1E2620",
  "bg.subtle": "#232C26",
  "bg.hover": "#29332C",
  "bg.selected": "#23342A",
  "fg.primary": "#E9EFE9",
  "fg.secondary": "#B0BCB3",
  "fg.muted": "#8A968C",
  "fg.inverse": "#111614",
  "border.default": "#2A342D",
  "border.strong": "#3E4A41",
  "border.focus": "#7FC095",
  "accent.solid": "#6FB98A",
  "accent.fg": "#0E2116",
  "accent.subtle": "#1D2A22",
  "kind.expense": "#EE9186",
  "kind.expense.subtle": "#33211E",
  "kind.income": "#45BEB8",
  "kind.income.subtle": "#12302E",
  "kind.refund": "#D6AF57",
  "kind.refund.subtle": "#302711",
  "kind.transfer": "#8CB3CC",
  "kind.transfer.subtle": "#1B2831",
  "status.success.fg": "#6FC993",
  "status.success.bg": "#14301F",
  "status.warning.fg": "#D6AF57",
  "status.warning.bg": "#302711",
  "status.danger.fg": "#EE9186",
  "status.danger.bg": "#33211E",
  "status.info.fg": "#8CB3CC",
  "status.info.bg": "#1B2831",
  "flag.duplicate": "#A995DB",
  "flag.needs_review": "#E0904D",
  "flag.uncategorized": "#93A096",
  "chart.series[0]": "#79B992",
  "chart.series[1]": "#5CBDB6",
  "chart.series[2]": "#CBAA55",
  "chart.series[3]": "#87AFC4",
  "chart.series[4]": "#E29085",
  "chart.series[5]": "#A08FCB",
  "chart.series[6]": "#93C48E",
  "chart.series[7]": "#B4A996",
};

export const palettes: Readonly<Record<ColorScheme, Palette>> = { light: lightColors, dark: darkColors };

/** The 8 category / chart colours (04 §6.2 rule 3) — never the four kind colours. */
export const CHART_SERIES_COUNT = 8;
export function chartSeries(p: Palette): readonly string[] {
  return [p["chart.series[0]"], p["chart.series[1]"], p["chart.series[2]"], p["chart.series[3]"], p["chart.series[4]"], p["chart.series[5]"], p["chart.series[6]"], p["chart.series[7]"]];
}

export const font = {
  sans: {
    family: "Figtree",
    fallback: "'Figtree', 'PingFang SC', 'Noto Sans SC', 'Microsoft YaHei', sans-serif",
    weights: [
      400,
      500,
      600,
      700
    ],
    use: "标题 + 正文 + UI"
  },
  mono: {
    family: "IBM Plex Mono",
    fallback: "'IBM Plex Mono', ui-monospace, monospace",
    weight: 450,
    use: "金额 / 日期 / 行号，tabular-nums，真减号 U+2212"
  }
} as const;

export type TypeVariant = "display" | "title" | "heading" | "subheading" | "body" | "caption" | "micro";
export const type: Readonly<Record<TypeVariant, { size: number; lineHeight: number; weight: number }>> = {
  display: {
    size: 40,
    lineHeight: 44,
    weight: 700
  },
  title: {
    size: 28,
    lineHeight: 34,
    weight: 700
  },
  heading: {
    size: 20,
    lineHeight: 28,
    weight: 600
  },
  subheading: {
    size: 16,
    lineHeight: 24,
    weight: 500
  },
  body: {
    size: 14,
    lineHeight: 20,
    weight: 400
  },
  caption: {
    size: 12,
    lineHeight: 16,
    weight: 400
  },
  micro: {
    size: 11,
    lineHeight: 14,
    weight: 500
  }
};
export const TYPE_NOTES = "七档；数字用同档字号切到 mono + tabular-nums；标题档 700 且 letter-spacing −0.02em";

export const space = {
  "1": 4,
  "2": 8,
  "3": 12,
  "4": 16,
  "5": 20,
  "6": 24,
  "7": 28,
  "8": 32,
  "10": 40,
  "12": 48,
  "14": 56,
  "16": 64
} as const;
export type SpaceStep = keyof typeof space;

export const density = {
  name: "C2",
  listRowHeight: 56,
  rowInnerPadding: 14,
  containerPadding: "14–16",
  cardGap: 12
} as const;
export const radius = {
  sm: 8,
  md: 14,
  lg: 18,
  pill: 999
} as const;
export const RADIUS_USAGE = "sm=Badge/小色块, md=按钮/输入框, lg=分组容器/Sheet 顶部, pill=Chip/头像/圆形图标底";
export const shadow = {
  none: "none",
  raised: "带绿相的极轻阴影；RN elevation 1",
  overlay: "RN elevation 8",
  note: "深色下不用阴影，用 bg.surface→bg.raised 明度差分层"
} as const;
export const controls = {
  button: {
    heights: {
      sm: 36,
      md: 44,
      lg: 48
    },
    radius: 14,
    variants: [
      "primary",
      "secondary",
      "ghost",
      "danger"
    ],
    notes: "danger 默认描边；按下只换底色不缩放"
  },
  textField: {
    height: 52,
    radius: 14,
    notes: "淡底无描边，聚焦出 1.5px 描边；错误态淡红底+红描边不整行染红"
  },
  badge: {
    height: 26,
    shape: "方 pill 只读"
  },
  chip: {
    height: 34,
    shape: "圆 pill 可点掉"
  }
} as const;
export const icons = {
  grid: 20,
  stroke: 1.9,
  cap: "round",
  note: "颜色继承文字色；语义色只在圆形图标底和 Badge；RN 用 react-native-svg"
} as const;
export const kindSemantics = {
  transferAmount: "用 fg.primary，不染语义色",
  categoryDots: "取 chart.series，不取交易色"
} as const;

/* Not part of the visual sign-off (04 §6.2, last paragraph): values are ours to choose. */
export const z = { dropdown: 100, sticky: 200, overlay: 300, toast: 400 } as const;
/** Milliseconds; both collapse to 0 under prefers-reduced-motion. */
export const motion = { fast: 120, base: 200 } as const;
/** The single breakpoint (decision §0.6): below = narrow (bottom tabs), at/above = wide (sidebar). */
export const breakpoint = { md: 1024 } as const;
