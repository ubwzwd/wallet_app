/**
 * The 12-month expense chart (04 §4.4, §6.2 rule 3, mockup 01): every wide bar labelled
 * with its own number, the narrow axis down to five milestone months on one line each,
 * and the current month drawn solid against the idle fill.
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import type { Money } from '@/api/types';
import { namespaces, resources } from '@/i18n/resources';
import { ThemeProvider } from '@/theme/ThemeProvider';
import { lightColors } from '@/theme/tokens';
import {
  BAR_HEIGHT_WIDE,
  BAR_LABEL_BAND,
  BarChart,
  barHeights,
  compactBarLabel,
  monthAbbrev,
  narrowLabelIndexes,
} from '@/ui/BarChart';
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
    expect(screen.getByTestId('trend-point-2026-12').props.accessibilityLabel).toBe('12 月 ¥1.2万');
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

  test('the five narrow labels each keep one line, spread edge to edge', () => {
    renderThemed(<BarChart months={twelve} currency="CNY" lang="zh" testID="trend" />);
    const first = screen.getByTestId('trend-month-2026-01');
    // 屏幕 01 · 首页.dc.html:138 lays the five out with `space-between`. Packed into the
    // chart's twelve flex slots instead, a slot is ~26px wide and 「10 月」 wraps.
    expect(first.props.numberOfLines).toBe(1);
    expect(styleOf(first).flex).toBeUndefined();
    expect(styleOf(screen.getByTestId('trend-axis')).justifyContent).toBe('space-between');
    // The wide axis keeps one centred slot per column instead.
    screen.unmount();
    mockWideViewport = true;
    renderThemed(<BarChart months={twelve} currency="CNY" lang="zh" testID="trend" />);
    expect(styleOf(screen.getByTestId('trend-axis')).justifyContent).toBeUndefined();
    expect(styleOf(screen.getByTestId('trend-month-2026-01')).flex).toBe(1);
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
    expect(monthAbbrev('2026-08', 'zh')).toBe('8 月');
    expect(monthAbbrev('2026-08', 'en')).toBe('Aug');
  });
});
