/**
 * 12-month expense trend (04 §4.4).
 *
 * Phase 7 replaced the polyline with the mockups' bar chart; this module is the name the
 * home page already imports, kept as a thin alias over `BarChart` so the swap is a style
 * change and not an API change. New code should reach for `BarChart` directly.
 */
import React from 'react';
import { BarChart, type BarChartPoint, type BarChartProps } from './BarChart';

/** `BarChartPoint` under its original name. */
export type TrendPoint = BarChartPoint;

export type TrendChartProps = BarChartProps;

export function TrendChart(props: TrendChartProps): React.JSX.Element {
  return <BarChart {...props} />;
}
