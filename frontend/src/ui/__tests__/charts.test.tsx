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
import { BarList, type BarListItem } from '@/ui/BarList';
import { TrendChart, monthAbbrev, trendGeometry } from '@/ui/TrendChart';
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

describe('TrendChart', () => {
  const twelve = Array.from({ length: 12 }, (_, i) => ({
    month: `2026-${String(i + 1).padStart(2, '0')}`,
    expense: `${(i + 1) * 1000}.0000` as Money,
  }));

  test('every one of the twelve points carries its own value label', () => {
    renderThemed(<TrendChart months={twelve} currency="CNY" lang="zh" testID="trend" />);
    for (const point of twelve) {
      expect(screen.getByTestId(`trend-value-${point.month}`)).toBeTruthy();
      expect(screen.getByTestId(`trend-month-${point.month}`)).toBeTruthy();
    }
    expect(screen.getByTestId('trend-value-2026-12')).toHaveTextContent(/12,000/);
  });

  test('tapping a month reports it', () => {
    const onPressMonth = jest.fn();
    renderThemed(
      <TrendChart
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

  test('no months at all is an empty state, not a flat line', () => {
    renderThemed(<TrendChart months={[]} currency="CNY" lang="zh" testID="trend" />);
    expect(screen.getByTestId('trend-empty')).toBeTruthy();
    expect(screen.getByText('这个月还没有记账')).toBeTruthy();
  });

  test('the geometry puts the peak at the top and zero at the bottom', () => {
    const points = trendGeometry([0, 50, 100], 210, 100);
    expect(points[0].y).toBeGreaterThan(points[1].y);
    expect(points[1].y).toBeGreaterThan(points[2].y);
    expect(points[0].x).toBeLessThan(points[2].x);
    // A flat all-zero year must not divide by zero.
    expect(trendGeometry([0, 0], 210, 100).every((p) => Number.isFinite(p.y))).toBe(true);
  });

  test('the axis uses short month names in both languages', () => {
    expect(monthAbbrev('2026-08', 'zh')).toBe('8月');
    expect(monthAbbrev('2026-08', 'en')).toBe('Aug');
  });
});
