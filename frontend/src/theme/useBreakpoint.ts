/**
 * The single breakpoint (decision §0.6): below 1024 = narrow (bottom tabs, sheets),
 * at/above = wide (sidebar, inline dropdown panels).
 */
import { useWindowDimensions } from 'react-native';
import { breakpoint } from './tokens';

/** Pure boundary test, so the rule can be unit-tested without rendering. */
export function isWide(width: number): boolean {
  return width >= breakpoint.md;
}

export function useIsWide(): boolean {
  const { width } = useWindowDimensions();
  return isWide(width);
}
