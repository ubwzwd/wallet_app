/**
 * Category ranking and the 12-month expense trend (04 §4.4, §6.2 rule 3): eight bars plus
 * "其他 N 项", level-2 drill-down, every trend point labelled with its own number, and the
 * chart palette coming from `chart.series` rather than the four kind colours.
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import type { Money } from '@/api/types';
import { namespaces, resources } from '@/i18n/resources';
import { ThemeProvider } from '@/theme/ThemeProvider';
import { chartSeries, lightColors } from '@/theme/tokens';
import {
  BAR_HEIGHT_WIDE,
  BAR_LABEL_BAND,
  BarChart,
  barHeights,
  compactBarLabel,
  monthAbbrev,
  narrowLabelIndexes,
} from '@/ui/BarChart';
import { BarList, type BarListItem } from '@/ui/BarList';
import { TrendChart } from '@/ui/TrendChart';
import { makeStatsTrend } from '@/test/fixtures';

beforeAll(async () => {
  if (!i18next.isInitialized) {
    await i18next.use(initReactI18next).init({
      lng: 'zh',
      fallbackLng: 'zh',
      ns: [...namespaces],
      defaultNS: 'common',
      resources: resources as never,
      interpolation: { escapeValue: false },
    });
  }
});

function renderThemed(node: React.ReactElement) {
  return render(<ThemeProvider initialPref="light">{node}</ThemeProvider>);
}

function styleOf(element: { props: { style?: unknown } }): Record<string, unknown> {
  return StyleSheet.flatten(element.props.style as never) as unknown as Record<string, unknown>;
}

/** The jest runtime reports a 750pt window (narrow). Flip this for the 1440 frame. */
let mockWideViewport = false;

jest.mock('@/theme/useBreakpoint', () => {
  const actual = jest.requireActual(
    '@/theme/useBreakpoint',
  ) as typeof import('@/theme/useBreakpoint');
  return { ...actual, useIsWide: () => mockWideViewport };
});

afterEach(() => {
  mockWideViewport = false;
});

function items(n: number): BarListItem[] {
  return Array.from({ length: n }, (_, i) => ({
    code: `c${i}`,
    label: `分类 ${i}`,
    amount: `${(n - i) * 100}.0000` as Money,
    share: (n - i) / n,
  }));
}

describe('BarList', () => {
  test('at most eight bars, the rest collapse into one "其他 N 项" row', () => {
    renderThemed(<BarList items={items(10)} currency="CNY" lang="zh" testID="bars" />);
    for (let i = 0; i < 8; i += 1) {
      expect(screen.getByTestId(`bars-row-c${i}`)).toBeTruthy();
    }
    expect(screen.queryByTestId('bars-row-c8')).toBeNull();
    // The two dropped rows are 200 + 100.
    const rest = screen.getByTestId('bars-rest');
    expect(rest).toHaveTextContent(/其他 2 项/);
    expect(rest).toHaveTextContent(/300\.00/);
  });

  test('bars cycle through chart.series, never through the kind colours', () => {
    renderThemed(<BarList items={items(3)} currency="CNY" lang="zh" testID="bars" />);
    const series = chartSeries(lightColors);
    expect(styleOf(screen.getByTestId('bars-bar-c0')).backgroundColor).toBe(series[0]);
    expect(styleOf(screen.getByTestId('bars-bar-c1')).backgroundColor).toBe(series[1]);
    expect(styleOf(screen.getByTestId('bars-bar-c0')).backgroundColor).not.toBe(
      lightColors['kind.expense'],
    );
  });

  test('a bar width follows its share', () => {
    renderThemed(
      <BarList
        items={[{ code: 'food', label: '餐饮', amount: '2310.5000', share: 0.2743 }]}
        currency="CNY"
        lang="zh"
        testID="bars"
      />,
    );
    expect(styleOf(screen.getByTestId('bars-bar-food')).width).toBe('27.43%');
  });

  test('pressing a row reports the code and expands its level-2 rows', () => {
    const onPress = jest.fn();
    renderThemed(
      <BarList
        items={[
          {
            code: 'food',
            label: '餐饮',
            amount: '2310.5000',
            share: 0.27,
            desc: '一日三餐',
            children: [
              { code: 'lunch', label: '午餐', amount: '980.0000' },
              { code: null, label: '未细分', amount: '200.0000' },
            ],
          },
        ]}
        currency="CNY"
        lang="zh"
        onPress={onPress}
        testID="bars"
      />,
    );
    expect(screen.queryByText('午餐')).toBeNull();
    fireEvent.press(screen.getByTestId('bars-row-food'));
    expect(onPress).toHaveBeenCalledWith('food');
    expect(screen.getByText('午餐')).toBeTruthy();
    expect(screen.getByText('未细分')).toBeTruthy();
  });
});

describe('BarList hover / long press reveals the criterion', () => {
  const withDesc: BarListItem[] = [
    { code: 'groceries', label: '生活购物', amount: '900.0000', share: 0.5, desc: '用完就没了' },
  ];

  test('the criterion is hidden at rest and appears on hover', () => {
    renderThemed(<BarList items={withDesc} currency="CNY" lang="zh" testID="bars" />);
    expect(screen.queryByTestId('bars-desc-groceries')).toBeNull();

    fireEvent(screen.getByTestId('bars-row-groceries'), 'hoverIn');
    expect(screen.getByTestId('bars-desc-groceries')).toHaveTextContent('用完就没了');

    fireEvent(screen.getByTestId('bars-row-groceries'), 'hoverOut');
    expect(screen.queryByTestId('bars-desc-groceries')).toBeNull();
  });

  test('a long press reveals it too, for touch devices', () => {
    renderThemed(<BarList items={withDesc} currency="CNY" lang="zh" testID="bars" />);
    fireEvent(screen.getByTestId('bars-row-groceries'), 'longPress');
    expect(screen.getByTestId('bars-desc-groceries')).toBeTruthy();
  });
});

describe('BarChart', () => {
  const twelve = Array.from({ length: 12 }, (_, i) => ({
    month: `2026-${String(i + 1).padStart(2, '0')}`,
    expense: `${(i + 1) * 1000}.0000` as Money,
  }));

  test('a wide chart labels every one of the twelve bars with its own number', () => {
    mockWideViewport = true;
    renderThemed(<BarChart months={twelve} currency="CNY" lang="zh" testID="trend" />);
    for (const point of twelve) {
      expect(screen.getByTestId(`trend-value-${point.month}`)).toBeTruthy();
      expect(screen.getByTestId(`trend-month-${point.month}`)).toBeTruthy();
    }
    // The mockup's bare '5.2k' form, on one line, so twelve labels fit side by side
    // (屏幕 01 · 首页.dc.html:397; exact, so a change in the formatting cannot slip past).
    expect(screen.getByTestId('trend-value-2026-12')).toHaveTextContent('12.0k');
    expect(screen.getByTestId('trend-value-2026-01')).toHaveTextContent('1.0k');
    expect(screen.getByTestId('trend-value-2026-12').props.numberOfLines).toBe(1);
    // The amount a screen reader hears keeps its currency.
    expect(screen.getByTestId('trend-point-2026-12').props.accessibilityLabel).toBe('12月 ¥1.2万');
  });

  test('a wide bar stops below its label so the label stays inside the chart box', () => {
    mockWideViewport = true;
    renderThemed(
      <BarChart months={twelve} currency="CNY" lang="zh" selected="2026-12" testID="trend" />,
    );
    // The peak bar is the box minus the band the label sits in — the mockup's 104 of 132.
    expect(styleOf(screen.getByTestId('trend-bar-2026-12')).height).toBe(
      BAR_HEIGHT_WIDE - BAR_LABEL_BAND,
    );
    expect(BAR_HEIGHT_WIDE - BAR_LABEL_BAND).toBe(104);
    // The column itself still fills the box, so the row's baseline does not move.
    expect(styleOf(screen.getByTestId('trend-point-2026-12')).height).toBe(BAR_HEIGHT_WIDE);
  });

  test('a narrow chart has no labels to make room for, so its peak fills the box', () => {
    renderThemed(<BarChart months={twelve} currency="CNY" lang="zh" testID="trend" />);
    expect(styleOf(screen.getByTestId('trend-bar-2026-12')).height).toBe(72);
  });

  test('a caller can format the bar labels itself', () => {
    mockWideViewport = true;
    renderThemed(
      <BarChart
        months={twelve}
        currency="CNY"
        lang="zh"
        formatValue={(point) => point.month.slice(5)}
        testID="trend"
      />,
    );
    expect(screen.getByTestId('trend-value-2026-12')).toHaveTextContent('12');
  });

  test('a narrow chart drops the value labels and keeps five milestone months', () => {
    renderThemed(<BarChart months={twelve} currency="CNY" lang="zh" testID="trend" />);
    expect(screen.queryByTestId('trend-value-2026-12')).toBeNull();
    for (const month of ['2026-01', '2026-04', '2026-07', '2026-10', '2026-12']) {
      expect(screen.getByTestId(`trend-month-${month}`)).toBeTruthy();
    }
    expect(screen.queryByTestId('trend-month-2026-02')).toBeNull();
    // Every bar is still there and still pressable, only its label is gone.
    expect(screen.getByTestId('trend-bar-2026-02')).toBeTruthy();
  });

  test('the current month is the solid accent bar, the rest are the idle fill', () => {
    renderThemed(
      <BarChart months={twelve} currency="CNY" lang="zh" selected="2026-05" testID="trend" />,
    );
    expect(styleOf(screen.getByTestId('trend-bar-2026-05')).backgroundColor).toBe(
      lightColors['accent.solid'],
    );
    expect(styleOf(screen.getByTestId('trend-bar-2026-06')).backgroundColor).toBe(
      lightColors['border.strong'],
    );
  });

  test('tapping a month reports it', () => {
    const onPressMonth = jest.fn();
    renderThemed(
      <BarChart
        months={makeStatsTrend().months}
        currency="CNY"
        lang="zh"
        selected="2026-08"
        onPressMonth={onPressMonth}
        testID="trend"
      />,
    );
    fireEvent.press(screen.getByTestId('trend-point-2026-05'));
    expect(onPressMonth).toHaveBeenCalledWith('2026-05');
  });

  test('no months at all is an empty state about the year, not about this month', () => {
    renderThemed(<BarChart months={[]} currency="CNY" lang="zh" testID="trend" />);
    expect(screen.getByTestId('trend-empty')).toBeTruthy();
    expect(screen.getByText('这一年还没有支出记录')).toBeTruthy();
    expect(screen.queryByText('这个月还没有记账')).toBeNull();
  });

  test('bar heights scale to the peak and a flat year still draws twelve bars', () => {
    const heights = barHeights([0, 50, 100], 104);
    expect(heights[2]).toBe(104);
    expect(heights[1]).toBe(52);
    // A month with nothing in it keeps a stub, so the row has no hole in it.
    expect(heights[0]).toBeGreaterThan(0);
    expect(barHeights([0, 0], 104)).toEqual([6, 6]);
  });

  test('the narrow axis keeps the first, the last and every third month between', () => {
    expect(narrowLabelIndexes(12)).toEqual([0, 3, 6, 9, 11]);
    expect(narrowLabelIndexes(1)).toEqual([0]);
    expect(narrowLabelIndexes(0)).toEqual([]);
  });

  test('the bar label is the mockup\u2019s thousands-with-a-k, and stays short below 1000', () => {
    expect(compactBarLabel(5200)).toBe('5.2k');
    expect(compactBarLabel(8100)).toBe('8.1k');
    expect(compactBarLabel(6842.5)).toBe('6.8k');
    expect(compactBarLabel(420.4)).toBe('420');
    expect(compactBarLabel(0)).toBe('0');
  });

  test('the axis uses short month names in both languages', () => {
    expect(monthAbbrev('2026-08', 'zh')).toBe('8月');
    expect(monthAbbrev('2026-08', 'en')).toBe('Aug');
  });

  test('TrendChart is still the same chart under its old name', () => {
    const onPressMonth = jest.fn();
    renderThemed(
      <TrendChart
        months={twelve}
        currency="CNY"
        lang="zh"
        onPressMonth={onPressMonth}
        testID="legacy"
      />,
    );
    fireEvent.press(screen.getByTestId('legacy-point-2026-03'));
    expect(onPressMonth).toHaveBeenCalledWith('2026-03');
  });
});
